import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { COUNTED_REPORT_STATUSES, currentWeekNumber } from "@/lib/progress";
import { contractDaysFor } from "@/lib/rab/import";
import { curveFromCategorySchedule } from "@/lib/scurve/generate";
import { placeItems, type SeqItem } from "@/lib/scurve/sequencing";

/**
 * Layer baseline (kurva-S rencana ber-versi) + deret rencana vs realisasi.
 * Semantik dipertahankan dari b6e77af src/lib/scurve-plan.ts + scurve-data.ts:
 *   - baseline TIDAK pernah di-edit in place — perubahan = baseline BARU,
 *     yang lama di-supersede (histori utuh, DECISIONS 027)
 *   - realisasi = Σ valueDone item laporan counted, bucket per minggu dari
 *     tanggal laporan, kumulatif ÷ grand total revisi aktif
 */

const WEEK_MS = 7 * 24 * 3600 * 1000;

export async function getActiveBaseline(locationId: string) {
  return db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    orderBy: { baselineNo: "desc" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, plannedPct: true } },
    },
  });
}

/** Validasi deret plan: 0..100, monotonik naik, akhir 100 ± 0.5. */
export function validateBaselinePoints(points: number[]): string | null {
  if (points.length === 0) return "Deret rencana kosong.";
  let prev = -Infinity;
  for (const [i, p] of points.entries()) {
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return `Minggu ${i + 1}: nilai ${p} di luar rentang 0–100.`;
    }
    if (p < prev) return `Minggu ${i + 1}: kurva turun (${prev} → ${p}) — harus monotonik naik.`;
    prev = p;
  }
  const last = points[points.length - 1];
  if (Math.abs(last - 100) > 0.5) {
    return `Minggu terakhir harus 100% (±0.5), sekarang ${last}%.`;
  }
  return null;
}

/**
 * Simpan kurva rencana hasil edit manual → baseline BARU source "manual"
 * (baseline lama di-supersede, histori utuh). `baselineId` = baseline acuan
 * yang sedang diedit (sumber locationId/contractDays/rabRevisionId).
 */
export async function updateBaselinePoints(baselineId: string, points: number[], userId: string) {
  const invalid = validateBaselinePoints(points);
  if (invalid) throw new Error(invalid);

  const ref = await db.baseline.findUniqueOrThrow({
    where: { id: baselineId },
    select: { locationId: true, contractDays: true, rabRevisionId: true, baselineNo: true },
  });
  // Jumlah minggu boleh berubah saat edit manual — contractDays ikut deret baru
  // bila tidak lagi cocok dengan acuan.
  const refWeeks = Math.ceil(ref.contractDays / 7);
  const contractDays = refWeeks === points.length ? ref.contractDays : points.length * 7;

  const baseline = await db.$transaction(async (tx) => {
    await tx.baseline.updateMany({
      where: { locationId: ref.locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    const last = await tx.baseline.aggregate({
      where: { locationId: ref.locationId },
      _max: { baselineNo: true },
    });
    const created = await tx.baseline.create({
      data: {
        locationId: ref.locationId,
        baselineNo: (last._max.baselineNo ?? 0) + 1,
        source: "manual",
        status: "aktif",
        rabRevisionId: ref.rabRevisionId,
        contractDays,
        note: `Edit manual dari baseline #${ref.baselineNo}`,
        createdById: userId,
      },
    });
    await tx.baselinePoint.createMany({
      data: points.map((p, i) => ({
        baselineId: created.id,
        weekNumber: i + 1,
        plannedPct: p,
      })),
    });
    return created;
  });
  await audit(userId, "baseline.update_points", "baseline", baseline.id, {
    locationId: ref.locationId,
    fromBaselineId: baselineId,
    baselineNo: baseline.baselineNo,
    weeks: points.length,
  });
  return baseline;
}

// ── Jadwal per pekerjaan (kategori RAB) → baseline ──────────────────────────

export type CategoryScheduleView = {
  lineageKey: string;
  name: string;
  weightPct: number;
  startWeek: number;
  endWeek: number;
};

export type CategoryScheduleData = {
  totalWeeks: number;
  /** "tersimpan" = dari jadwal baseline aktif; "otomatis" = derivasi trade windows. */
  origin: "tersimpan" | "otomatis";
  rows: CategoryScheduleView[];
};

/** Kategori RAB aktif (amount > 0) + bobot % derived. */
async function activeCategoriesWithWeights(locationId: string) {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return null;
  const nodes = await db.rabNode.findMany({
    where: { revisionId: revision.id, kind: { in: ["kategori", "item"] } },
    select: { kind: true, name: true, amount: true, lineageKey: true },
    orderBy: { sortOrder: "asc" },
  });
  const categories = nodes.filter((n) => n.kind === "kategori" && n.amount > 0n);
  const grand = categories.reduce((s, c) => s + Number(c.amount), 0);
  if (grand <= 0) return null;
  const items = nodes.filter((n) => n.kind === "item" && n.amount > 0n);
  return { revisionId: revision.id, categories, items, grand };
}

/**
 * Jadwal per kategori untuk editor. Prioritas: jadwal TERSIMPAN pada baseline
 * aktif (bila revisi RAB-nya masih sama & jumlah minggu cocok) — supaya edit
 * lanjutan membuka jadwal terakhir, bukan mulai dari nol. Fallback: derivasi
 * otomatis dari trade windows item per kategori (envelope, cost-based).
 */
export async function deriveCategorySchedule(locationId: string): Promise<CategoryScheduleData | null> {
  const base = await activeCategoriesWithWeights(locationId);
  if (!base) return null;
  const contractDays = await contractDaysFor(locationId);
  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));

  const weightFor = (catAmount: bigint) => (Number(catAmount) / base.grand) * 100;

  // Jadwal tersimpan dari baseline aktif (revisi sama + minggu masih muat).
  const active = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    select: {
      rabRevisionId: true,
      scheduleItems: { select: { lineageKey: true, startWeek: true, endWeek: true } },
    },
  });
  if (active && active.rabRevisionId === base.revisionId && active.scheduleItems.length > 0) {
    const byKey = new Map(active.scheduleItems.map((s) => [s.lineageKey, s]));
    const allWithin = active.scheduleItems.every((s) => s.endWeek <= totalWeeks);
    if (allWithin && base.categories.every((c) => byKey.has(c.lineageKey))) {
      return {
        totalWeeks,
        origin: "tersimpan",
        rows: base.categories.map((c) => {
          const s = byKey.get(c.lineageKey)!;
          return {
            lineageKey: c.lineageKey,
            name: c.name,
            weightPct: Math.round(weightFor(c.amount) * 1000) / 1000,
            startWeek: s.startWeek,
            endWeek: s.endWeek,
          };
        }),
      };
    }
  }

  // Derivasi otomatis: jendela kategori = envelope jendela TAHAP item-itemnya
  // (mesin sequencing per-unit — konsisten dgn kurva auto scheduleBySequence).
  const catKeys = base.categories
    .map((c) => ({ key: c.lineageKey, name: c.name }))
    .sort((a, b) => b.key.length - a.key.length);
  const categoryFor = (lineageKey: string): { key: string; name: string } | null =>
    catKeys.find((c) => lineageKey === c.key || lineageKey.startsWith(`${c.key}#`)) ?? null;

  const seqItems: SeqItem[] = [];
  const keyByName = new Map<string, string>(); // categoryName → lineageKey (envelope index)
  for (const it of base.items) {
    const cat = categoryFor(it.lineageKey);
    if (!cat) continue;
    keyByName.set(cat.name, cat.key);
    seqItems.push({ name: it.name, categoryName: cat.name, amount: it.amount });
  }
  const placements = placeItems(seqItems);
  const envelope = new Map<string, { start: number; end: number }>();
  for (const p of placements) {
    const catKey = keyByName.get(p.categoryName);
    if (!catKey) continue;
    const cur = envelope.get(catKey);
    envelope.set(catKey, {
      start: cur ? Math.min(cur.start, p.start) : p.start,
      end: cur ? Math.max(cur.end, p.end) : p.end,
    });
  }

  return {
    totalWeeks,
    origin: "otomatis",
    rows: base.categories.map((c) => {
      const env = envelope.get(c.lineageKey) ?? { start: 0.25, end: 0.8 };
      const startWeek = Math.max(1, Math.min(totalWeeks, Math.floor(env.start * totalWeeks) + 1));
      const endWeek = Math.max(startWeek, Math.min(totalWeeks, Math.ceil(env.end * totalWeeks)));
      return {
        lineageKey: c.lineageKey,
        name: c.name,
        weightPct: Math.round(weightFor(c.amount) * 1000) / 1000,
        startWeek,
        endWeek,
      };
    }),
  };
}

/**
 * Simpan jadwal per kategori → baseline BARU source "manual" + scheduleItems.
 * Bobot DIHITUNG ULANG dari RAB aktif (klien hanya mengirim jendela minggu —
 * bobot tidak pernah dipercaya dari luar). Idempotent: jadwal & titik identik
 * dengan baseline aktif ⇒ tidak dibuat versi baru.
 */
export async function saveCategorySchedule(
  locationId: string,
  input: { lineageKey: string; startWeek: number; endWeek: number }[],
  userId: string,
) {
  const base = await activeCategoriesWithWeights(locationId);
  if (!base) throw new Error("Belum ada revisi RAB aktif — impor RAB dulu.");
  const contractDays = await contractDaysFor(locationId);
  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));

  const byKey = new Map(input.map((r) => [r.lineageKey, r]));
  const rows = base.categories.map((c) => {
    const r = byKey.get(c.lineageKey);
    if (!r) throw new Error(`Jadwal untuk kategori "${c.name}" tidak lengkap — muat ulang halaman.`);
    const startWeek = Math.floor(r.startWeek);
    const endWeek = Math.floor(r.endWeek);
    if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) {
      throw new Error(`Minggu kategori "${c.name}" tidak valid.`);
    }
    if (startWeek < 1 || endWeek > totalWeeks || startWeek > endWeek) {
      throw new Error(
        `Kategori "${c.name}": minggu ${startWeek}–${endWeek} di luar rentang 1–${totalWeeks} atau terbalik.`,
      );
    }
    return {
      lineageKey: c.lineageKey,
      name: c.name,
      weightPct: (Number(c.amount) / base.grand) * 100,
      startWeek,
      endWeek,
    };
  });

  const weekly = curveFromCategorySchedule(rows, totalWeeks);
  const invalid = validateBaselinePoints(weekly);
  if (invalid) throw new Error(invalid);

  // Idempotent: identik dengan baseline aktif (jadwal & titik) → no-op.
  const active = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      scheduleItems: { select: { lineageKey: true, startWeek: true, endWeek: true } },
    },
  });
  if (
    active &&
    active.rabRevisionId === base.revisionId &&
    active.points.length === weekly.length &&
    active.points.every((p, i) => Math.abs(Number(p.plannedPct) - weekly[i]) < 0.005) &&
    active.scheduleItems.length === rows.length &&
    rows.every((r) => {
      const s = active.scheduleItems.find((x) => x.lineageKey === r.lineageKey);
      return s && s.startWeek === r.startWeek && s.endWeek === r.endWeek;
    })
  ) {
    return { baselineNo: active.baselineNo, unchanged: true as const };
  }

  const baseline = await db.$transaction(async (tx) => {
    await tx.baseline.updateMany({
      where: { locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    const last = await tx.baseline.aggregate({
      where: { locationId },
      _max: { baselineNo: true },
    });
    const created = await tx.baseline.create({
      data: {
        locationId,
        baselineNo: (last._max.baselineNo ?? 0) + 1,
        source: "manual",
        status: "aktif",
        rabRevisionId: base.revisionId,
        contractDays,
        note: "Jadwal per pekerjaan (kategori) — editor manual",
        createdById: userId,
      },
    });
    await tx.baselinePoint.createMany({
      data: weekly.map((p, i) => ({ baselineId: created.id, weekNumber: i + 1, plannedPct: p })),
    });
    await tx.baselineScheduleItem.createMany({
      data: rows.map((r) => ({
        baselineId: created.id,
        lineageKey: r.lineageKey,
        name: r.name,
        weightPct: Math.round(r.weightPct * 1000) / 1000,
        startWeek: r.startWeek,
        endWeek: r.endWeek,
      })),
    });
    return created;
  });
  await audit(userId, "baseline.schedule", "baseline", baseline.id, {
    locationId,
    baselineNo: baseline.baselineNo,
    categories: rows.length,
    weeks: weekly.length,
  });
  return { baselineNo: baseline.baselineNo, unchanged: false as const };
}

/**
 * Pulihkan baseline lama: SALIN titik (+ jadwal bila ada) menjadi versi BARU
 * yang aktif — append-only, riwayat tetap linear & utuh (versi lama tidak
 * diubah statusnya menjadi aktif kembali).
 */
export async function restoreBaseline(baselineId: string, userId: string) {
  const src = await db.baseline.findUniqueOrThrow({
    where: { id: baselineId },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, plannedPct: true } },
      scheduleItems: {
        select: { lineageKey: true, name: true, weightPct: true, startWeek: true, endWeek: true },
      },
    },
  });
  if (src.status === "aktif") {
    return { baselineNo: src.baselineNo, locationId: src.locationId, unchanged: true as const };
  }
  if (src.points.length === 0) throw new Error("Baseline sumber tidak punya titik rencana.");

  const baseline = await db.$transaction(async (tx) => {
    await tx.baseline.updateMany({
      where: { locationId: src.locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    const last = await tx.baseline.aggregate({
      where: { locationId: src.locationId },
      _max: { baselineNo: true },
    });
    const created = await tx.baseline.create({
      data: {
        locationId: src.locationId,
        baselineNo: (last._max.baselineNo ?? 0) + 1,
        source: "manual",
        status: "aktif",
        rabRevisionId: src.rabRevisionId,
        contractDays: src.contractDays,
        note: `Pulihkan dari baseline #${src.baselineNo}`,
        createdById: userId,
      },
    });
    await tx.baselinePoint.createMany({
      data: src.points.map((p) => ({
        baselineId: created.id,
        weekNumber: p.weekNumber,
        plannedPct: p.plannedPct,
      })),
    });
    if (src.scheduleItems.length > 0) {
      await tx.baselineScheduleItem.createMany({
        data: src.scheduleItems.map((s) => ({ ...s, baselineId: created.id })),
      });
    }
    return created;
  });
  await audit(userId, "baseline.restore", "baseline", baseline.id, {
    locationId: src.locationId,
    fromBaselineId: baselineId,
    fromBaselineNo: src.baselineNo,
    baselineNo: baseline.baselineNo,
  });
  return { baselineNo: baseline.baselineNo, locationId: src.locationId, unchanged: false as const };
}

export type ScurveSeries = {
  totalWeeks: number;
  /** Minggu berjalan (clamp 1..totalWeeks). */
  currentWeek: number;
  /** Plan kumulatif % per minggu (index 0 = minggu 1). */
  planPct: number[];
  /** Realisasi kumulatif % per minggu; null untuk minggu > minggu berjalan. */
  actualPct: (number | null)[];
  grandTotal: bigint;
};

/**
 * Deret kurva-S lokasi: plan dari baseline aktif, realisasi dari
 * DailyReportItem.valueDone (laporan counted), bucket minggu
 * = floor((reportDate − startDate) / 7 hari) + 1, kumulatif ÷ grand total
 * revisi aktif × 100. Lineage dicocokkan ke item revisi AKTIF supaya angka
 * konsisten dengan lib/progress (carry-over lintas revisi by lineageKey).
 */
export async function getScurveSeries(locationId: string): Promise<ScurveSeries> {
  const [baseline, revision, loc] = await Promise.all([
    getActiveBaseline(locationId),
    db.rabRevision.findFirst({
      where: { locationId, status: "aktif" },
      select: { id: true },
    }),
    db.location.findUnique({
      where: { id: locationId },
      select: { package: { select: { contract: { select: { startDate: true } } } } },
    }),
  ]);

  if (!baseline || baseline.points.length === 0) {
    return { totalWeeks: 0, currentWeek: 1, planPct: [], actualPct: [], grandTotal: 0n };
  }

  const planPct = baseline.points.map((p) => Number(p.plannedPct));
  const totalWeeks = planPct.length;
  // startDate kontrak = minggu-1; fallback tanggal baseline dibuat (lokasi tanpa kontrak).
  const startDate = loc?.package.contract?.startDate ?? baseline.createdAt;
  const currentWeek = currentWeekNumber(startDate, totalWeeks);

  let grandTotal = 0n;
  const perWeek: bigint[] = new Array<bigint>(totalWeeks).fill(0n);
  if (revision) {
    const catAgg = await db.rabNode.aggregate({
      where: { revisionId: revision.id, kind: "kategori" },
      _sum: { amount: true },
    });
    grandTotal = catAgg._sum.amount ?? 0n;

    const rows = await db.dailyReportItem.findMany({
      where: {
        report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
        lineageKey: { in: (
          await db.rabNode.findMany({
            where: { revisionId: revision.id, kind: "item" },
            select: { lineageKey: true },
          })
        ).map((n) => n.lineageKey) },
      },
      select: { valueDone: true, report: { select: { reportDate: true } } },
    });
    for (const r of rows) {
      const wk = Math.floor((r.report.reportDate.getTime() - startDate.getTime()) / WEEK_MS) + 1;
      const idx = Math.max(1, Math.min(wk, totalWeeks)) - 1;
      perWeek[idx] += r.valueDone;
    }
  }

  let cum = 0n;
  const actualPct: (number | null)[] = [];
  for (let w = 1; w <= totalWeeks; w++) {
    cum += perWeek[w - 1];
    actualPct.push(
      w <= currentWeek ? (grandTotal > 0n ? (Number(cum) / Number(grandTotal)) * 100 : 0) : null,
    );
  }

  return { totalWeeks, currentWeek, planPct, actualPct, grandTotal };
}
