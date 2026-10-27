import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireLocationAccess, type SessionUser } from "@/lib/auth/session";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { canTransitionWaUsulan } from "@/lib/lifecycle";
import type { PhotoView } from "@/lib/photos";

/**
 * USULAN DARI WHATSAPP – sisi aplikasi (DECISIONS 707).
 *
 * Volume dan foto pekerjaan yang dikirim lewat WA ditampung sebagai usulan
 * (`lib/waha/lapor.ts`). Di sini usulan itu DIPUTUS orang yang boleh mengisi
 * laporan: Masukkan (jadi baris laporan harian lewat jalur simpan yang sama
 * dengan aplikasi) atau Buang. Tidak ada jalan lain dari WA ke laporan.
 */

export class UsulanError extends Error {}

export type UsulanView = {
  id: string;
  lineageKey: string;
  namaPekerjaan: string;
  satuan: string | null;
  volume: number | null;
  photoIds: string[];
  /** Foto usulan yang masih di kantong (belum dipakai di tempat lain, belum dihapus). */
  fotos: PhotoView[];
  pengusul: string;
  diperbaruiAt: string;
  /** Volume pekerjaan ini yang SUDAH ada di laporan hari itu – akan diganti bila dimasukkan. */
  volumeDiLaporan: number | null;
  /** Pekerjaan ini masih ada di RAB yang berlaku. */
  masihDiRab: boolean;
};

/** Usulan yang masih menunggu untuk satu lokasi pada satu hari. */
export async function usulanMenunggu(locationId: string, dateKey: string): Promise<UsulanView[]> {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return [];
  const rows = await db.waUsulan.findMany({
    where: { locationId, reportDate, status: "menunggu" },
    orderBy: { updatedAt: "asc" },
    include: { diusulkanOleh: { select: { fullName: true } } },
  });
  if (rows.length === 0) return [];
  const [report, opsi, fotoRows] = await Promise.all([
    db.dailyReport.findUnique({
      where: { locationId_reportDate: { locationId, reportDate } },
      select: { items: { select: { lineageKey: true, volumeDone: true } } },
    }),
    pilihanPekerjaan(locationId),
    db.photo.findMany({
      where: { id: { in: rows.flatMap((r) => r.photoIds) }, reportId: null, activityId: null },
      select: {
        id: true,
        r2Key: true,
        thumbnailKey: true,
        uploadedById: true,
        exifTakenAt: true,
        exifGpsLat: true,
        exifGpsLng: true,
      },
    }),
  ]);
  const { buildPhotoViews } = await import("@/lib/photos");
  const fotoById = new Map((await buildPhotoViews(fotoRows)).map((f) => [f.id, f]));
  const diLaporan = new Map((report?.items ?? []).map((i) => [i.lineageKey, Number(i.volumeDone)]));
  const diRab = new Set(opsi.map((o) => o.lineageKey));
  return rows.map((r) => ({
    id: r.id,
    lineageKey: r.lineageKey,
    namaPekerjaan: r.namaPekerjaan,
    satuan: r.satuan,
    volume: r.volume != null ? Number(r.volume) : null,
    photoIds: r.photoIds,
    fotos: r.photoIds.map((id) => fotoById.get(id)).filter((f): f is PhotoView => !!f),
    pengusul: r.diusulkanOleh.fullName,
    diperbaruiAt: r.updatedAt.toISOString(),
    volumeDiLaporan: diLaporan.get(r.lineageKey) ?? null,
    masihDiRab: diRab.has(r.lineageKey),
  }));
}

async function pilihanPekerjaan(locationId: string) {
  const { getLeafNodeOptions } = await import("@/lib/daily-report/queries");
  return getLeafNodeOptions(locationId);
}

async function muatMenunggu(usulanId: string) {
  const u = await db.waUsulan.findUnique({ where: { id: usulanId } });
  if (!u) throw new UsulanError("Usulan tidak ditemukan.");
  if (u.status !== "menunggu") throw new UsulanError("Usulan ini sudah diputus sebelumnya.");
  return u;
}

/**
 * Masukkan usulan ke laporan harian hari itu.
 *
 * Pekerjaan yang dipakai: pilihan pemeriksa bila ada – nama yang diketik di WA
 * bisa saja dicocokkan ke pekerjaan yang keliru (DECISIONS 709) – selain itu
 * pekerjaan usulan. Volume yang dipakai: isian pemeriksa bila ada, selain itu
 * volume usulan. Angkanya selalu dalam satuan RAB pekerjaan yang DIPILIH; tidak
 * ada konversi satuan. Usulan foto saja boleh dimasukkan bila pekerjaannya
 * sudah ada di laporan – fotonya ditempel, volumenya tidak disentuh. Semua
 * aturan laporan (status, sisa RAB, lokasi dicabut) ditegakkan
 * `upsertItem`/`pakaiFotoKeTujuan` yang sama dengan aplikasi.
 */
export async function masukkanUsulan(
  actor: SessionUser,
  usulanId: string,
  volumeIsian: number | null,
  lineageKeyPilihan: string | null = null,
): Promise<{ volume: number | null; foto: number; gagalFoto: string | null }> {
  const u = await muatMenunggu(usulanId);
  await requireLocationAccess(actor, u.locationId);
  const dateKey = jakartaDateKey(u.reportDate);
  const tujuan = lineageKeyPilihan ?? u.lineageKey;
  const node = (await pilihanPekerjaan(u.locationId)).find((o) => o.lineageKey === tujuan);
  if (!node) {
    throw new UsulanError(
      tujuan === u.lineageKey
        ? `"${u.namaPekerjaan}" sudah tidak ada di RAB yang berlaku. Pilih pekerjaan lain, atau Buang usulan ini.`
        : "Pekerjaan yang dipilih tidak ada di RAB yang berlaku.",
    );
  }

  const { getOrCreateDraft, upsertItem } = await import("@/lib/daily-report/service");
  const volume = volumeIsian ?? (u.volume != null ? Number(u.volume) : null);
  const report = await getOrCreateDraft(u.locationId, dateKey, actor.id);
  const ada = await db.dailyReportItem.findUnique({
    where: { reportId_lineageKey: { reportId: report.id, lineageKey: node.lineageKey } },
    select: { id: true, notes: true },
  });

  let reportItemId: string;
  if (volume != null) {
    const item = await upsertItem(
      report.id,
      // Catatan yang sudah ada DIBAWA: upsertItem menimpa catatan dengan apa pun yang dikirim.
      { rabNodeId: node.id, volumeDone: volume, notes: ada?.notes ?? null },
      actor.id,
    );
    reportItemId = item.id;
  } else if (ada) {
    reportItemId = ada.id;
  } else {
    throw new UsulanError("Usulan ini belum punya volume. Isi volumenya dulu, lalu Masukkan.");
  }

  // Foto yang masih di kantong (belum dipakai di tempat lain, belum dihapus).
  const foto = u.photoIds.length
    ? await db.photo.findMany({
        where: { id: { in: u.photoIds }, reportId: null, activityId: null },
        select: { id: true },
      })
    : [];
  let gagalFoto: string | null = null;
  let dipakai = 0;
  if (foto.length > 0) {
    const { pakaiFotoKeTujuan } = await import("@/lib/foto-cepat/pakai");
    const h = await pakaiFotoKeTujuan(
      actor,
      foto.map((f) => f.id),
      { tujuan: "laporan", reportItemId },
    );
    if ("error" in h) gagalFoto = h.error;
    else dipakai = h.dipakai;
  }

  if (!canTransitionWaUsulan(u.status, "dimasukkan")) throw new UsulanError("Usulan ini sudah diputus sebelumnya.");
  // Bersyarat `menunggu`: dua orang yang menekan Masukkan bersamaan tidak sama-sama
  // tercatat sebagai pemutus. Baris laporannya sendiri idempoten (upsert).
  const diputus = await db.waUsulan.updateMany({
    where: { id: u.id, status: "menunggu" },
    data: {
      status: "dimasukkan",
      kunciMenunggu: null,
      diputusOlehId: actor.id,
      diputusAt: new Date(),
      reportItemId,
      volume: volume ?? u.volume,
    },
  });
  if (diputus.count === 0) throw new UsulanError("Usulan ini baru saja diputus orang lain.");
  await audit(actor.id, "wa.usulan.masukkan", "wa_usulan", u.id, {
    locationId: u.locationId,
    dateKey,
    lineageKey: u.lineageKey,
    // Pekerjaan yang benar-benar diisi – berbeda bila pemeriksa menggantinya.
    lineageKeyDimasukkan: node.lineageKey,
    pekerjaanDiganti: node.lineageKey !== u.lineageKey,
    volumeUsulan: u.volume != null ? Number(u.volume) : null,
    volumeDimasukkan: volume,
    foto: dipakai,
    reportItemId,
  });
  return { volume, foto: dipakai, gagalFoto };
}

/** Buang usulan. Fotonya TETAP di kantong Foto Cepat – bukti tidak ikut terbuang. */
export async function buangUsulan(actor: SessionUser, usulanId: string): Promise<void> {
  const u = await muatMenunggu(usulanId);
  await requireLocationAccess(actor, u.locationId);
  if (!canTransitionWaUsulan(u.status, "dibuang")) throw new UsulanError("Usulan ini sudah diputus sebelumnya.");
  const diputus = await db.waUsulan.updateMany({
    where: { id: u.id, status: "menunggu" },
    data: { status: "dibuang", kunciMenunggu: null, diputusOlehId: actor.id, diputusAt: new Date() },
  });
  if (diputus.count === 0) throw new UsulanError("Usulan ini baru saja diputus orang lain.");
  await audit(actor.id, "wa.usulan.buang", "wa_usulan", u.id, {
    locationId: u.locationId,
    dateKey: jakartaDateKey(u.reportDate),
    lineageKey: u.lineageKey,
    volume: u.volume != null ? Number(u.volume) : null,
    foto: u.photoIds.length,
  });
}
