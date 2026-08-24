import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { COUNTED_REPORT_STATUSES, currentWeekNumber } from "@/lib/progress";
import { weekOfDate } from "@/lib/progress-calc";
import { bobotPct, prestasiPct } from "@/lib/progress-calc";
import { contractDaysFor, totalWeeksFor } from "@/lib/rab/import";
import {
  autoCategorySchedule,
  cumulativeFromWeeklyRows,
  rescheduleToCurve,
  segmentsFromWeekly,
  validateBaselinePoints,
  weeklyFromSegments,
  type WeekSegment,
} from "@/lib/scurve/generate";
import { susunJadwalApaAdanya, type HasilApaAdanya } from "@/lib/scurve/jadwal-verbatim";

/**
 * Layer baseline (kurva-S rencana ber-versi) + deret rencana vs realisasi.
 * Semantik dipertahankan dari b6e77af src/lib/scurve-plan.ts + scurve-data.ts:
 *   - baseline TIDAK pernah di-edit in place — perubahan = baseline BARU,
 *     yang lama di-supersede (histori utuh, DECISIONS 027)
 *   - realisasi = Σ (prestasi item dibatasi 100% × bobot revisi aktif), bucket
 *     per minggu dari tanggal laporan — formula tunggal di lib/progress-calc.ts
 *     (DECISIONS 151), sama dengan lib/progress & lib/periodic-report
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

// Validator deret rencana tinggal di `scurve/generate` (murni, bisa diuji tanpa
// DB) — di-reexport di sini karena seluruh pemanggilnya mengenalnya dari modul
// baseline.
export { validateBaselinePoints };

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
    // Jadwal per-kategori IKUT DISETEL ke kurva baru (keputusan user
    // 2026-07-27, DECISIONS 159). Dulu disalin apa adanya, sehingga sesudah
    // penyesuaian halus Σ jadwal kategori ≠ titik kurva — Excel (yang baris
    // rencananya rumus Σ kolom kategori) menampilkan kurva LAMA sementara
    // PDF/dashboard memakai kurva baru. `rescheduleToCurve` memetakan waktu:
    // kolom mengikuti increment kurva baru, bobot tiap baris tetap = porsi RAB.
    // Jumlah minggu boleh berubah — jadwal ikut diregangkan (dulu malah dibuang).
    const refSchedule = await tx.baselineScheduleItem.findMany({
      where: { baselineId },
      select: { lineageKey: true, name: true, weightPct: true, weekly: true },
    });
    if (refSchedule.length > 0) {
      const setel = rescheduleToCurve(
        refSchedule.map((it) => asWeekly(it.weekly)),
        points,
      );
      await tx.baselineScheduleItem.createMany({
        data: refSchedule.map((it, i) => ({
          baselineId: created.id,
          lineageKey: it.lineageKey,
          name: it.name,
          weightPct: it.weightPct,
          weekly: setel[i].map((v) => Math.round(v * 1e6) / 1e6) as Prisma.InputJsonValue,
        })),
      });
    }
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
  /** Rentang minggu aktif (boleh >1 = ada JEDA). Diturunkan dari `weekly`. */
  segments: WeekSegment[];
  /** Increment bobot per minggu (panjang totalWeeks). */
  weekly: number[];
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
  const { totalWeeks, weekEndFracs } = await totalWeeksFor(locationId);

  const weightFor = (catAmount: bigint) => (Number(catAmount) / base.grand) * 100;

  // Jadwal tersimpan dari baseline aktif (revisi sama + matriks minggu cocok).
  const active = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    select: {
      rabRevisionId: true,
      scheduleItems: { select: { lineageKey: true, weekly: true } },
    },
  });
  if (active && active.rabRevisionId === base.revisionId && active.scheduleItems.length > 0) {
    const byKey = new Map(active.scheduleItems.map((s) => [s.lineageKey, asWeekly(s.weekly)]));
    // Pakai jadwal tersimpan hanya bila SEMUA kategori punya matriks minggu
    // sepanjang totalWeeks (bukan backfill '[]' / durasi berubah).
    const usable =
      base.categories.every((c) => {
        const w = byKey.get(c.lineageKey);
        return w && w.length === totalWeeks && w.some((v) => v > 0);
      });
    if (usable) {
      return {
        totalWeeks,
        origin: "tersimpan",
        rows: base.categories.map((c) => {
          const weekly = byKey.get(c.lineageKey)!;
          return {
            lineageKey: c.lineageKey,
            name: c.name,
            weightPct: Math.round(weightFor(c.amount) * 1000) / 1000,
            segments: segmentsFromWeekly(weekly),
            weekly,
          };
        }),
      };
    }
  }

  // Derivasi otomatis: jendela presedensi per KATEGORI (DECISIONS 079) —
  // konsisten dgn regenerateBaseline (autoCategorySchedule). Satu segmen kontigu.
  const auto = autoCategorySchedule(
    base.categories.map((c) => ({ lineageKey: c.lineageKey, name: c.name, amount: c.amount })),
    totalWeeks,
    weekEndFracs,
  );
  const autoByKey = new Map(auto.map((a) => [a.lineageKey, a]));

  return {
    totalWeeks,
    origin: "otomatis",
    rows: base.categories.map((c) => {
      const a = autoByKey.get(c.lineageKey);
      const weightPct = Math.round(weightFor(c.amount) * 1000) / 1000;
      const segments: WeekSegment[] = [{ startWeek: a?.startWeek ?? 1, endWeek: a?.endWeek ?? totalWeeks }];
      return {
        lineageKey: c.lineageKey,
        name: c.name,
        weightPct,
        segments,
        weekly: weeklyFromSegments(weightPct, segments, totalWeeks, weekEndFracs),
      };
    }),
  };
}

/** Baca kolom Json `weekly` → number[] (aman terhadap bentuk tak terduga). */
function asWeekly(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0));
}

/**
 * Simpan jadwal per kategori → baseline BARU source "manual" + scheduleItems.
 * Bobot DIHITUNG ULANG dari RAB aktif (klien hanya mengirim SEGMEN minggu —
 * bobot tidak pernah dipercaya dari luar). Segmen boleh >1 per kategori =
 * minggu TERPUTUS (jeda). Matriks `weekly` disimpan sebagai bentuk kanonik;
 * kurva = Σ weekly diakumulasi. Idempotent: matriks & titik identik ⇒ no-op.
 * DECISIONS 103.
 */
export async function saveCategorySchedule(
  locationId: string,
  input: { lineageKey: string; segments: WeekSegment[] }[],
  userId: string,
) {
  const base = await activeCategoriesWithWeights(locationId);
  if (!base) throw new Error("Belum ada revisi RAB aktif – impor RAB dulu.");
  const { contractDays, totalWeeks, weekEndFracs } = await totalWeeksFor(locationId);

  const byKey = new Map(input.map((r) => [r.lineageKey, r]));
  const rows = base.categories.map((c) => {
    const r = byKey.get(c.lineageKey);
    if (!r) throw new Error(`Jadwal untuk kategori "${c.name}" tidak lengkap – muat ulang halaman.`);
    const segments = (r.segments ?? []).map((s) => ({
      startWeek: Math.floor(s.startWeek),
      endWeek: Math.floor(s.endWeek),
    }));
    if (segments.length === 0) throw new Error(`Kategori "${c.name}": minimal satu rentang minggu.`);
    for (const s of segments) {
      if (!Number.isFinite(s.startWeek) || !Number.isFinite(s.endWeek)) {
        throw new Error(`Minggu kategori "${c.name}" tidak valid.`);
      }
      if (s.startWeek < 1 || s.endWeek > totalWeeks || s.startWeek > s.endWeek) {
        throw new Error(
          `Kategori "${c.name}": rentang ${s.startWeek}–${s.endWeek} di luar 1–${totalWeeks} atau terbalik.`,
        );
      }
    }
    const weightPct = (Number(c.amount) / base.grand) * 100;
    return {
      lineageKey: c.lineageKey,
      name: c.name,
      weightPct,
      // Matriks kanonik: lonceng per segmen, 0 di minggu jeda.
      weekly: weeklyFromSegments(weightPct, segments, totalWeeks, weekEndFracs),
    };
  });

  // Kurva = Σ weekly semua kategori, diakumulasi (sumber tunggal = matriks).
  const weekly = cumulativeFromWeeklyRows(
    rows.map((r) => r.weekly),
    totalWeeks,
  );
  const invalid = validateBaselinePoints(weekly);
  if (invalid) throw new Error(invalid);

  // Idempotent: identik dengan baseline aktif (matriks minggu & titik) → no-op.
  const active = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      scheduleItems: { select: { lineageKey: true, weekly: true } },
    },
  });
  if (
    active &&
    active.rabRevisionId === base.revisionId &&
    active.points.length === weekly.length &&
    active.points.every((p, i) => Math.abs(Number(p.plannedPct) - weekly[i]) < 0.005) &&
    active.scheduleItems.length === rows.length &&
    rows.every((r) => {
      const prev = active.scheduleItems.find((x) => x.lineageKey === r.lineageKey);
      if (!prev) return false;
      const pw = asWeekly(prev.weekly);
      return pw.length === r.weekly.length && pw.every((v, i) => Math.abs(v - r.weekly[i]) < 0.005);
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
        note: "Jadwal per pekerjaan (kategori) – editor manual",
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
        weekly: r.weekly.map((v) => Math.round(v * 1e6) / 1e6),
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
 * Simpan jadwal dari MATRIKS mingguan mentah per kategori (hasil re-import Time
 * Schedule Excel yang diedit sipil) → baseline BARU "manual". DECISIONS 103/203.
 *
 * Dua mode, dan DEFAULTNYA `apaadanya` (keputusan user 2026-08-01):
 *
 *   `apaadanya` — angka Excel dipakai sebagaimana adanya, termasuk bobot tiap
 *     pekerjaan. Orang yang mengunggah jadwalnya sendiri sedang menyatakan
 *     rencananya; menskalakan ulang diam-diam membuat uploadnya terbaca
 *     "tidak dibaca sistem". Lihat `scurve/jadwal-verbatim.ts`.
 *
 *   `rab` — HARUS DIMINTA: bentuk/jeda dari Excel dipertahankan tetapi bobot
 *     tiap kategori direnormalisasi ke bobot RAB, dan kategori yang tak ada di
 *     Excel diisi jadwal otomatis agar kurva tuntas 100%.
 */
export type ModeJadwal = "apaadanya" | "rab";

/**
 * Hitung baseline BARU dari jadwal mingguan per kategori — TANPA menulis apa
 * pun (DECISIONS 364).
 *
 * Dipisah dari `saveCategoryWeekly` supaya **pratinjau dan penerapan memakai
 * jalur hitung yang sama**. Pratinjau yang menghitung sendiri adalah pratinjau
 * yang suatu saat berbohong — dan tepat pada saat orang mempercayainya untuk
 * menekan "Terapkan".
 */
export async function hitungJadwalBaru(
  locationId: string,
  input: { lineageKey: string; weekly: number[] }[],
  mode: ModeJadwal = "apaadanya",
) {
  const base = await activeCategoriesWithWeights(locationId);
  if (!base) throw new Error("Belum ada revisi RAB aktif – impor RAB dulu.");
  const { contractDays, totalWeeks, weekEndFracs } = await totalWeeksFor(locationId);

  const byKey = new Map(input.map((r) => [r.lineageKey, r.weekly]));

  let matched = 0;
  let rows: { lineageKey: string; name: string; weightPct: number; weekly: number[] }[];
  let verbatim: HasilApaAdanya | null = null;

  if (mode === "apaadanya") {
    verbatim = susunJadwalApaAdanya(
      base.categories.map((c) => ({
        lineageKey: c.lineageKey,
        name: c.name,
        weightRabPct: (Number(c.amount) / base.grand) * 100,
      })),
      byKey,
      totalWeeks,
    );
    rows = verbatim.rows;
    matched = verbatim.cocok;
  } else {
    const auto = autoCategorySchedule(
      base.categories.map((c) => ({ lineageKey: c.lineageKey, name: c.name, amount: c.amount })),
      totalWeeks,
      weekEndFracs,
    );
    const autoByKey = new Map(auto.map((a) => [a.lineageKey, a]));
    rows = base.categories.map((c) => {
      const weightPct = (Number(c.amount) / base.grand) * 100;
      const raw = byKey.get(c.lineageKey);
      const posSum = raw && raw.length === totalWeeks ? raw.reduce((s, v) => s + (v > 0 ? v : 0), 0) : 0;
      let weekly: number[];
      if (raw && raw.length === totalWeeks && posSum > 0) {
        // Pertahankan bentuk/jeda dari Excel, skalakan ke bobot RAB.
        const k = weightPct / posSum;
        weekly = raw.map((v) => (v > 0 ? Math.round(v * k * 1e6) / 1e6 : 0));
        matched += 1;
      } else {
        const a = autoByKey.get(c.lineageKey);
        weekly = weeklyFromSegments(
          weightPct,
          [{ startWeek: a?.startWeek ?? 1, endWeek: a?.endWeek ?? totalWeeks }],
          totalWeeks,
          weekEndFracs,
        );
      }
      return { lineageKey: c.lineageKey, name: c.name, weightPct, weekly };
    });
  }

  const weekly = cumulativeFromWeeklyRows(
    rows.map((r) => r.weekly),
    totalWeeks,
  );
  const invalid = validateBaselinePoints(weekly);
  if (invalid) throw new Error(invalid);

  const active = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      scheduleItems: { select: { lineageKey: true, weekly: true } },
    },
  });
  const unchanged =
    !!active &&
    active.rabRevisionId === base.revisionId &&
    active.points.length === weekly.length &&
    active.points.every((p, i) => Math.abs(Number(p.plannedPct) - weekly[i]) < 0.005) &&
    active.scheduleItems.length === rows.length &&
    rows.every((r) => {
      const prev = active.scheduleItems.find((x) => x.lineageKey === r.lineageKey);
      if (!prev) return false;
      const pw = asWeekly(prev.weekly);
      return pw.length === r.weekly.length && pw.every((v, i) => Math.abs(v - r.weekly[i]) < 0.005);
    });

  return {
    weekly,
    rows,
    matched,
    mode,
    verbatim,
    totalWeeks,
    contractDays,
    revisionId: base.revisionId,
    jumlahKategori: base.categories.length,
    aktif: active
      ? {
          baselineNo: active.baselineNo,
          points: active.points.map((p) => Number(p.plannedPct)),
        }
      : null,
    unchanged,
  };
}

export async function saveCategoryWeekly(
  locationId: string,
  input: { lineageKey: string; weekly: number[] }[],
  userId: string,
  note: string,
  mode: ModeJadwal = "apaadanya",
) {
  const h = await hitungJadwalBaru(locationId, input, mode);
  const { weekly, rows, matched, verbatim, totalWeeks: _tw, contractDays, revisionId } = h;
  void _tw;

  if (h.unchanged && h.aktif) {
    return { baselineNo: h.aktif.baselineNo, unchanged: true as const, matched, mode, verbatim };
  }

  const baseline = await db.$transaction(async (tx) => {
    await tx.baseline.updateMany({
      where: { locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    const last = await tx.baseline.aggregate({ where: { locationId }, _max: { baselineNo: true } });
    const created = await tx.baseline.create({
      data: {
        locationId,
        baselineNo: (last._max.baselineNo ?? 0) + 1,
        source: "manual",
        status: "aktif",
        rabRevisionId: revisionId,
        contractDays,
        note,
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
        weekly: r.weekly,
      })),
    });
    return created;
  });
  await audit(userId, "baseline.import", "baseline", baseline.id, {
    locationId,
    baselineNo: baseline.baselineNo,
    categories: rows.length,
    matched,
    weeks: weekly.length,
    // Modenya DICATAT: baseline "apa adanya" boleh berbeda dari bobot RAB, jadi
    // pembaca angka itu nanti harus bisa tahu bahwa itu pilihan, bukan bug.
    mode,
    totalExcel: verbatim ? Math.round(verbatim.totalExcel * 1000) / 1000 : undefined,
    diskalakan: verbatim ? verbatim.faktorSkala !== 1 : undefined,
    tanpaJadwal: verbatim?.tanpaJadwal.length,
    bedaDariRab: verbatim?.selisihBobot.length,
  });
  return { baselineNo: baseline.baselineNo, unchanged: false as const, matched, mode, verbatim };
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
        select: { lineageKey: true, name: true, weightPct: true, weekly: true },
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
        data: src.scheduleItems.map((s) => ({
          baselineId: created.id,
          lineageKey: s.lineageKey,
          name: s.name,
          weightPct: s.weightPct,
          weekly: asWeekly(s.weekly),
        })),
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
 * Deret kurva-S lokasi: plan dari baseline aktif, realisasi dari VOLUME item
 * laporan counted × bobot revisi aktif, dibatasi 100% per item
 * (`lib/progress-calc.ts`, DECISIONS 151). Bucket minggu
 * = floor((reportDate − startDate) / 7 hari) + 1.
 *
 * Basisnya WAJIB sama dengan `lib/progress` dan `lib/periodic-report` — kurva
 * ini tampil di ringkasan lokasi & halaman Progress, sementara kurva laporan
 * mingguan tampil di blanko KKP. Dua kurva berbeda untuk lokasi yang sama
 * adalah cacat, bukan sudut pandang.
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
      select: { package: { select: { contract: { select: { startDate: true, weekMode: true } } } } },
    }),
  ]);

  if (!baseline || baseline.points.length === 0) {
    return { totalWeeks: 0, currentWeek: 1, planPct: [], actualPct: [], grandTotal: 0n };
  }

  const planPct = baseline.points.map((p) => Number(p.plannedPct));
  const totalWeeks = planPct.length;
  // startDate kontrak = minggu-1; fallback tanggal baseline dibuat (lokasi tanpa kontrak).
  const startDate = loc?.package.contract?.startDate ?? baseline.createdAt;
  const weekMode = loc?.package.contract?.weekMode ?? "tujuh_hari";
  const currentWeek = currentWeekNumber(startDate, totalWeeks, new Date(), weekMode);

  let grandTotal = 0n;
  /** Volume mingguan per lineage — hanya item yang benar-benar dilaporkan. */
  const weeklyVolume = new Map<string, number[]>();
  /** volume kontrak + bobot per lineage item revisi aktif. */
  const basis = new Map<string, { volK: number; bobot: number }>();
  if (revision) {
    const [catAgg, itemNodes] = await Promise.all([
      db.rabNode.aggregate({
        where: { revisionId: revision.id, kind: "kategori" },
        _sum: { amount: true },
      }),
      db.rabNode.findMany({
        where: { revisionId: revision.id, kind: "item" },
        select: { lineageKey: true, volume: true, amount: true },
      }),
    ]);
    grandTotal = catAgg._sum.amount ?? 0n;
    const total = Number(grandTotal);
    for (const nd of itemNodes) {
      basis.set(nd.lineageKey, {
        volK: nd.volume != null ? Number(nd.volume) : 0,
        bobot: bobotPct(Number(nd.amount), total),
      });
    }

    const rows = await db.dailyReportItem.findMany({
      where: {
        // Kurva-S realisasi = angka resmi ⇒ HANYA laporan terhadap RAB aktif
        // (DECISIONS 210/211). Menyaring lineageKey ke revisi aktif saja tidak
        // cukup: item yang volumenya diubah adendum ADA di kedua revisi, jadi
        // baris basis draft akan ikut menaikkan kurva realisasi tanpa dasar
        // kontrak. (`basis` di sini kunci kolom, bukan Map bobot di atas.)
        basis: "aktif",
        report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
        lineageKey: { in: [...basis.keys()] },
      },
      select: { lineageKey: true, volumeDone: true, report: { select: { reportDate: true } } },
    });
    for (const r of rows) {
      const wk = weekOfDate(startDate, r.report.reportDate, weekMode);
      const idx = Math.max(1, Math.min(wk, totalWeeks)) - 1;
      let arr = weeklyVolume.get(r.lineageKey);
      if (!arr) {
        arr = new Array<number>(totalWeeks).fill(0);
        weeklyVolume.set(r.lineageKey, arr);
      }
      arr[idx] += Number(r.volumeDone);
    }
  }

  // Kumulatif per item lebih dulu, baru dibatasi 100% dan dikali bobot —
  // urutan ini yang membuat angkanya sama dengan blanko KKP.
  const cumPct = new Array<number>(totalWeeks).fill(0);
  for (const [lineageKey, arr] of weeklyVolume) {
    const b = basis.get(lineageKey);
    if (!b) continue;
    let cum = 0;
    for (let w = 0; w < totalWeeks; w++) {
      cum += arr[w];
      cumPct[w] += (prestasiPct(cum, b.volK) / 100) * b.bobot;
    }
  }
  const actualPct: (number | null)[] = cumPct.map((v, i) => (i + 1 <= currentWeek ? v : null));

  return { totalWeeks, currentWeek, planPct, actualPct, grandTotal };
}
