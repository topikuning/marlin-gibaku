import { formatTanggalWaktu } from "@/lib/format";
import type { DailyReportStatus } from "@/generated/prisma/enums";

/**
 * PEMIPIH BARIS PAPAN STATUS → BARIS GRID — modul murni.
 *
 * Teguran user 2026-08-06: *"kenapa tidak kamu model grid saja, yang per
 * kolomnya tombol... tiap kolom sortable."*
 *
 * Grid hanya bisa MENYORTIR dan MENYARING nilai yang datar. Selama jejak Drive
 * masih berupa objek bersarang (`drive.status`) dan jejak WA berupa `Date |
 * null`, kolomnya mustahil disortir dengan benar — dan sortir yang salah di
 * papan pengawasan lebih buruk daripada tidak ada sortir, karena ia terlihat
 * meyakinkan.
 *
 * Karena itu pemipihannya ditulis di sini, terpisah dari komponen, dan diuji
 * langsung. Yang dijaga:
 *
 * - **`diDrive` bernilai tiga**: "Sudah" / "Belum" / "Gagal". Bukan boolean,
 *   karena "gagal" menuntut tindakan yang berbeda dari "belum dicoba" — dan
 *   melebur keduanya menjadi satu tanda merah menyembunyikan bedanya.
 * - **`punyaFolderDrive` / `punyaGrupWa` adalah PRASYARAT, bukan hasil.**
 *   Keduanya kolom sendiri supaya bisa disortir: "punya folder TAPI belum
 *   naik" — pertanyaan yang paling sering ditanyakan — cukup dua kali klik
 *   kepala kolom, tanpa satu baris kode saringan pun.
 */

/** Bentuk minimal sumbernya; `StatusHarianRow` memenuhinya secara struktural. */
export type SumberBaris = {
  locationName: string;
  regency: string;
  slug: string;
  packageName: string;
  driveFolderId: string | null;
  waGroupId: string | null;
  status: DailyReportStatus | null;
  itemCount: number;
  fotoCount: number;
  kegiatanCount: number;
  kegiatanFotoCount: number;
  waSentAt: Date | null;
  drive: {
    status: "sukses" | "gagal" | null;
    webLink: string | null;
    at: Date | null;
    error: string | null;
    fileSukses: number;
  };
};

export type BarisTabel = {
  slug: string;
  lokasi: string;
  kabupaten: string;
  paket: string;
  /** "belum" = tidak ada laporan sama sekali; selain itu status laporannya. */
  status: DailyReportStatus | "belum";
  item: number;
  foto: number;
  kegiatan: number;
  punyaFolderDrive: boolean;
  diDrive: "Sudah" | "Belum" | "Gagal";
  driveWebLink: string | null;
  /** Kalimat lengkap untuk `title` — tidak memakan kolom. */
  driveKeterangan: string;
  punyaGrupWa: boolean;
  waTerkirim: boolean;
  waKeterangan: string;
  /** Ada sesuatu yang bisa diunggah/dikirim. Tanpa ini, tombolnya menipu. */
  adaIsi: boolean;
};

export function barisTabel(r: SumberBaris): BarisTabel {
  const adaIsi = r.itemCount > 0 || r.kegiatanCount > 0 || r.fotoCount > 0;
  const diDrive: BarisTabel["diDrive"] =
    r.drive.status === "sukses" ? "Sudah" : r.drive.status === "gagal" ? "Gagal" : "Belum";

  const driveKeterangan =
    r.drive.status === "sukses"
      ? `${r.drive.fileSukses} berkas${r.drive.at ? ` · ${formatTanggalWaktu(r.drive.at)}` : ""}`
      : r.drive.status === "gagal"
        ? `Percobaan terakhir GAGAL${r.drive.error ? ` – ${r.drive.error}` : ""}`
        : "Belum diunggah";

  return {
    slug: r.slug,
    lokasi: r.locationName,
    kabupaten: r.regency,
    paket: r.packageName,
    status: r.status ?? "belum",
    item: r.itemCount,
    // Foto kegiatan ikut dihitung: bagi yang membaca papan ini, "berapa foto
    // hari itu" tidak membedakan foto item dan foto kegiatan — keduanya bukti
    // lapangan yang sama-sama ikut terunggah.
    foto: r.fotoCount + r.kegiatanFotoCount,
    kegiatan: r.kegiatanCount,
    punyaFolderDrive: r.driveFolderId != null,
    diDrive,
    driveWebLink: r.drive.webLink,
    driveKeterangan,
    punyaGrupWa: r.waGroupId != null,
    waTerkirim: r.waSentAt != null,
    waKeterangan: r.waSentAt ? `Terkirim ${formatTanggalWaktu(r.waSentAt)}` : "Belum dikirim",
    adaIsi,
  };
}
