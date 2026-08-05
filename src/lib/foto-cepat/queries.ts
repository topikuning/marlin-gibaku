import "server-only";
import { db } from "@/lib/db";
import { locationRelScopeWhere, locationScopeWhere } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { buildPhotoViews } from "@/lib/photos";
import { formatTanggal, jakartaDateKey, parseDateKey } from "@/lib/format";
import { EDITABLE_STATUSES } from "@/lib/daily-report/service";
import type { LokasiBerkoordinat } from "./jarak";

/**
 * FOTO CEPAT — kantong foto lapangan yang BELUM punya induk.
 *
 * Permintaan user 2026-08-05: *"seringnya user itu ambil foto dulu, baru
 * masukkan inputan item. jadi seringkali malah tagging lokasi tidak pas. jadi
 * lebih baik foto disimpan dulu baru nanti diolah oleh user masing-masing."*
 *
 * Inti soalnya bukan kapan itemnya dipilih, melainkan bahwa **posisi hanya bisa
 * diketahui pada detik foto dijepret**. Selama memotret mengharuskan pelapor
 * lebih dulu membuka laporan dan memilih item, orang akan memotret pakai
 * aplikasi kamera HP — dan foto itu datang tanpa koordinat, lalu jatuh ke titik
 * proyek (DECISIONS 197). Foto Cepat memutus rantai itu: jepret dulu lewat
 * MARLIN, koordinat + jam terekam saat itu juga, itemnya menyusul.
 *
 * Konsekuensi yang disengaja: foto di kantong ini TIDAK punya `reportId` maupun
 * `activityId`. Status turunannya "lepas" (DECISIONS 250) — yang dulu ditandai
 * "tidak seharusnya ada" — kini menjadi keadaan yang SAH dan diberi nama
 * "Belum Dipakai". DECISIONS 253.
 */

export type FotoKantong = {
  id: string;
  thumbUrl?: string;
  fullUrl?: string;
  takenAtIso: string;
  waktuLabel: string;
  locationId: string | null;
  locationName: string;
  /** Koordinat NYATA foto (perangkat saat jepret / EXIF). null = tidak ada. */
  lat: number | null;
  lng: number | null;
  /** true = koordinatnya bukti alat (exif/device), bukan cadangan/ketikan. */
  gpsAsli: boolean;
  reporterName: string;
  /** Arsip berkas asli ada → cap masih bisa dilengkapi saat foto dipakai. */
  bisaDilengkapi: boolean;
};

/** Nama rak untuk foto yang lokasinya belum ketahuan. */
export const LABEL_TANPA_LOKASI = "Belum ketahuan lokasinya";

/** Lokasi yang boleh dipakai memotret, berikut titik proyek & slug-nya. */
export type PilihanLokasi = LokasiBerkoordinat & { slug: string };

/**
 * Lokasi dalam scope user + koordinat titik proyeknya.
 *
 * Jarak SENGAJA tidak dihitung di sini: posisi pelapor hanya diketahui di
 * peramban, dan halaman ini dirender di server sebelum GPS terbaca. Yang
 * dikirim adalah bahan mentahnya; pengurutan terdekat dilakukan klien lewat
 * `urutkanTerdekat` (modul murni yang sama, jadi aturannya tidak bercabang).
 */
export async function getPilihanLokasi(
  user: SessionUser,
  locIds: string[] | null,
): Promise<PilihanLokasi[]> {
  const rows = await db.location.findMany({
    where: { ...locationScopeWhere(user, locIds), isActive: true },
    select: { id: true, name: true, slug: true, gpsLat: true, gpsLng: true },
    orderBy: { name: "asc" },
  });
  const num = (v: { toString(): string } | null) => (v == null ? null : Number(v.toString()));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    lat: num(r.gpsLat),
    lng: num(r.gpsLng),
  }));
}

/** Isi kantong — foto tanpa induk, dibatasi scope lokasi user. */
export async function getKantong(
  user: SessionUser,
  locIds: string[] | null,
  filter?: { locationId?: string },
): Promise<FotoKantong[]> {
  const rows = await db.photo.findMany({
    where: {
      AND: [
        { reportId: null },
        { activityId: null },
        {
          OR: [
            // Sudah ketahuan lokasinya → siapa pun yang berhak atas lokasi itu.
            { AND: [{ locationId: { not: null } }, locationRelScopeWhere(user, locIds)] },
            /*
             * BELUM ketahuan lokasinya (deteksi geotag gagal, DECISIONS 254) →
             * HANYA yang memotret. Bukan pilihan gaya: tanpa lokasi tidak ada
             * satu pun batas yang bisa dipakai membatasi siapa yang berhak
             * melihatnya, dan "semua orang" adalah jawaban yang salah untuk
             * bukti lapangan. Begitu lokasinya ditetapkan, ia langsung ikut
             * aturan yang di atas.
             */
            { AND: [{ locationId: null }, { uploadedById: user.id }] },
          ],
        },
        ...(filter?.locationId ? [{ locationId: filter.locationId }] : []),
      ],
    },
    orderBy: [{ exifTakenAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      r2Key: true,
      thumbnailKey: true,
      exifTakenAt: true,
      exifGpsLat: true,
      exifGpsLng: true,
      gpsSource: true,
      originalKey: true,
      originalPurgedAt: true,
      createdAt: true,
      uploadedById: true,
      locationId: true,
      location: { select: { name: true } },
    },
  });

  const uploaderIds = [...new Set(rows.map((r) => r.uploadedById).filter((v): v is string => !!v))];
  const uploaders = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, fullName: true } })
    : [];
  const nama = new Map(uploaders.map((u) => [u.id, u.fullName]));

  const views = await buildPhotoViews(rows);
  const viewById = new Map(views.map((v) => [v.id, v]));
  const fmt = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  });
  const num = (v: { toString(): string } | null) => (v == null ? null : Number(v.toString()));

  return rows.map((r) => {
    const takenAt = r.exifTakenAt ?? r.createdAt;
    const v = viewById.get(r.id);
    return {
      id: r.id,
      thumbUrl: v?.thumbUrl,
      fullUrl: v?.fullUrl,
      takenAtIso: takenAt.toISOString(),
      waktuLabel: fmt.format(takenAt),
      locationId: r.locationId,
      locationName: r.location?.name ?? LABEL_TANPA_LOKASI,
      lat: num(r.exifGpsLat),
      lng: num(r.exifGpsLng),
      gpsAsli: r.gpsSource === "exif" || r.gpsSource === "device",
      reporterName: (r.uploadedById && nama.get(r.uploadedById)) || "—",
      bisaDilengkapi: r.originalKey != null && r.originalPurgedAt == null,
    };
  });
}

export type TujuanKegiatan = { id: string; label: string };
export type TujuanLaporan = {
  id: string;
  label: string;
  items: { id: string; label: string }[];
};

/**
 * Tujuan yang MASIH BOLEH menerima foto di satu lokasi.
 *
 * Hanya yang masih bisa disunting yang ditawarkan: laporan yang sudah disetujui
 * atau final TIDAK muncul, karena menambahkan lampiran ke sana berarti mengubah
 * berkas yang sudah disahkan orang lain. Daftar yang menawarkan tujuan mustahil
 * hanya memindahkan kegagalannya ke saat tombol ditekan.
 */
export async function getTujuan(
  locationId: string,
): Promise<{ kegiatan: TujuanKegiatan[]; laporan: TujuanLaporan[] }> {
  const [kegiatan, laporan] = await Promise.all([
    db.fieldActivity.findMany({
      where: { locationId, status: "draft" },
      orderBy: [{ activityDate: "desc" }],
      take: 50,
      select: { id: true, title: true, activityDate: true },
    }),
    db.dailyReport.findMany({
      where: { locationId, status: { in: [...EDITABLE_STATUSES] } },
      orderBy: [{ reportDate: "desc" }],
      take: 30,
      select: {
        id: true,
        reportDate: true,
        items: { select: { id: true, rabNode: { select: { code: true, name: true } } } },
      },
    }),
  ]);

  return {
    kegiatan: kegiatan.map((k) => ({
      id: k.id,
      label: `${formatTanggal(k.activityDate)} — ${k.title}`,
    })),
    laporan: laporan.map((r) => ({
      id: r.id,
      label: formatTanggal(r.reportDate),
      items: r.items.map((i) => ({
        id: i.id,
        label: i.rabNode.code ? `${i.rabNode.code}. ${i.rabNode.name}` : i.rabNode.name,
      })),
    })),
  };
}

/** Kunci tanggal hari ini (Asia/Jakarta) — dipakai penamaan objek R2. */
export function dateKeyHariIni(): string {
  return jakartaDateKey(new Date());
}

/** Tanggal kerja dari kunci tanggal, untuk cap foto galeri tanpa EXIF. */
export function tanggalDariKunci(key: string): Date | null {
  return parseDateKey(key);
}
