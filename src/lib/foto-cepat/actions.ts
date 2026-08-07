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
import { MAX_PHOTOS_PER_UPLOAD, PhotoError, bacaExifFoto, savePhotoForItem } from "@/lib/photos";
import { accessibleLocationIds } from "@/lib/auth/session";
import { alasanDeteksi, deteksiLokasi } from "./deteksi";
import { getPilihanLokasi } from "./queries";
import { isR2Configured } from "@/lib/r2";
import { getPolicy } from "@/lib/policy";
import { konteksFoto } from "@/lib/photo-restamp/service";
import { EDITABLE_STATUSES } from "@/lib/daily-report/service";
import { hapusFotoKantong, lengkapiCap } from "./service";
import { pakaiFotoKeTujuan } from "./pakai";
import {
  getKantong,
  getTujuan,
  type FotoKantong,
  type TujuanKegiatan,
  type TujuanLaporan,
} from "./queries";

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

/**
 * Foto Cepat menerima KAMERA SAJA (DECISIONS 255).
 *
 * `photoSource`/`galleryAtSite` sengaja TIDAK ada di skema ini. Kalau suatu saat
 * klien mengirimkannya, nilainya diabaikan — bukan dipercaya. Menerima sumber
 * dari input klien berarti jalur galeri bisa dihidupkan kembali dari luar tanpa
 * satu baris pun berubah di sini.
 */
const simpanSchema = z.object({
  gpsLat: z.coerce.number().min(-90).max(90).optional(),
  gpsLng: z.coerce.number().min(-180).max(180).optional(),
  photoTakenAt: z.string().optional(),
});

export async function simpanFotoCepatAction(
  _prev: FotoCepatState,
  formData: FormData,
): Promise<FotoCepatState> {
  try {
    const actor = await requireCapability("photo.quick");
    if (!isR2Configured()) return { error: "Penyimpanan foto belum dikonfigurasi." };

    const parsed = simpanSchema.safeParse({
      gpsLat: formData.get("gpsLat") || undefined,
      gpsLng: formData.get("gpsLng") || undefined,
      photoTakenAt: formData.get("photoTakenAt") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    // Kandidat deteksi = lokasi yang boleh diakses user. Membatasinya di sini
    // sekaligus jadi otorisasinya: foto tidak akan pernah terdeteksi ke lokasi
    // yang bukan haknya, tanpa perlu pemeriksaan terpisah yang bisa terlewat.
    const kandidat = await getPilihanLokasi(actor, await accessibleLocationIds(actor));

    const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Belum ada foto yang dipilih." };
    if (files.length > MAX_PHOTOS_PER_UPLOAD)
      return { error: `Maksimal ${MAX_PHOTOS_PER_UPLOAD} foto sekali kirim.` };

    const wajibGps = (await getPolicy()).requirePhotoGps;
    const takenAt = d.photoTakenAt ? new Date(d.photoTakenAt) : null;
    const takenAtValid = takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null;

    // Wajib-GPS diperiksa di sini dari posisi perangkat — satu-satunya sumber
    // koordinat yang mungkin, karena fotonya selalu baru dijepret.
    if (wajibGps && (d.gpsLat == null || d.gpsLng == null))
      return {
        error:
          "Setelan wajib-GPS menyala tapi posisi perangkat belum didapat. " +
          "Izinkan akses lokasi lalu coba lagi.",
      };

    const dateKey = jakartaDateKey(new Date());
    const gagal: string[] = [];
    const belumTerdeteksi: string[] = [];
    let sukses = 0;
    let tanpaKoordinat = 0;
    const perLokasi = new Map<string, number>();

    for (const file of files) {
      try {
        /*
         * DETEKSI LOKASI DARI KOORDINAT FOTO ITU SENDIRI (DECISIONS 254).
         *
         * Per-berkas, bukan sekali untuk seluruh kiriman: unggahan borongan dari
         * galeri/cloud bisa memuat foto dari beberapa lokasi sekaligus, dan
         * memaksakan satu lokasi untuk semuanya akan menaruh sebagian di tempat
         * yang salah — persis cacat yang sedang diperbaiki.
         *
         * Sumbernya GPS perangkat pada detik rana ditekan; EXIF berkas dipakai
         * hanya sebagai cadangan.
         */
        const buf = Buffer.from(await file.arrayBuffer());
        const exif = bacaExifFoto(buf);
        const koordinat =
          d.gpsLat != null && d.gpsLng != null
            ? { lat: d.gpsLat, lng: d.gpsLng }
            : exif.lat != null && exif.lng != null
              ? // Cadangan, bukan jalur galeri: sebagian WebView Android menulis
                // GPS ke EXIF berkas kamera walau izin lokasi web ditolak.
                { lat: exif.lat, lng: exif.lng }
              : null;
        const hasil = deteksiLokasi(koordinat, kandidat);
        const lokasi = hasil.status === "cocok" ? hasil.lokasi : null;
        if (!lokasi) {
          const sebab = alasanDeteksi(hasil);
          if (sebab) belumTerdeteksi.push(sebab);
        }

        const foto = await savePhotoForItem({
          locationId: lokasi?.id ?? null,
          // Tanpa induk — inti Foto Cepat.
          reportId: null,
          reportItemId: null,
          activityId: null,
          file,
          userId: actor.id,
          // Lokasi belum terdeteksi → berkasnya tetap masuk bucket, di rak
          // tersendiri. Menolak menyimpan berarti membuang bukti lapangan hanya
          // karena kita belum tahu nama raknya.
          locationSlug: lokasi?.slug ?? "_kantong",
          dateKey,
          stamp: {
            source: "camera",
            requireGps: wajibGps,
            lat: d.gpsLat ?? null,
            lng: d.gpsLng ?? null,
            takenAt: takenAtValid,
            // locationLat/locationLng SENGAJA tidak dikirim → tanpa cadangan
            // titik proyek.
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
        if (lokasi) perLokasi.set(lokasi.name, (perLokasi.get(lokasi.name) ?? 0) + 1);
      } catch (err) {
        gagal.push(
          `${file.name}: ${err instanceof PhotoError ? err.message : "gagal diproses"}`,
        );
      }
    }

    if (sukses > 0)
      await audit(actor.id, "photo.quick_capture", "photo", null, {
        jumlah: sukses,
        sumber: "camera",
        tanpaKoordinat,
        belumTerdeteksi: belumTerdeteksi.length,
        lokasiTerdeteksi: Object.fromEntries(perLokasi),
      });

    revalidatePath("/foto-cepat");
    revalidatePath("/foto");

    if (sukses === 0) return { error: gagal.join(" · ") || "Tidak ada foto yang tersimpan." };

    // Lokasi yang BERHASIL terdeteksi disebut namanya. Deteksi yang bekerja diam-
    // diam tidak bisa dipercaya siapa pun: pelapor harus bisa melihat bahwa
    // fotonya mendarat di desa yang benar, saat itu juga.
    const nama = [...perLokasi.entries()].map(([n, j]) => `${n} (${j})`).join(", ");
    const dasar = nama ? `${sukses} foto tersimpan — terdeteksi di ${nama}.` : `${sukses} foto tersimpan.`;
    const catatanBelum =
      belumTerdeteksi.length > 0
        ? ` ${belumTerdeteksi.length} foto belum ketahuan lokasinya (${[...new Set(belumTerdeteksi)].join("; ")}) — pilih di kantong bawah.`
        : "";
    // Foto tanpa koordinat TETAP disimpan, tapi tidak dibiarkan lewat diam-diam:
    // pelapor perlu tahu sekarang, selagi masih di lokasi dan masih bisa
    // memotret ulang dengan GPS menyala.
    const catatanGps = tanpaKoordinat > 0 ? ` ${tanpaKoordinat} TANPA koordinat.` : "";
    const pesan = `${dasar}${catatanGps}${catatanBelum}`;
    if (gagal.length) return { warning: `${pesan} Gagal: ${gagal.join(" · ")}` };
    return tanpaKoordinat > 0 || belumTerdeteksi.length > 0 ? { warning: pesan } : { ok: pesan };
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

    const hasil = await pakaiFotoKeTujuan(
      actor,
      d.photoIds,
      d.tujuan === "kegiatan"
        ? { tujuan: "kegiatan", kegiatanId: d.kegiatanId! }
        : { tujuan: "laporan", reportItemId: d.reportItemId! },
    );
    if ("error" in hasil) return { error: hasil.error };
    const { dipakai, labelTujuan, gagalCap } = hasil;

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


/**
 * Isi kantong di SATU lokasi — dipakai dari sisi laporan harian & kegiatan.
 *
 * Keluhan user 2026-08-06: *"di sisi inputan laporan harian maupun kegiatan
 * lapangan pun, perlu untuk bisa mengambil dari hasil foto cepat ini, kalau
 * tidak, akan percuma fitur ini."* Benar. Sebelumnya satu-satunya jalan memakai
 * foto adalah dari halaman /foto-cepat, sedangkan yang MENGISI laporan sedang
 * berada di layar laporan. Meninggalkan halaman yang sedang diisi untuk mencari
 * foto — lalu kembali dan mencari lagi sampai mana tadi — bukan alur yang akan
 * ditempuh orang; yang akan terjadi adalah memotret ulang dari layar laporan,
 * dan foto di kantong menumpuk tak terpakai.
 *
 * Hanya foto yang lokasinya SUDAH ketahuan yang dikembalikan: tujuannya sudah
 * pasti satu lokasi, dan foto tanpa lokasi tidak boleh ditetapkan diam-diam
 * lewat penautan (DECISIONS 254) — itu tetap dikerjakan sadar di /foto-cepat.
 */
export async function muatKantongLokasiAction(
  locationId: string,
): Promise<{ fotos: FotoKantong[] } | { error: string }> {
  try {
    const actor = await requireCapability("photo.quick");
    if (!z.uuid().safeParse(locationId).success) return { error: "Lokasi tidak dikenali." };
    await requireLocationAccess(actor, locationId);
    const locIds = await accessibleLocationIds(actor);
    const fotos = await getKantong(actor, locIds, { locationId });
    return { fotos: fotos.filter((f) => f.locationId != null) };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: "Gagal memuat kantong foto." };
  }
}

const tetapkanSchema = z.object({
  photoIds: z.array(z.uuid()).min(1, "Pilih foto dulu.").max(50),
  locationId: z.uuid("Pilih lokasinya."),
});

/**
 * Tetapkan lokasi untuk foto yang geotag-nya tidak cukup untuk memutuskan.
 *
 * Ini SATU-SATUNYA jalan lokasi diisi manusia, dan sengaja terpisah dari
 * memotret: saat berdiri di lapangan pelapor tidak perlu menjawab apa pun,
 * sedangkan yang perlu dijawab dikumpulkan untuk dikerjakan sambil duduk.
 *
 * Dedup baru berlaku SEKARANG — foto tanpa lokasi lolos dari unique
 * (location, sha256) karena NULL tidak sama dengan NULL. Kalau ternyata foto
 * yang sama sudah ada di lokasi itu, penetapannya ditolak dengan menyebut
 * sebabnya, bukan gagal dengan galat database mentah.
 */
export async function tetapkanLokasiAction(
  _prev: FotoCepatState,
  formData: FormData,
): Promise<FotoCepatState> {
  try {
    const actor = await requireCapability("photo.quick");
    const parsed = tetapkanSchema.safeParse({
      photoIds: formData.getAll("photoIds").map(String),
      locationId: formData.get("locationId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { photoIds, locationId } = parsed.data;

    await requireLocationAccess(actor, locationId);
    const lokasi = await db.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true },
    });
    if (!lokasi) return { error: "Lokasi tidak ditemukan." };

    // Hanya foto MILIK SENDIRI yang masih tanpa lokasi — sama dengan aturan
    // siapa yang boleh melihatnya di kantong.
    const fotos = await db.photo.findMany({
      where: {
        id: { in: photoIds },
        locationId: null,
        reportId: null,
        activityId: null,
        uploadedById: actor.id,
      },
      select: { id: true },
    });
    if (fotos.length === 0) return { error: "Tidak ada foto yang bisa ditetapkan." };

    let berhasil = 0;
    const duplikat: string[] = [];
    for (const f of fotos) {
      try {
        await db.$transaction(async (tx) => {
          await tx.photo.update({ where: { id: f.id }, data: { locationId } });
          await auditIn(tx, actor.id, "photo.quick_set_location", "photo", f.id, { locationId });
        });
        berhasil++;
      } catch (e) {
        if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002")
          duplikat.push(f.id);
        else throw e;
      }
    }

    revalidatePath("/foto-cepat");
    revalidatePath("/foto");
    if (berhasil === 0)
      return { error: `Foto itu sudah pernah diunggah di ${lokasi.name} — tidak ditetapkan ulang.` };
    const dasar = `${berhasil} foto ditetapkan ke ${lokasi.name}.`;
    return duplikat.length > 0
      ? { warning: `${dasar} ${duplikat.length} dilewati karena sudah ada di lokasi itu.` }
      : { ok: dasar };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menetapkan lokasi." };
  }
}
