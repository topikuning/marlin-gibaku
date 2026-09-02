import { totalWeeksBetween, weekEndFractions } from "@/lib/progress-calc";
import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { audit, auditIn } from "@/lib/audit";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import { valueDone as hitungNilai } from "@/lib/money";
import { sesuaikanProporsional } from "@/lib/rab/sesuaikan-realisasi";
import { flattenParsedRab, grandTotal, type FlatNode } from "@/lib/rab/flatten";
import type { ParsedRab } from "@/lib/rab/parsed";
import { DEFAULT_CONTRACT_DAYS, gridEndFrac, gridStartFrac, weekOfFracEnd, weekOfFracStart, weeklyFromSegments } from "@/lib/scurve/generate";
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
/**
 * Aktifkan revisi draft menjadi RAB kontrak yang berlaku.
 *
 * ### Laporan atas draft ikut NAIK menjadi resmi
 *
 * Laporan harian atas item yang hanya ada di draft adendum dibekukan
 * ber-`basis = "draft_adendum"` saat dikirim (DECISIONS 210: di lapangan
 * pekerjaan sering jalan lebih dulu dan adendumnya menyusul). Angka resmi hanya
 * menghitung `basis = "aktif"`.
 *
 * Sebelum ini tidak ada satu baris pun di seluruh repo yang menaikkan penanda
 * itu. Akibatnya pekerjaan yang dilaporkan atas draft tetap tidak terhitung
 * SELAMANYA setelah adendumnya sah lewat dua tanda tangan — tepat pada pekerjaan
 * yang adendum itu diadakan untuk melegalkannya. Item tampil 0%, dan terminnya
 * tidak bisa ditagih atas pekerjaan yang sudah punya dasar kontrak.
 *
 * Koreksi user 2026-09-01: *"kalau sudah diaktivasi dengan skema dua orang yang
 * sudah kita atur, ya otomatis aktif."* Yang dinaikkan hanya PENANDA basis —
 * volume, tanggal, nilai, dan status laporan tidak disentuh sama sekali, jadi
 * tidak ada isi laporan yang berubah. Jumlah baris yang naik ikut ke audit,
 * karena angka itulah yang menjelaskan lompatan progres pada saat aktivasi.
 */
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
    const naik = await tx.dailyReportItem.updateMany({
      where: { basis: "draft_adendum", rabNode: { revisionId: rev.id } },
      data: { basis: "aktif" },
    });
    const revisi = await tx.rabRevision.update({
      where: { id: rev.id },
      data: { status: "aktif" },
    });

    const disesuaikan = await sesuaikanRealisasiKeVolumeBaru(tx, rev.id, rev.locationId, userId);
    return { revisi, laporanDinaikkan: naik.count, disesuaikan };
  });
  await audit(userId, "rab.revision_activate", "rab_revision", activated.revisi.id, {
    locationId: activated.revisi.locationId,
    revisionNo: activated.revisi.revisionNo,
    // Berapa baris laporan yang ikut menjadi resmi. Angka ini yang menjelaskan
    // kenapa progres lokasi bisa melompat tepat pada saat aktivasi.
    laporanDinaikkan: activated.laporanDinaikkan,
    // Berapa ITEM yang realisasinya diturunkan mengikuti volume barunya.
    itemDisesuaikan: activated.disesuaikan,
  });
  return activated.revisi;
}

/**
 * Turunkan realisasi laporan harian yang MELEBIHI volume barunya.
 *
 * Permintaan user 2026-09-03: *"saat pemetaan manual itu konfirmasi, maka
 * laporan harian yang sebelumnya langsung menyesuaikan volume baru."*
 *
 * ### Kenapa DI SINI, bukan saat pemetaan dikonfirmasi
 *
 * Saat pemetaan dikonfirmasi, adendumnya masih DRAFT — belum ditandatangani
 * siapa pun. Mengubah laporan harian di titik itu menggerakkan progres resmi
 * dan nilai terpasang atas dasar adendum yang belum sah, persis yang dilarang
 * DECISIONS 210. Dan bila drafnya kemudian dibuang, laporan yang terlanjur
 * diubah tidak punya jalan pulang. Aktivasi adalah satu-satunya titik di mana
 * perubahan ini punya dasar.
 *
 * ### Ruang lingkupnya
 *
 * Bukan hanya item yang dipetakan manual: SETIAP item revisi baru yang volume
 * kontraknya kini di bawah realisasi tercatat. Sumber selisihnya tidak penting
 * — yang penting laporan dan kontrak menyebut angka yang sama.
 *
 * ### Yang TIDAK disentuh
 *
 * Item yang realisasinya masih di bawah volume baru, dan adendum yang MENAIKKAN
 * volume: `sesuaikanProporsional` mengembalikan `null` untuk keduanya, jadi
 * tidak ada baris yang ditulis ulang tanpa perlu.
 *
 * Laporan berstatus `final` IKUT disesuaikan (keputusan user 2026-09-03):
 * melewatinya hanya memindahkan ketidakcocokan, bukan menghilangkannya. Setiap
 * penyesuaian masuk audit log dengan angka sebelum dan sesudahnya.
 */
async function sesuaikanRealisasiKeVolumeBaru(
  tx: Prisma.TransactionClient,
  revisionId: string,
  locationId: string,
  userId: string,
): Promise<number> {
  const items = await tx.rabNode.findMany({
    where: { revisionId, kind: "item" },
    select: { lineageKey: true, code: true, name: true, volume: true, unitPrice: true },
  });
  if (items.length === 0) return 0;

  const baris = await tx.dailyReportItem.findMany({
    where: {
      lineageKey: { in: items.map((n) => n.lineageKey) },
      report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
    },
    select: {
      id: true,
      lineageKey: true,
      volumeDone: true,
      report: { select: { reportDate: true, status: true } },
    },
    // Urutan tetap: pembagian sisa terbesar harus deterministik supaya
    // aktivasi yang sama menghasilkan angka yang sama.
    orderBy: [{ report: { reportDate: "asc" } }, { id: "asc" }],
  });
  if (baris.length === 0) return 0;

  type Baris = (typeof baris)[number];
  const perLineage = new Map<string, Baris[]>();
  for (const b of baris) {
    const arr = perLineage.get(b.lineageKey);
    if (arr) arr.push(b);
    else perLineage.set(b.lineageKey, [b]);
  }

  let jumlahItem = 0;
  for (const n of items) {
    const rows = perLineage.get(n.lineageKey);
    if (!rows || n.volume == null) continue;
    const volumeBaru = Number(n.volume);
    const sebelum = rows.map((r) => Number(r.volumeDone));
    const sesudah = sesuaikanProporsional(sebelum, volumeBaru);
    if (!sesudah) continue;

    const harga = Number(n.unitPrice ?? 0);
    for (const [i, r] of rows.entries()) {
      if (sesudah[i] === sebelum[i]) continue;
      await tx.dailyReportItem.update({
        where: { id: r.id },
        // `valueDone` ikut dihitung ulang: ia dipakai layar harian dan snapshot
        // paparan. Membiarkannya dengan volume lama membuat dua angka berbeda
        // untuk satu baris yang sama.
        data: { volumeDone: sesudah[i]!, valueDone: hitungNilai(sesudah[i]!, harga) },
      });
    }
    jumlahItem++;
    await auditIn(tx, userId, "rab.adendum_sesuaikan_realisasi", "rab_revision", revisionId, {
      locationId,
      lineageKey: n.lineageKey,
      item: `${n.code} ${n.name}`,
      volumeBaru,
      totalSebelum: sebelum.reduce((t, v) => t + v, 0),
      totalSesudah: sesudah.reduce((t, v) => t + v, 0),
      baris: rows.map((r, i) => ({
        tanggal: r.report.reportDate.toISOString().slice(0, 10),
        status: r.report.status,
        dari: sebelum[i],
        ke: sesudah[i],
      })),
    });
  }
  return jumlahItem;
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

/**
 * Jumlah KOLOM MINGGU jadwal/baseline lokasi ini — mengikuti mode periode
 * minggu kontrak (user 2026-08-24):
 * - `tujuh_hari` / SPMK belum terbit → ceil(durasi/7) (perilaku lama).
 * - `senin_minggu` + SPMK ada → jumlah minggu kalender Senin–Minggu yang
 *   menutup [SPMK, akhir kontrak]; M1 bisa pendek, jadi jumlahnya bisa
 *   1 kolom lebih banyak daripada ceil(durasi/7).
 * Disatukan di sini supaya baseline, jadwal kategori, dan laporan periodik
 * menghitung kolom dengan aturan yang SAMA.
 */
export async function totalWeeksFor(locationId: string): Promise<{
  contractDays: number;
  totalWeeks: number;
  /**
   * Grid minggu tak-seragam untuk generator kurva-S (DECISIONS 427b) — hanya
   * terisi pada mode `senin_minggu` dengan SPMK+akhir kontrak diketahui.
   * null = grid seragam lama (mode `tujuh_hari` / SPMK belum terbit).
   */
  weekEndFracs: number[] | null;
}> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: {
      package: {
        select: {
          contract: { select: { durationDays: true, startDate: true, endDate: true, weekMode: true } },
        },
      },
    },
  });
  const c = loc?.package.contract;
  const contractDays = (c?.durationDays ?? 0) > 0 ? c!.durationDays : DEFAULT_CONTRACT_DAYS;
  if (c?.weekMode === "senin_minggu" && c.startDate && c.endDate) {
    const weekEndFracs = weekEndFractions(c.startDate, c.endDate, "senin_minggu");
    return { contractDays, totalWeeks: weekEndFracs.length, weekEndFracs };
  }
  return { contractDays, totalWeeks: Math.max(1, Math.ceil(contractDays / 7)), weekEndFracs: null };
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

  const { contractDays, totalWeeks, weekEndFracs } = await totalWeeksFor(locationId);

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
    // Pemetaan fraksi→minggu lewat grid: pada mode senin_minggu, M1 pendek
    // menempati fraksi hari yang lebih kecil (DECISIONS 427b).
    const sWeek = weekOfFracStart(cs, totalWeeks, weekEndFracs);
    const eWeek = Math.max(sWeek, weekOfFracEnd(ce, totalWeeks, weekEndFracs));
    catWindowWeeks.set(c.lineageKey, [sWeek, eWeek]);
  }
  const winFrac = (_name: string, key?: string): [number, number] => {
    const [s, e] = catWindowWeeks.get(key ?? "") ?? [1, totalWeeks];
    return [gridStartFrac(s, totalWeeks, weekEndFracs), gridEndFrac(e, totalWeeks, weekEndFracs)];
  };

  const sched = scheduleFromItems(items, contractDays, winFrac, weekEndFracs);
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
        weeklyFromSegments(weightPct, [{ startWeek: sWeek, endWeek: eWeek }], totalWeeks, weekEndFracs);
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
