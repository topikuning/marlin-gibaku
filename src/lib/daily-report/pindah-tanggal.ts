import type { DailyReportStatus } from "@/generated/prisma/enums";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";

/**
 * PINDAH TANGGAL LAPORAN HARIAN — ATURAN MURNI (DECISIONS 415).
 *
 * Keluhan user 2026-08-22, atas laporan Banjarejo yang dikembalikan dengan
 * alasan *"salah penginputan tanggal pelaksanaan sondir saya input di tanggal
 * 21 Juli 2026 yang benar tanggal 22 Juli 2026"*:
 *
 * > ini terlalu ribet untuk edit, padahal bisa sekali klik, ganti tanggal saja.
 *
 * Betul, dan skemanya mendukungnya: `report_date` adalah SATU-SATUNYA kolom di
 * seluruh basis data yang membawa tanggal laporan. Item, foto, tenaga kerja,
 * material, alat, kendala, dan riwayat status semuanya menggantung pada
 * `report_id`, bukan pada tanggal. Memindahkan laporan karena itu satu UPDATE —
 * tidak ada yang perlu diunggah atau diketik ulang.
 *
 * ### Kenapa BUKAN "hapus lalu input ulang"
 *
 * Karena penghapusan laporan harian tidak ada, dan sebaiknya tetap tidak ada.
 * Menghapus membuang riwayat status, jejak audit, dan identitas foto (photo ID
 * yang sudah tercetak di berkas yang beredar) demi memperbaiki satu kolom.
 * Memindahkan menyimpan semuanya.
 *
 * ### Yang TIDAK ikut pindah, dan karena itu harus disebut
 *
 * Tanggalnya berpindah; beberapa fakta yang menempel padanya tidak ikut benar
 * dengan sendirinya. Modul ini menghitung persis apa saja, supaya layarnya bisa
 * mengatakannya sebelum orang menekan tombol — bukan sesudahnya.
 */

/** Kunci tanggal `YYYY-MM-DD` (Asia/Jakarta), sama seperti di seluruh MARLIN. */
export type KunciTanggal = string;

export type AlasanTolak =
  | { sebab: "format"; pesan: string }
  | { sebab: "sama"; pesan: string }
  | { sebab: "masa_depan"; pesan: string }
  | { sebab: "terisi"; pesan: string };

const POLA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Boleh tidaknya laporan dipindah ke `baru`, TANPA menyentuh basis data.
 *
 * `adaDiTujuan` disuntikkan pemanggil karena hanya DB yang tahu; sisanya murni.
 * Dipisah begini supaya setiap penolakan punya uji sendiri — penolakan adalah
 * bagian yang paling jarang dijalankan dan paling mudah salah.
 */
export function periksaPindah(input: {
  lama: KunciTanggal;
  baru: string;
  hariIni: KunciTanggal;
  adaDiTujuan: boolean;
}): AlasanTolak | null {
  const { lama, baru, hariIni, adaDiTujuan } = input;
  if (!POLA.test(baru)) {
    return { sebab: "format", pesan: "Tanggal tujuan tidak valid." };
  }
  if (baru === lama) {
    return { sebab: "sama", pesan: "Tanggal tujuan sama dengan tanggal laporan sekarang." };
  }
  if (baru > hariIni) {
    /*
     * Pagar yang SAMA dengan pembuatan laporan (`getOrCreateDraft`). Kalau
     * pindah tanggal tidak ikut menjaganya, ia jadi jalan belakang untuk
     * membuat laporan bertanggal besok — persis yang pagar itu cegah di pintu
     * depan.
     */
    return { sebab: "masa_depan", pesan: "Tidak bisa memindahkan laporan ke tanggal yang belum terjadi." };
  }
  if (adaDiTujuan) {
    /*
     * DITOLAK, bukan digabung atau ditimpa. Satu lokasi satu laporan per hari
     * (`@@unique`), dan menggabungkan dua laporan berarti memutuskan volume
     * siapa yang menang — keputusan yang tidak boleh diambil diam-diam oleh
     * tombol pindah. Draft kosong sekalipun tetap menolak: yang tahu draft itu
     * boleh dibuang adalah orangnya, bukan kode ini.
     */
    return {
      sebab: "terisi",
      pesan: "Tanggal tujuan sudah punya laporan. Kosongkan atau selesaikan laporan itu dulu.",
    };
  }
  return null;
}

/**
 * Rentang tanggal yang snapshot cetaknya jadi BASI karena perpindahan ini.
 *
 * `finalSnapshot` membekukan angka kumulatif "s/d tanggal laporan". Laporan
 * final bertanggal d menghitung laporan lain yang tanggalnya ≤ d — jadi begitu
 * satu laporan pindah dari A ke B, semua laporan final bertanggal d dengan
 * `min(A,B) ≤ d < max(A,B)` berubah isinya: tadinya ikut menghitung laporan
 * yang pindah, sekarang tidak (atau sebaliknya).
 *
 * Rentangnya SETENGAH TERBUKA, dan itu bukan kerapian belaka: pada pindah maju
 * 21→22, laporan tanggal 22 sudah menghitung laporan itu sebelum maupun sesudah
 * pindah, jadi memasukkannya berarti membangun ulang snapshot yang sebetulnya
 * tidak berubah.
 *
 * `null` bila status laporan tidak terhitung (draft / perlu koreksi): angka
 * resmi tidak pernah memuatnya, jadi tidak ada snapshot siapa pun yang bergeser.
 */
export function rentangSnapshotBasi(input: {
  lama: KunciTanggal;
  baru: KunciTanggal;
  status: DailyReportStatus;
}): { dari: KunciTanggal; sampaiSebelum: KunciTanggal } | null {
  if (!(COUNTED_REPORT_STATUSES as readonly string[]).includes(input.status)) return null;
  const [dari, sampaiSebelum] =
    input.lama < input.baru ? [input.lama, input.baru] : [input.baru, input.lama];
  return { dari, sampaiSebelum };
}

/**
 * Apakah cap foto ini menuliskan TANGGAL LAPORAN (dan karena itu ikut salah).
 *
 * Cap dirender dari `exifTakenAt ?? tanggalLaporan` (lihat `photo-restamp`).
 * Foto yang membawa waktu jepret sendiri karena itu TIDAK terpengaruh — capnya
 * sudah menyebut kapan foto itu benar-benar diambil, dan sesudah laporan
 * dipindah justru capnya yang cocok. Yang perlu dicap ulang hanyalah foto yang
 * capnya meminjam tanggal laporan karena tidak punya waktu sendiri.
 */
export function capIkutSalah(foto: { exifTakenAt: Date | null }): boolean {
  return foto.exifTakenAt == null;
}

/** Cap yang salah TAPI tidak bisa diperbaiki lagi – arsip aslinya sudah tiada. */
export function capTakBisaDiperbaiki(foto: {
  exifTakenAt: Date | null;
  originalKey: string | null;
  originalPurgedAt: Date | null;
}): boolean {
  return capIkutSalah(foto) && (foto.originalKey == null || foto.originalPurgedAt != null);
}

export type AkibatFoto = {
  /** Foto yang capnya menuliskan tanggal lama. */
  perluCapUlang: number;
  /** Bagian dari `perluCapUlang` yang arsip aslinya sudah hilang. */
  takBisaDiperbaiki: number;
};

export function ringkasAkibatFoto(
  foto: { exifTakenAt: Date | null; originalKey: string | null; originalPurgedAt: Date | null }[],
): AkibatFoto {
  return {
    perluCapUlang: foto.filter(capIkutSalah).length,
    takBisaDiperbaiki: foto.filter(capTakBisaDiperbaiki).length,
  };
}
