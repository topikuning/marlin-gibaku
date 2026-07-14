import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canTransitionReport } from "@/lib/lifecycle";
import { cumulativeVolumeByLineage, getLocationProgress, COUNTED_REPORT_STATUSES } from "@/lib/progress";
import { valueDone as calcValueDone } from "@/lib/money";
import { formatNumber, jakartaDateKey, parseDateKey } from "@/lib/format";
import { Prisma } from "@/generated/prisma/client";
import type {
  DailyReportStatus,
  IssueSeverity,
  WeatherCode,
  WorkerRole,
} from "@/generated/prisma/enums";
import { VOLUME_EPSILON } from "./constants";

/**
 * Logika inti laporan harian TERPADU (satu entitas menggantikan 4 menu lama).
 * Semua transisi status HANYA lewat fungsi di file ini:
 *   validasi canTransitionReport + DailyReportStatusHistory dalam $transaction,
 *   lalu audit() (helper non-transaksional by design — gagal audit tidak
 *   menggagalkan aksi utama).
 *
 * Otorisasi (requireCapability / requireLocationAccess) dilakukan di
 * actions.ts — file ini menerima userId eksplisit supaya bisa diuji langsung.
 *
 * Perbaikan bug lama: reportDate SELALU tanggal kerja dari parameter saat
 * draft dibuat, dan TIDAK PERNAH disentuh lagi oleh transisi mana pun
 * (dulu tanggal ikut waktu approve).
 */

export class DailyReportError extends Error {}

const EDITABLE_STATUSES: DailyReportStatus[] = ["draft", "perlu_koreksi"];
const ENRICHABLE_STATUSES: DailyReportStatus[] = ["draft", "perlu_koreksi", "dikirim"];

async function getReportOrThrow(reportId: string) {
  const report = await db.dailyReport.findUnique({
    where: { id: reportId },
    include: { location: { select: { id: true, slug: true, name: true } } },
  });
  if (!report) throw new DailyReportError("Laporan tidak ditemukan");
  return report;
}

/**
 * Ambil laporan (lokasi, tanggal) atau buat draft baru.
 * Hanya tanggal ≤ hari ini (Asia/Jakarta). Anti-double lewat uniq DB
 * (locationId, reportDate) — race pembuatan paralel di-recover dengan refetch.
 */
export async function getOrCreateDraft(locationId: string, dateKey: string, userId: string) {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) throw new DailyReportError("Format tanggal tidak valid");
  if (dateKey > jakartaDateKey(new Date())) {
    throw new DailyReportError("Tidak bisa membuat laporan untuk tanggal yang belum terjadi");
  }

  const existing = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId, reportDate } },
  });
  if (existing) return existing;

  try {
    const created = await db.$transaction(async (tx) => {
      const report = await tx.dailyReport.create({
        data: { locationId, reportDate, status: "draft", createdById: userId },
      });
      await tx.dailyReportStatusHistory.create({
        data: { reportId: report.id, fromStatus: null, toStatus: "draft", changedById: userId },
      });
      return report;
    });
    await audit(userId, "daily_report.create", "daily_report", created.id, { locationId, dateKey });
    return created;
  } catch (err) {
    // Race double-submit: baris sudah dibuat request lain → pakai yang ada.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.dailyReport.findUnique({
        where: { locationId_reportDate: { locationId, reportDate } },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

export type UpsertItemInput = {
  rabNodeId: string;
  volumeDone: number;
  notes?: string | null;
};

/**
 * Tambah/ubah item laporan. Idempotent & anti-dobel via uniq (reportId, lineageKey).
 * lineageKey + valueDone diturunkan dari RabNode revisi AKTIF (node revisi
 * non-aktif ditolak). Guard kumulatif: Σ volume counted lineage (di luar
 * kontribusi report ini) + volumeDone ≤ volume RAB + epsilon.
 */
export async function upsertItem(reportId: string, input: UpsertItemInput, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!EDITABLE_STATUSES.includes(report.status)) {
    throw new DailyReportError("Item hanya bisa diubah saat laporan berstatus Draft atau Perlu Koreksi");
  }
  if (!Number.isFinite(input.volumeDone) || input.volumeDone <= 0) {
    throw new DailyReportError("Volume harus lebih dari 0");
  }
  const volumeDone = Math.round(input.volumeDone * 1000) / 1000; // presisi kolom Decimal(15,3)

  const node = await db.rabNode.findUnique({
    where: { id: input.rabNodeId },
    include: { revision: { select: { status: true, locationId: true } } },
  });
  if (!node || node.kind !== "item") throw new DailyReportError("Item RAB tidak ditemukan");
  if (node.revision.locationId !== report.locationId) {
    throw new DailyReportError("Item RAB bukan milik lokasi laporan ini");
  }
  if (node.revision.status !== "aktif") {
    throw new DailyReportError("Item RAB berasal dari revisi yang tidak aktif — muat ulang halaman");
  }

  // Guard volume kumulatif ≤ volume RAB.
  const nodeVolume = node.volume != null ? Number(node.volume) : null;
  if (nodeVolume != null) {
    const cumulative = (await cumulativeVolumeByLineage(report.locationId)).get(node.lineageKey) ?? 0;
    // Kontribusi report INI dikeluarkan dulu (defensif; status editable memang tidak counted).
    let ownContribution = 0;
    if ((COUNTED_REPORT_STATUSES as readonly string[]).includes(report.status)) {
      const own = await db.dailyReportItem.findUnique({
        where: { reportId_lineageKey: { reportId, lineageKey: node.lineageKey } },
        select: { volumeDone: true },
      });
      ownContribution = own ? Number(own.volumeDone) : 0;
    }
    const others = cumulative - ownContribution;
    if (others + volumeDone > nodeVolume + VOLUME_EPSILON) {
      const sisa = Math.max(0, Math.round((nodeVolume - others) * 1000) / 1000);
      throw new DailyReportError(
        `Volume melebihi sisa RAB. Sisa yang masih bisa dilaporkan: ${formatNumber(sisa)} ${node.unit ?? ""}`.trim(),
      );
    }
  }

  const valueDone = calcValueDone(volumeDone, node.unitPrice != null ? Number(node.unitPrice) : 0);
  const notes = input.notes?.trim() || null;

  const item = await db.dailyReportItem.upsert({
    where: { reportId_lineageKey: { reportId, lineageKey: node.lineageKey } },
    update: { rabNodeId: node.id, volumeDone, valueDone, notes, reportedById: userId },
    create: {
      reportId,
      rabNodeId: node.id,
      lineageKey: node.lineageKey,
      volumeDone,
      valueDone,
      notes,
      reportedById: userId,
    },
  });
  await audit(userId, "daily_report.item_upsert", "daily_report_item", item.id, {
    reportId,
    lineageKey: node.lineageKey,
    volumeDone,
    valueDone,
  });
  return item;
}

/** Hapus item saat draft/perlu_koreksi. Foto item tetap menempel di laporan. */
export async function removeItem(reportId: string, itemId: string, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!EDITABLE_STATUSES.includes(report.status)) {
    throw new DailyReportError("Item hanya bisa dihapus saat laporan berstatus Draft atau Perlu Koreksi");
  }
  const item = await db.dailyReportItem.findUnique({ where: { id: itemId } });
  if (!item || item.reportId !== reportId) throw new DailyReportError("Item tidak ditemukan di laporan ini");

  await db.$transaction(async (tx) => {
    // Foto bukti tidak ikut hilang — lepaskan dari item, biarkan di laporan.
    await tx.photo.updateMany({ where: { reportItemId: itemId }, data: { reportItemId: null } });
    await tx.dailyReportItem.delete({ where: { id: itemId } });
  });
  await audit(userId, "daily_report.item_remove", "daily_report_item", itemId, {
    reportId,
    lineageKey: item.lineageKey,
  });
}

export type EnrichmentInput = {
  weather: WeatherCode | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  workers: { role: WorkerRole; count: number }[];
  materials: { name: string; unit: string | null; qty: number | null }[];
  equipment: { name: string; count: number }[];
};

/**
 * Simpan pelengkap KKP (cuaca, jam kerja, tenaga, material, alat).
 * Wipe + recreate anak dalam satu $transaction. Boleh saat
 * draft/perlu_koreksi/dikirim (SM melengkapi saat verifikasi).
 */
export async function setEnrichment(reportId: string, input: EnrichmentInput, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!ENRICHABLE_STATUSES.includes(report.status)) {
    throw new DailyReportError("Pelengkap laporan tidak bisa diubah setelah laporan disetujui");
  }

  const workers = input.workers.filter((w) => Number.isFinite(w.count) && w.count > 0);
  const materials = input.materials.filter((m) => m.name.trim().length > 0);
  const equipment = input.equipment.filter((e) => e.name.trim().length > 0 && e.count > 0);

  await db.$transaction(async (tx) => {
    await tx.dailyReport.update({
      where: { id: reportId },
      data: {
        weather: input.weather,
        workStart: input.workStart?.trim() || null,
        workEnd: input.workEnd?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    await tx.dailyReportWorker.deleteMany({ where: { reportId } });
    if (workers.length) {
      await tx.dailyReportWorker.createMany({
        data: workers.map((w) => ({ reportId, role: w.role, count: Math.round(w.count) })),
      });
    }
    await tx.dailyReportMaterial.deleteMany({ where: { reportId } });
    if (materials.length) {
      await tx.dailyReportMaterial.createMany({
        data: materials.map((m) => ({
          reportId,
          name: m.name.trim(),
          unit: m.unit?.trim() || null,
          qtyReceived: m.qty != null && Number.isFinite(m.qty) ? Math.round(m.qty * 1000) / 1000 : null,
        })),
      });
    }
    await tx.dailyReportEquipment.deleteMany({ where: { reportId } });
    if (equipment.length) {
      await tx.dailyReportEquipment.createMany({
        data: equipment.map((e) => ({ reportId, name: e.name.trim(), count: Math.round(e.count) })),
      });
    }
  });
  await audit(userId, "daily_report.enrich", "daily_report", reportId, {
    weather: input.weather,
    workers: workers.length,
    materials: materials.length,
    equipment: equipment.length,
  });
}

/** Transisi generik: validasi lifecycle + update + history APPEND-ONLY dalam satu $transaction. */
async function transition(
  reportId: string,
  to: DailyReportStatus,
  userId: string,
  extra: Prisma.DailyReportUpdateInput,
  reason?: string | null,
) {
  const report = await getReportOrThrow(reportId);
  if (!canTransitionReport(report.status, to)) {
    throw new DailyReportError(`Transisi status ${report.status} → ${to} tidak diizinkan`);
  }
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.dailyReport.update({
      where: { id: reportId, status: report.status }, // optimistic lock: status tidak berubah di tengah
      data: { status: to, ...extra },
    });
    await tx.dailyReportStatusHistory.create({
      data: {
        reportId,
        fromStatus: report.status,
        toStatus: to,
        changedById: userId,
        reason: reason?.trim() || null,
      },
    });
    return row;
  });
  return { report, updated };
}

/** draft | perlu_koreksi → dikirim. Wajib ≥1 item. */
export async function submitReport(reportId: string, userId: string) {
  const itemCount = await db.dailyReportItem.count({ where: { reportId } });
  if (itemCount === 0) {
    throw new DailyReportError("Laporan belum punya item pekerjaan — tambah minimal satu");
  }
  const { updated } = await transition(reportId, "dikirim", userId, {
    submittedById: userId,
    submittedAt: new Date(),
  });
  await audit(userId, "daily_report.submit", "daily_report", reportId, { items: itemCount });
  return updated;
}

/** dikirim → perlu_koreksi. Alasan WAJIB — SM lapangan harus tahu apa yang salah. */
export async function returnReport(reportId: string, reason: string, userId: string) {
  if (!reason || reason.trim().length === 0) {
    throw new DailyReportError("Alasan pengembalian wajib diisi");
  }
  const { updated } = await transition(reportId, "perlu_koreksi", userId, {}, reason);
  await audit(userId, "daily_report.return", "daily_report", reportId, { reason: reason.trim() });
  return updated;
}

/** dikirim → disetujui. */
export async function approveReport(reportId: string, userId: string) {
  const { updated } = await transition(reportId, "disetujui", userId, {
    verifiedById: userId,
    verifiedAt: new Date(),
  });
  await audit(userId, "daily_report.approve", "daily_report", reportId);
  return updated;
}

/** Snapshot immutable untuk cetak — dibekukan saat finalisasi. */
export type FinalSnapshot = {
  version: 1;
  generatedAt: string;
  reportDate: string; // YYYY-MM-DD
  location: { name: string; slug: string; village: string; regency: string; province: string };
  weekNo: number | null;
  tahunAnggaran: number;
  weather: WeatherCode | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  items: {
    lineageKey: string;
    code: string;
    name: string;
    unit: string | null;
    volumeContract: number | null;
    volumeBefore: number; // s/d laporan lalu
    volumeToday: number; // hari ini
    volumeCumulative: number; // s/d hari ini
    pctCumulative: number | null;
    valueDone: string; // BigInt rupiah sebagai string
    notes: string | null;
  }[];
  totalValueToday: string;
  progress: {
    grandTotal: string;
    realizedValue: string;
    realizedPct: number;
    planPct: number;
    deviationPct: number;
  };
  workers: { role: WorkerRole; count: number }[];
  totalWorkers: number;
  materials: { name: string; unit: string | null; qty: number | null }[];
  equipment: { name: string; count: number }[];
  photos: {
    id: string;
    r2Key: string;
    thumbnailKey: string | null;
    takenAt: string | null;
    lat: number | null;
    lng: number | null;
  }[];
};

/** Bangun isi finalSnapshot dari data live (dipanggil saat finalisasi, status masih counted). */
export async function buildFinalSnapshot(reportId: string): Promise<FinalSnapshot> {
  const report = await db.dailyReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          slug: true,
          village: true,
          regency: true,
          province: true,
          package: { select: { contract: { select: { startDate: true } } } },
        },
      },
      items: { include: { rabNode: true }, orderBy: { createdAt: "asc" } },
      workers: true,
      materials: { orderBy: { name: "asc" } },
      equipment: { orderBy: { name: "asc" } },
      photos: { orderBy: { createdAt: "asc" } },
    },
  });

  const [cumulative, progress] = await Promise.all([
    cumulativeVolumeByLineage(report.locationId),
    getLocationProgress(report.locationId),
  ]);

  const dateKey = jakartaDateKey(report.reportDate);
  const startDate = report.location.package.contract?.startDate ?? null;
  const weekNo = startDate
    ? Math.max(1, Math.floor((report.reportDate.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1)
    : null;

  let totalValueToday = 0n;
  const items = report.items.map((it) => {
    const volumeToday = Number(it.volumeDone);
    const volumeCumulative = cumulative.get(it.lineageKey) ?? volumeToday;
    const volumeContract = it.rabNode.volume != null ? Number(it.rabNode.volume) : null;
    totalValueToday += it.valueDone;
    return {
      lineageKey: it.lineageKey,
      code: it.rabNode.code,
      name: it.rabNode.name,
      unit: it.rabNode.unit,
      volumeContract,
      volumeBefore: Math.max(0, Math.round((volumeCumulative - volumeToday) * 1000) / 1000),
      volumeToday,
      volumeCumulative,
      pctCumulative:
        volumeContract != null && volumeContract > 0 ? (volumeCumulative / volumeContract) * 100 : null,
      valueDone: it.valueDone.toString(),
      notes: it.notes,
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    reportDate: dateKey,
    location: {
      name: report.location.name,
      slug: report.location.slug,
      village: report.location.village,
      regency: report.location.regency,
      province: report.location.province,
    },
    weekNo,
    tahunAnggaran: (startDate ?? report.reportDate).getUTCFullYear(),
    weather: report.weather,
    workStart: report.workStart,
    workEnd: report.workEnd,
    notes: report.notes,
    items,
    totalValueToday: totalValueToday.toString(),
    progress: {
      grandTotal: progress.grandTotal.toString(),
      realizedValue: progress.realizedValue.toString(),
      realizedPct: progress.realizedPct,
      planPct: progress.planPct,
      deviationPct: progress.deviationPct,
    },
    workers: report.workers.map((w) => ({ role: w.role, count: w.count })),
    totalWorkers: report.workers.reduce((n, w) => n + w.count, 0),
    materials: report.materials.map((m) => ({
      name: m.name,
      unit: m.unit,
      qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
    })),
    equipment: report.equipment.map((e) => ({ name: e.name, count: e.count })),
    photos: report.photos.map((p) => ({
      id: p.id,
      r2Key: p.r2Key,
      thumbnailKey: p.thumbnailKey,
      takenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
      lat: p.exifGpsLat != null ? Number(p.exifGpsLat) : null,
      lng: p.exifGpsLng != null ? Number(p.exifGpsLng) : null,
    })),
  };
}

/** disetujui → final. Membekukan finalSnapshot lengkap untuk cetak. */
export async function finalizeReport(reportId: string, userId: string) {
  // Snapshot dibangun SEBELUM transisi — status disetujui sudah counted,
  // jadi kumulatif di snapshot sudah termasuk volume laporan ini.
  const current = await getReportOrThrow(reportId);
  if (!canTransitionReport(current.status, "final")) {
    throw new DailyReportError(`Transisi status ${current.status} → final tidak diizinkan`);
  }
  const snapshot = await buildFinalSnapshot(reportId);
  const { updated } = await transition(reportId, "final", userId, {
    finalizedById: userId,
    finalizedAt: new Date(),
    finalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
  });
  await audit(userId, "daily_report.finalize", "daily_report", reportId, {
    items: snapshot.items.length,
    totalValueToday: snapshot.totalValueToday,
  });
  return updated;
}

export type IssueInput = {
  title: string;
  description?: string | null;
  severity: IssueSeverity;
};

/** Catat kendala lapangan yang menempel ke laporan harian. */
export async function addIssueFromReport(reportId: string, input: IssueInput, userId: string) {
  const report = await getReportOrThrow(reportId);
  if (!input.title || input.title.trim().length === 0) {
    throw new DailyReportError("Judul kendala wajib diisi");
  }
  const issue = await db.issue.create({
    data: {
      locationId: report.locationId,
      reportId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      severity: input.severity,
      raisedById: userId,
    },
  });
  await audit(userId, "issue.create", "issue", issue.id, { reportId, severity: input.severity });
  return issue;
}
