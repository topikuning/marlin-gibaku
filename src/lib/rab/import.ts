import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { flattenParsedRab, grandTotal, type FlatNode } from "@/lib/rab/flatten";
import type { ParsedRab } from "@/lib/rab/parsed";
import { DEFAULT_CONTRACT_DAYS, weeklyFromSegments } from "@/lib/scurve/generate";
import { autoCategoryWindowFrac, cumulativeFromCategoryWeekly, scheduleFromItems } from "@/lib/scurve/sequencing";
import type { BaselineSource, RabRevisionSource } from "@/generated/prisma/enums";

/**
 * Import RAB → revisi baru (draft) → aktivasi → regenerate baseline.
 * Semantik dipertahankan dari b6e77af src/lib/rab-import.ts + scurve-plan.ts.
 *
 * LINEAGE CARRY-OVER (penting): di skema baru, `lineageKey` node adalah path
 * kode yang deterministik dari flattenParsedRab ("I#6.1#a"). Node revisi baru
 * yang path kodenya identik dengan revisi lama otomatis punya lineageKey yang
 * SAMA — carry-over terjadi *by construction*, tidak perlu mapping eksplisit
 * seperti lineageId lama (b6e77af getPriorLineageMap by `roman#code`).
 * Realisasi (DailyReportItem.lineageKey) tetap nyambung lintas revisi karena
 * layer progress (lib/progress, lib/baseline) mencocokkan by lineage_key
 * terhadap node revisi AKTIF, bukan by rabNodeId.
 * Fungsi ini hanya MENGHITUNG berapa lineage item yang identik dgn revisi
 * aktif sebelumnya (carriedItemLineages) untuk dilaporkan ke user.
 */

const DAY_MS = 24 * 3600 * 1000;

export type CreateRevisionOpts = {
  source: RabRevisionSource;
  amendmentId?: string | null;
  note?: string | null;
  userId: string;
};

export type CreateRevisionResult = {
  revisionId: string;
  revisionNo: number;
  nodeCount: number;
  itemCount: number;
  totalValue: bigint;
  /** Item revisi baru yang lineage-nya identik dgn revisi aktif sebelumnya. */
  carriedItemLineages: number;
};

/**
 * Buat revisi RAB status **draft** dari hasil parse HPS. Insert node per-level
 * (pola sama dgn prisma/seed.ts) supaya parentId terisi via map lineageKey.
 * Non-transaksional (ribuan node) tapi AMAN: draft tidak terlihat di mana pun
 * sampai activateRevision() dipanggil.
 */
export async function createRevisionFromParsed(
  locationId: string,
  parsed: ParsedRab,
  opts: CreateRevisionOpts,
): Promise<CreateRevisionResult> {
  return createRevisionFromNodes(locationId, flattenParsedRab(parsed), opts);
}

/**
 * Versi yang menerima `FlatNode[]` langsung — dipakai jalur impor yang tidak
 * melewati `hps-parser`, yaitu TEMPLATE KERJA ADENDUM (DECISIONS 216). Isi
 * fungsinya sama persis; yang berbeda hanya dari mana node-nya berasal.
 */
export async function createRevisionFromNodes(
  locationId: string,
  nodes: FlatNode[],
  opts: CreateRevisionOpts,
): Promise<CreateRevisionResult> {
  if (nodes.length === 0) throw new Error("Tidak ada node RAB terbaca dari file.");
  const totalValue = grandTotal(nodes);

  // Hitung carry-over vs revisi aktif (informasional — lihat doc di atas).
  const prior = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  let carriedItemLineages = 0;
  if (prior) {
    const priorItems = await db.rabNode.findMany({
      where: { revisionId: prior.id, kind: "item" },
      select: { lineageKey: true },
    });
    const priorKeys = new Set(priorItems.map((n) => n.lineageKey));
    carriedItemLineages = nodes.filter(
      (n) => n.kind === "item" && priorKeys.has(n.lineageKey),
    ).length;
  }

  const maxRev = await db.rabRevision.aggregate({
    where: { locationId },
    _max: { revisionNo: true },
  });
  const revisionNo = (maxRev._max.revisionNo ?? 0) + 1;

  const revision = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo,
      source: opts.source,
      amendmentId: opts.amendmentId ?? null,
      status: "draft",
      totalValue,
      note: opts.note ?? null,
      createdById: opts.userId,
    },
  });

  // Insert per-level: batch node yang parent-nya sudah ada (pola seed.ts).
  const idByKey = new Map<string, string>();
  const pending = [...nodes];
  while (pending.length > 0) {
    const batch = pending.filter(
      (n) => n.parentLineageKey === null || idByKey.has(n.parentLineageKey),
    );
    if (batch.length === 0) {
      // Tidak boleh terjadi (flatten selalu emit parent sebelum anak) — bersihkan draft.
      await db.rabRevision.delete({ where: { id: revision.id } });
      throw new Error("Struktur RAB tidak konsisten (orphan node).");
    }
    const created = await db.rabNode.createManyAndReturn({
      data: batch.map((n) => ({
        revisionId: revision.id,
        parentId: n.parentLineageKey ? idByKey.get(n.parentLineageKey)! : null,
        kind: n.kind,
        code: n.code,
        name: n.name,
        volume: n.volume,
        unit: n.unit,
        unitPrice: n.unitPrice,
        amount: n.amount,
        lineageKey: n.lineageKey,
        sortOrder: n.sortOrder,
      })),
      select: { id: true, lineageKey: true },
    });
    for (const c of created) idByKey.set(c.lineageKey, c.id);
    for (const b of batch) pending.splice(pending.indexOf(b), 1);
  }

  await audit(opts.userId, "rab.revision_create", "rab_revision", revision.id, {
    locationId,
    revisionNo,
    source: opts.source,
    nodeCount: nodes.length,
    totalValue,
    carriedItemLineages,
  });

  return {
    revisionId: revision.id,
    revisionNo,
    nodeCount: nodes.length,
    itemCount: nodes.filter((n) => n.kind === "item").length,
    totalValue,
    carriedItemLineages,
  };
}

/** Aktivasi atomik: revisi aktif lama → digantikan (+supersededAt), draft → aktif. */
export async function activateRevision(revisionId: string, userId: string) {
  const activated = await db.$transaction(async (tx) => {
    const rev = await tx.rabRevision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { id: true, locationId: true, status: true, revisionNo: true },
    });
    if (rev.status !== "draft") {
      throw new Error(`Revisi #${rev.revisionNo} bukan draft (status: ${rev.status}).`);
    }
    await tx.rabRevision.updateMany({
      where: { locationId: rev.locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    return tx.rabRevision.update({
      where: { id: rev.id },
      data: { status: "aktif" },
    });
  });
  await audit(userId, "rab.revision_activate", "rab_revision", activated.id, {
    locationId: activated.locationId,
    revisionNo: activated.revisionNo,
  });
  return activated;
}

/** Hapus draft + seluruh node-nya (cascade FK). Hanya draft yang boleh dibuang. */
export async function discardDraft(revisionId: string, userId: string) {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { id: true, status: true, revisionNo: true, locationId: true },
  });
  if (rev.status !== "draft") {
    throw new Error(`Revisi #${rev.revisionNo} bukan draft – tidak boleh dihapus.`);
  }
  await db.rabRevision.delete({ where: { id: rev.id } });
  await audit(userId, "rab.revision_discard", "rab_revision", rev.id, {
    locationId: rev.locationId,
    revisionNo: rev.revisionNo,
  });
  return rev;
}

/** Masa pelaksanaan (hari) dari kontrak paket lokasi; fallback 150. */
export async function contractDaysFor(locationId: string): Promise<number> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: { package: { select: { contract: { select: { durationDays: true } } } } },
  });
  const days = loc?.package.contract?.durationDays ?? 0;
  return days > 0 ? days : DEFAULT_CONTRACT_DAYS;
}

export type RegenerateBaselineOpts = {
  source: BaselineSource;
  /** Default: revisi aktif lokasi. */
  rabRevisionId?: string | null;
  note?: string | null;
  userId: string;
};

/**
 * Supersede baseline aktif → buat Baseline baru + BaselinePoints dari
 * scheduleItems (leaf item revisi, pembobotan per-trade — semantik
 * createAutoPlan lama, b6e77af scurve-plan.ts DECISIONS 027/028).
 */
export async function regenerateBaseline(locationId: string, opts: RegenerateBaselineOpts) {
  const revisionId =
    opts.rabRevisionId ??
    (
      await db.rabRevision.findFirst({
        where: { locationId, status: "aktif" },
        select: { id: true },
      })
    )?.id;
  if (!revisionId) throw new Error("Tidak ada revisi RAB aktif untuk membuat baseline.");

  const nodes = await db.rabNode.findMany({
    where: { revisionId, kind: { in: ["kategori", "item"] } },
    select: { kind: true, name: true, amount: true, lineageKey: true },
    orderBy: { sortOrder: "asc" },
  });

  const contractDays = await contractDaysFor(locationId);
  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));

  // JADWAL BERBASIS ITEM (DECISIONS 082) = sumber tunggal. Tiap item RAB
  // ditempatkan menurut TAHAP-nya, bersarang di jendela PRESEDENSI kategori
  // (auto). Profil kategori = Σ item (sesuai metode, bukan rata/lonceng generik);
  // kurva agregat & tabel KKP & saran mingguan semua turun dari sini.
  const catNodes = nodes.filter((n) => n.kind === "kategori");
  const catKeys = catNodes
    .map((n) => ({ key: n.lineageKey, name: n.name }))
    .sort((a, b) => b.key.length - a.key.length);
  // Identitas kategori = lineageKey-nya, BUKAN nama (CALC-04): dua unit boleh
  // bernama sama pada satu revisi dan ganti nama tidak boleh menggeser jadwal.
  const categoryOf = (lineageKey: string): { key: string; name: string } =>
    catKeys.find((c) => lineageKey === c.key || lineageKey.startsWith(`${c.key}#`)) ?? { key: "", name: "" };
  const items = nodes
    .filter((n) => n.kind === "item" && n.amount > 0n)
    .map((n) => {
      const cat = categoryOf(n.lineageKey);
      return { name: n.name, categoryKey: cat.key, categoryName: cat.name, amount: n.amount };
    });

  // Jendela presedensi per kategori DALAM BASIS MINGGU (disimpan = handle editor
  // & sumber rekonstruksi report). Kurva diturunkan dari jendela yang SAMA →
  // grafik == tabel KKP == deviasi persis.
  const grandCat = catNodes.reduce((s, c) => s + (c.amount > 0n ? Number(c.amount) : 0), 0) || 1;
  const catWindowWeeks = new Map<string, [number, number]>();
  for (const c of catNodes) {
    const [cs, ce] = autoCategoryWindowFrac(c.name);
    const sWeek = Math.max(1, Math.min(totalWeeks, Math.floor(cs * totalWeeks) + 1));
    const eWeek = Math.max(sWeek, Math.min(totalWeeks, Math.ceil(ce * totalWeeks)));
    catWindowWeeks.set(c.lineageKey, [sWeek, eWeek]);
  }
  const winFrac = (_name: string, key?: string): [number, number] => {
    const [s, e] = catWindowWeeks.get(key ?? "") ?? [1, totalWeeks];
    return [(s - 1) / totalWeeks, e / totalWeeks];
  };

  const sched = scheduleFromItems(items, contractDays, winFrac);
  const weekly = cumulativeFromCategoryWeekly(sched.categories, totalWeeks);

  // Matriks mingguan per kategori (bentuk kanonik, DECISIONS 103): dari jadwal
  // berbasis item bila kategori punya item; fallback lonceng jendela kategori.
  const weeklyByKey = new Map(sched.categories.map((c) => [c.categoryKey, c.weekly]));
  const schedule = catNodes
    .filter((c) => c.amount > 0n)
    .map((c) => {
      const [sWeek, eWeek] = catWindowWeeks.get(c.lineageKey) ?? [1, totalWeeks];
      const weightPct = (Number(c.amount) / grandCat) * 100;
      const catWeekly =
        weeklyByKey.get(c.lineageKey) ??
        weeklyFromSegments(weightPct, [{ startWeek: sWeek, endWeek: eWeek }], totalWeeks);
      return {
        lineageKey: c.lineageKey,
        name: c.name,
        weightPct,
        weekly: catWeekly,
      };
    });

  // IDEMPOTENT: bila hasil hitung identik dengan baseline aktif (revisi, durasi,
  // dan seluruh titik sama), JANGAN buat versi baru — menekan "Hitung ulang"
  // berulang tanpa ada perubahan tidak boleh menumpuk riwayat.
  const active = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      _count: { select: { scheduleItems: true } },
    },
  });
  if (
    active &&
    active.rabRevisionId === revisionId &&
    active.contractDays === contractDays &&
    active._count.scheduleItems === schedule.length &&
    active.points.length === weekly.length &&
    active.points.every((p, i) => Math.abs(Number(p.plannedPct) - weekly[i]) < 0.005)
  ) {
    const { points: _points, _count: _c, ...rest } = active;
    return { ...rest, unchanged: true as const };
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
    const baseline = await tx.baseline.create({
      data: {
        locationId,
        baselineNo: (last._max.baselineNo ?? 0) + 1,
        source: opts.source,
        status: "aktif",
        rabRevisionId: revisionId,
        contractDays,
        note: opts.note ?? null,
        createdById: opts.userId,
      },
    });
    await tx.baselinePoint.createMany({
      data: weekly.map((pctVal, i) => ({
        baselineId: baseline.id,
        weekNumber: i + 1,
        plannedPct: pctVal,
      })),
    });
    if (schedule.length > 0) {
      await tx.baselineScheduleItem.createMany({
        data: schedule.map((s) => ({
          baselineId: baseline.id,
          lineageKey: s.lineageKey,
          name: s.name,
          weightPct: Math.round(s.weightPct * 1000) / 1000,
          weekly: s.weekly.map((v) => Math.round(v * 1e6) / 1e6),
        })),
      });
    }
    return baseline;
  });
  await audit(opts.userId, "baseline.regenerate", "baseline", baseline.id, {
    locationId,
    baselineNo: baseline.baselineNo,
    source: opts.source,
    rabRevisionId: revisionId,
    contractDays,
    weeks: weekly.length,
  });
  return { ...baseline, unchanged: false as const };
}
