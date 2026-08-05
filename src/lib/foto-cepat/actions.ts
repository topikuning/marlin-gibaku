"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import {
  ForbiddenError,
  requireCapability,
  requireLocationAccess,
} from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/format";
import { MAX_PHOTOS_PER_UPLOAD, PhotoError, savePhotoForItem } from "@/lib/photos";
import { isR2Configured } from "@/lib/r2";
import { getPolicy } from "@/lib/policy";
import { konteksFoto } from "@/lib/photo-restamp/service";
import { EDITABLE_STATUSES } from "@/lib/daily-report/service";
import { hapusFotoKantong, lengkapiCap } from "./service";
import { getTujuan, type TujuanKegiatan, type TujuanLaporan } from "./queries";

/**
 * Server actions FOTO CEPAT (DECISIONS 253).
 *
 * Yang membedakannya dari unggah foto biasa ada dua, dan keduanya disengaja:
 *
 * 1. **Tanpa induk.** `reportId` dan `activityId` dibiarkan null. Foto masuk
 *    kantong; itemnya dipilih belakangan.
 * 2. **Tanpa cadangan titik proyek.** `locationLat/locationLng` sengaja TIDAK
 *    dikirim ke `savePhotoForItem`, sehingga foto tanpa koordinat nyata
 *    berakhir `gpsSource = none` — bukan diam-diam ditandai titik proyek.
 *    Seluruh alasan fitur ini ada adalah membawa koordinat NYATA; menyediakan
 *    cadangan di sini akan menghidupkan kembali mesin "lokasi default" yang
 *    justru dikeluhkan (DECISIONS 197/219).
 *
 * Cap awalnya DASAR: waktu + koordinat (+ pelapor & Photo ID). Nama lokasi,
 * perusahaan, kategori, dan item pekerjaan dikosongkan karena belum diketahui,
 * lalu dilengkapi otomatis saat fotonya dipakai — lihat `service.ts`.
 */

export type FotoCepatState = { error?: string; ok?: string; warning?: string };

/** Batas satu kali proses "pakai" — tiap foto dirender ulang dari arsip aslinya. */
const MAX_PAKAI_SEKALI = 20;

const simpanSchema = z.object({
  locationId: z.uuid("Pilih lokasi dulu."),
  gpsLat: z.coerce.number().min(-90).max(90).optional(),
  gpsLng: z.coerce.number().min(-180).max(180).optional(),
  photoSource: z.enum(["camera", "gallery"]).default("camera"),
  photoTakenAt: z.string().optional(),
  galleryAtSite: z.string().optional(),
});

export async function simpanFotoCepatAction(
  _prev: FotoCepatState,
  formData: FormData,
): Promise<FotoCepatState> {
  try {
    const actor = await requireCapability("photo.quick");
    if (!isR2Configured()) return { error: "Penyimpanan foto belum dikonfigurasi." };

    const parsed = simpanSchema.safeParse({
      locationId: formData.get("locationId"),
      gpsLat: formData.get("gpsLat") || undefined,
      gpsLng: formData.get("gpsLng") || undefined,
      photoSource: formData.get("photoSource") || undefined,
      photoTakenAt: formData.get("photoTakenAt") || undefined,
      galleryAtSite: formData.get("galleryAtSite") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    await requireLocationAccess(actor, d.locationId);
    const lokasi = await db.location.findUnique({
      where: { id: d.locationId },
      select: { id: true, slug: true, name: true },
    });
    if (!lokasi?.slug) return { error: "Lokasi tidak ditemukan." };

    const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Belum ada foto yang dipilih." };
    if (files.length > MAX_PHOTOS_PER_UPLOAD)
      return { error: `Maksimal ${MAX_PHOTOS_PER_UPLOAD} foto sekali kirim.` };

    const wajibGps = (await getPolicy()).requirePhotoGps;
    const takenAt = d.photoTakenAt ? new Date(d.photoTakenAt) : null;
    const takenAtValid = takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null;

    // Wajib-GPS untuk KAMERA diperiksa di sini (posisi perangkat); untuk GALERI
    // pemeriksaannya per-berkas di dalam savePhotoForItem, karena EXIF baru
    // terbaca setelah berkasnya dibuka.
    if (wajibGps && d.photoSource === "camera" && (d.gpsLat == null || d.gpsLng == null))
      return {
        error:
          "Setelan wajib-GPS menyala tapi posisi perangkat belum didapat. " +
          "Izinkan akses lokasi lalu coba lagi.",
      };

    const dateKey = jakartaDateKey(new Date());
    const gagal: string[] = [];
    let sukses = 0;
    let tanpaKoordinat = 0;

    for (const file of files) {
      try {
        const foto = await savePhotoForItem({
          locationId: lokasi.id,
          // Tanpa induk — inti Foto Cepat.
          reportId: null,
          reportItemId: null,
          activityId: null,
          file,
          userId: actor.id,
          locationSlug: lokasi.slug,
          dateKey,
          stamp: {
            source: d.photoSource,
            requireGps: wajibGps,
            atSite: d.galleryAtSite === "on" || d.galleryAtSite === "true",
            lat: d.gpsLat ?? null,
            lng: d.gpsLng ?? null,
            takenAt: takenAtValid,
            // locationLat/locationLng SENGAJA tidak dikirim → tanpa cadangan
            // titik proyek. fallbackMode "none" menegaskannya untuk jalur galeri.
            fallbackMode: "none",
            reporterName: actor.fullName,
            // Cap DASAR: sisanya menyusul saat fotonya dipakai.
            locationLabel: null,
            companyName: null,
            categoryName: null,
            workName: null,
          },
        });
        sukses++;
        if (foto.gpsSource !== "exif" && foto.gpsSource !== "device") tanpaKoordinat++;
      } catch (err) {
        gagal.push(
          `${file.name}: ${err instanceof PhotoError ? err.message : "gagal diproses"}`,
        );
      }
    }

    if (sukses > 0)
      await audit(actor.id, "photo.quick_capture", "location", lokasi.id, {
        jumlah: sukses,
        sumber: d.photoSource,
        tanpaKoordinat,
      });

    revalidatePath("/foto-cepat");
    revalidatePath("/foto");

    if (sukses === 0) return { error: gagal.join(" · ") || "Tidak ada foto yang tersimpan." };
    const dasar = `${sukses} foto tersimpan di kantong.`;
    // Foto tanpa koordinat TETAP disimpan, tapi tidak dibiarkan lewat diam-diam:
    // pelapor perlu tahu sekarang, selagi masih di lokasi dan masih bisa
    // memotret ulang dengan GPS menyala.
    const catatan = tanpaKoordinat > 0 ? ` ${tanpaKoordinat} di antaranya TANPA koordinat.` : "";
    if (gagal.length) return { warning: `${dasar}${catatan} Gagal: ${gagal.join(" · ")}` };
    return tanpaKoordinat > 0 ? { warning: `${dasar}${catatan}` } : { ok: dasar };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan foto." };
  }
}

const pakaiSchema = z
  .object({
    photoIds: z.array(z.uuid()).min(1, "Pilih foto dulu.").max(MAX_PAKAI_SEKALI),
    tujuan: z.enum(["kegiatan", "laporan"]),
    kegiatanId: z.uuid().optional(),
    reportItemId: z.uuid().optional(),
  })
  .refine((v) => (v.tujuan === "kegiatan" ? !!v.kegiatanId : !!v.reportItemId), {
    message: "Tujuan belum lengkap — pilih kegiatan atau item laporannya.",
  });

/**
 * Tautkan foto kantong ke kegiatan / item laporan, lalu lengkapi capnya.
 *
 * Penautan dan pelengkapan cap SENGAJA tidak satu transaksi: melengkapi cap
 * berarti render ulang + tulis ke R2, dan menahan transaksi database selama itu
 * akan mengunci baris jauh lebih lama daripada perlu. Kalau capnya gagal
 * dilengkapi, fotonya TETAP tertaut dengan cap dasar (waktu + koordinat tetap
 * benar) dan kegagalannya DISEBUTKAN — bukan disembunyikan.
 */
export async function pakaiFotoAction(
  _prev: FotoCepatState,
  formData: FormData,
): Promise<FotoCepatState> {
  try {
    const actor = await requireCapability("photo.quick");
    if (!isR2Configured()) return { error: "Penyimpanan foto belum dikonfigurasi." };

    const parsed = pakaiSchema.safeParse({
      photoIds: formData.getAll("photoIds").map(String),
      tujuan: formData.get("tujuan"),
      kegiatanId: formData.get("kegiatanId") || undefined,
      reportItemId: formData.get("reportItemId") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    // ── Tujuan: harus ada, masih boleh disunting, dan lokasinya harus cocok ──
    let tujuanLocationId: string;
    let reportId: string | null = null;
    let reportItemId: string | null = null;
    let activityId: string | null = null;
    let labelTujuan: string;

    if (d.tujuan === "kegiatan") {
      const keg = await db.fieldActivity.findUnique({
        where: { id: d.kegiatanId! },
        select: { id: true, locationId: true, status: true, title: true },
      });
      if (!keg) return { error: "Kegiatan tidak ditemukan." };
      if (keg.status !== "draft")
        return { error: "Kegiatan itu sudah difinalkan — fotonya tidak bisa ditambah lagi." };
      tujuanLocationId = keg.locationId;
      activityId = keg.id;
      labelTujuan = `kegiatan "${keg.title}"`;
    } else {
      const item = await db.dailyReportItem.findUnique({
        where: { id: d.reportItemId! },
        select: {
          id: true,
          reportId: true,
          report: { select: { locationId: true, status: true } },
          rabNode: { select: { name: true } },
        },
      });
      if (!item) return { error: "Item laporan tidak ditemukan." };
      if (!EDITABLE_STATUSES.includes(item.report.status))
        return {
          error:
            "Laporan itu sudah dikirim/disetujui — lampirannya tidak bisa diubah dari sini.",
        };
      tujuanLocationId = item.report.locationId;
      reportId = item.reportId;
      reportItemId = item.id;
      labelTujuan = `item "${item.rabNode.name}"`;
    }
    await requireLocationAccess(actor, tujuanLocationId);

    // ── Foto: harus masih di kantong DAN lokasinya sama dengan tujuan ──
    const fotos = await db.photo.findMany({
      where: { id: { in: d.photoIds }, reportId: null, activityId: null },
      select: { id: true, locationId: true },
    });
    if (fotos.length === 0) return { error: "Foto tidak ditemukan di kantong (mungkin sudah dipakai)." };
    const bedaLokasi = fotos.filter((f) => f.locationId !== tujuanLocationId);
    if (bedaLokasi.length > 0)
      return {
        error: `${bedaLokasi.length} foto berasal dari lokasi lain. Foto hanya boleh dipakai di lokasi tempat ia dipotret.`,
      };

    const gagalCap: string[] = [];
    let dipakai = 0;
    for (const f of fotos) {
      // Nilai cap SEBELUM ditautkan — sesudahnya `konteksFoto` sudah membaca
      // induk barunya, jadi tidak lagi bisa dipakai sebagai pembanding.
      const sebelum = await konteksFoto(f.id);
      await db.$transaction(async (tx) => {
        await tx.photo.update({
          where: { id: f.id },
          data: { reportId, reportItemId, activityId },
        });
        await auditIn(tx, actor.id, "photo.quick_attach", "photo", f.id, {
          tujuan: d.tujuan,
          reportItemId,
          activityId,
          locationId: tujuanLocationId,
        });
      });
      dipakai++;
      if (!sebelum) continue;
      try {
        const hasil = await lengkapiCap(f.id, sebelum, actor.id);
        if (!hasil.ok) gagalCap.push(hasil.alasan);
      } catch {
        gagalCap.push("render cap gagal");
      }
    }

    revalidatePath("/foto-cepat");
    revalidatePath("/foto");

    const dasar = `${dipakai} foto dipakai di ${labelTujuan}.`;
    if (gagalCap.length > 0) {
      const unik = [...new Set(gagalCap)].join(", ");
      return {
        warning:
          `${dasar} ${gagalCap.length} di antaranya tetap memakai cap dasar (waktu + koordinat) ` +
          `karena ${unik} — foto & datanya tetap utuh.`,
      };
    }
    return { ok: `${dasar} Cap fotonya dilengkapi otomatis.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal memakai foto." };
  }
}

export async function hapusFotoCepatAction(
  _prev: FotoCepatState,
  formData: FormData,
): Promise<FotoCepatState> {
  try {
    const actor = await requireCapability("photo.quick");
    const id = z.uuid().safeParse(formData.get("photoId"));
    if (!id.success) return { error: "Foto tidak dikenali." };

    const p = await db.photo.findUnique({
      where: { id: id.data },
      select: { id: true, locationId: true, reportId: true, activityId: true },
    });
    if (!p) return { error: "Foto tidak ditemukan." };
    if (p.reportId || p.activityId)
      return { error: "Foto ini sudah dipakai — hapus lewat laporannya." };
    if (p.locationId) await requireLocationAccess(actor, p.locationId);

    await hapusFotoKantong(p.id, actor.id);
    revalidatePath("/foto-cepat");
    revalidatePath("/foto");
    return { ok: "Foto dibuang dari kantong." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menghapus foto." };
  }
}

/**
 * Muat tujuan yang tersedia di satu lokasi (dipanggil klien saat memilih foto).
 *
 * Sengaja BUKAN dimuat semuanya di server saat halaman dirender: pelapor lazim
 * punya banyak lokasi, dan mengirim seluruh daftar laporan + itemnya untuk
 * lokasi yang tidak jadi dipakai membengkakkan payload RSC — beban yang paling
 * terasa persis di jaringan lapangan (DECISIONS 245).
 */
export async function muatTujuanAction(
  locationId: string,
): Promise<{ kegiatan: TujuanKegiatan[]; laporan: TujuanLaporan[] } | { error: string }> {
  try {
    const actor = await requireCapability("photo.quick");
    if (!z.uuid().safeParse(locationId).success) return { error: "Lokasi tidak dikenali." };
    await requireLocationAccess(actor, locationId);
    return await getTujuan(locationId);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: "Gagal memuat tujuan." };
  }
}
