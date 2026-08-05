import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  konteksFoto,
  ringkasNilai,
  stampDariNilai,
  type KonteksFoto,
} from "@/lib/photo-restamp/service";
import { processWithSharpOrOriginal } from "@/lib/photos";
import { r2Delete, r2GetBuffer, r2Put } from "@/lib/r2";

/**
 * MELENGKAPI CAP FOTO CEPAT setelah fotonya dipakai (DECISIONS 253).
 *
 * Foto Cepat dicap dengan **dasar** saja: waktu + koordinat (+ pelapor & Photo
 * ID). Nama lokasi, perusahaan, bangunan/kategori, dan item pekerjaan sengaja
 * DIKOSONGKAN, karena pada detik memotret hal-hal itu memang belum diketahui —
 * dan cap yang menyebut sesuatu yang belum diketahui adalah bukti palsu.
 *
 * Begitu fotonya ditautkan ke laporan harian / kegiatan, informasi itu barulah
 * ADA, dan capnya dirender ulang dari BERKAS ASLI yang diarsipkan.
 *
 * WAKTU DAN KOORDINAT TIDAK IKUT DIHITUNG ULANG. Keduanya direkam pada detik
 * jepret dan itulah satu-satunya momen keduanya bisa diketahui; menurunkannya
 * lagi dari induk barunya (tanggal laporan, titik proyek) justru mengembalikan
 * persis cacat yang membuat fitur ini ada.
 */

export type HasilLengkapiCap =
  | { ok: true; revisi: number }
  | { ok: false; alasan: string };

/**
 * Render ulang cap satu foto dari arsip aslinya memakai konteks TERBARU.
 *
 * `sebelum` WAJIB dibaca sebelum foto ditautkan — sesudah ditautkan,
 * `konteksFoto` sudah membaca induk barunya, sehingga memakainya sebagai "nilai
 * lama" akan mencatat riwayat revisi yang menyatakan tidak ada yang berubah.
 */
export async function lengkapiCap(
  photoId: string,
  sebelum: KonteksFoto,
  actorId: string,
): Promise<HasilLengkapiCap> {
  const k = await konteksFoto(photoId);
  if (!k) return { ok: false, alasan: "Foto tidak ditemukan." };
  if (!k.originalKey) {
    return {
      ok: false,
      alasan: sebelum.originalPurgedAt
        ? "arsip berkas asli sudah dihapus"
        : "berkas asli tidak diarsipkan",
    };
  }

  const lama = sebelum.saatIni;
  // Nilai baru = apa adanya dari DB SEKARANG, KECUALI waktu & koordinat yang
  // tetap memakai rekaman saat jepret.
  const baru = {
    ...k.saatIni,
    takenAt: lama.takenAt,
    jamDiketahui: lama.jamDiketahui,
    lat: lama.lat,
    lng: lama.lng,
    gpsSource: lama.gpsSource,
    timeSource: lama.timeSource,
    photoId: lama.photoId ?? k.saatIni.photoId,
  };

  const original = await r2GetBuffer(k.originalKey);
  const processed = await processWithSharpOrOriginal(original, await stampDariNilai(baru), {
    name: k.originalKey,
    type: "",
  });

  // Objek BARU ditulis dulu; yang lama dihapus hanya setelah DB berhasil —
  // kegagalan di tengah tidak boleh meninggalkan foto tanpa berkas.
  const revisi = k.stampRevision + 1;
  const uuid = randomUUID();
  const dasar = k.r2Key.replace(/[^/]+$/, "");
  const keyBaru = `${dasar}${uuid}.r${revisi}.${processed.ext}`;
  await r2Put(keyBaru, processed.main, processed.contentType);
  let thumbBaru: string | null = null;
  if (processed.thumb) {
    thumbBaru = `${dasar}${uuid}.r${revisi}.thumb.webp`;
    try {
      await r2Put(thumbBaru, processed.thumb, "image/webp");
    } catch {
      thumbBaru = null;
    }
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.photo.update({
        where: { id: photoId },
        data: {
          r2Key: keyBaru,
          thumbnailKey: thumbBaru,
          bytes: processed.main.length,
          widthPx: processed.width,
          heightPx: processed.height,
          stampRevision: revisi,
        },
      });
      await tx.photoStampRevision.create({
        data: {
          photoId,
          revision: revisi,
          reason: "Foto Cepat dipakai — informasi cap dilengkapi otomatis",
          before: ringkasNilai(lama) as object,
          after: ringkasNilai(baru) as object,
          // KOSONG dengan sengaja: tidak ada satu nilai pun yang diketik manusia.
          // Semuanya dibaca dari data yang sudah ada di sistem.
          manualFields: [],
          changedById: actorId,
        },
      });
    });
  } catch (err) {
    await r2Delete(keyBaru).catch(() => {});
    if (thumbBaru) await r2Delete(thumbBaru).catch(() => {});
    throw err;
  }

  await r2Delete(k.r2Key).catch(() => {});
  if (k.thumbnailKey) await r2Delete(k.thumbnailKey).catch(() => {});
  return { ok: true, revisi };
}

/** Buang foto kantong berikut seluruh objeknya di R2. */
export async function hapusFotoKantong(photoId: string, actorId: string): Promise<void> {
  const p = await db.photo.findUnique({
    where: { id: photoId },
    select: {
      id: true,
      r2Key: true,
      thumbnailKey: true,
      originalKey: true,
      locationId: true,
      reportId: true,
      activityId: true,
    },
  });
  if (!p) return;
  // Pagar terakhir: yang boleh dibuang lewat jalur ini HANYA foto tanpa induk.
  // Foto yang sudah jadi lampiran laporan adalah bukti — menghapusnya lewat
  // tombol kantong akan melewati seluruh aturan pembatalan laporan.
  if (p.reportId || p.activityId) throw new Error("Foto ini sudah dipakai — hapus lewat laporannya.");

  await db.$transaction(async (tx) => {
    await tx.photoStampRevision.deleteMany({ where: { photoId } });
    await tx.photo.delete({ where: { id: photoId } });
  });
  await audit(actorId, "photo.quick_discard", "photo", photoId, { locationId: p.locationId });
  await r2Delete(p.r2Key).catch(() => {});
  if (p.thumbnailKey) await r2Delete(p.thumbnailKey).catch(() => {});
  if (p.originalKey) await r2Delete(p.originalKey).catch(() => {});
}
