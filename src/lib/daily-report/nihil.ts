import type { NoActivityReason } from "@/generated/prisma/enums";

/**
 * HARI TANPA KEGIATAN — MODUL MURNI (DECISIONS 396).
 *
 * Kebutuhan user 2026-08-20: *"dalam satu hari di laporan harian itu, dalam
 * hari ini tidak ada kegiatan. jadi item pekerjaan tidak harus diisi."*
 *
 * ### Pernyataan, bukan ketiadaan data
 *
 * Yang dibangun BUKAN pelonggaran pagar "laporan tidak boleh kosong". Kalau
 * pagarnya sekadar dilonggarkan, laporan yang **lupa diisi** tidak bisa
 * dibedakan dari hari yang **memang nihil** — dua hal yang berlawanan artinya,
 * dan yang memeriksa tidak punya cara memisahkannya. Justru ambiguitas itu yang
 * membuat datanya tidak berguna.
 *
 * Jadi hari nihil harus DINYATAKAN, berikut sebabnya.
 */

export const ALASAN_NIHIL = [
  "hujan",
  "libur",
  "menunggu_material",
  "menunggu_lahan_izin",
  "force_majeure",
  "lainnya",
] as const;

export const LABEL_ALASAN_NIHIL: Record<NoActivityReason, string> = {
  hujan: "Hujan",
  libur: "Libur / cuti bersama",
  menunggu_material: "Menunggu material",
  menunggu_lahan_izin: "Menunggu lahan / izin",
  force_majeure: "Force majeure",
  lainnya: "Lainnya",
};

/**
 * Alasan yang berarti PEKERJAAN TERHAMBAT, bukan sekadar tidak dikerjakan.
 *
 * Hujan dan libur berlalu sendiri; "menunggu" tidak. Yang menunggu perlu
 * seseorang yang ditagih — itulah kendala, dan di situlah papan kendala
 * (DECISIONS 392) menyambung.
 */
const MENUNGGU: ReadonlySet<NoActivityReason> = new Set<NoActivityReason>([
  "menunggu_material",
  "menunggu_lahan_izin",
]);

export function nihilKarenaMenunggu(alasan: NoActivityReason | null | undefined): boolean {
  return !!alasan && MENUNGGU.has(alasan);
}

/**
 * Judul kendala usulan dari hari nihil. `null` bila alasannya bukan "menunggu".
 *
 * Judulnya SENGAJA tanpa tanggal: kendala "menunggu material" hari ini dan
 * besok adalah masalah yang SAMA, dan menyisipkan tanggal akan meloloskannya
 * dari penjaga duplikat sehingga papan terisi satu masalah berkali-kali.
 */
export function judulKendalaDariNihil(
  alasan: NoActivityReason | null | undefined,
  catatan?: string | null,
): string | null {
  if (!nihilKarenaMenunggu(alasan)) return null;
  const dasar =
    alasan === "menunggu_material" ? "Pekerjaan tertahan menunggu material" : "Pekerjaan tertahan menunggu lahan / izin";
  const c = catatan?.trim();
  // Catatan yang pendek ikut ke judul supaya "menunggu material" yang berbeda
  // barangnya tidak dilebur jadi satu oleh penjaga duplikat.
  return c && c.length <= 80 ? `${dasar} – ${c}` : dasar;
}

export type IsiHari = { jumlahItem: number; jumlahMaterial: number; jumlahAlat: number };

/**
 * Alasan sebuah laporan TIDAK boleh dinyatakan nihil. `null` = boleh.
 *
 * Mengembalikan kalimat siap-tampil, bukan kode: pesannya masuk ke layar orang
 * lapangan, dan menerjemahkan kode jadi kalimat di komponen berarti kalimatnya
 * ditulis dua kali dan bisa menyimpang.
 */
export function alasanTidakBisaNihil(isi: IsiHari): string | null {
  /*
   * "Tidak ada kegiatan" DAN ada pekerjaan/material/alat tercatat adalah dua
   * pernyataan yang saling menyangkal. Membiarkan keduanya berdiri bersama
   * berarti laporan itu mengatakan dua hal sekaligus, dan pembacanya yang
   * disuruh memilih mana yang benar.
   */
  if (isi.jumlahItem > 0) {
    return "Sudah ada item pekerjaan hari ini – hapus dulu bila memang tidak ada kegiatan.";
  }
  if (isi.jumlahMaterial > 0) {
    return "Sudah ada material masuk hari ini – itu kegiatan, jadi tidak bisa dinyatakan nihil.";
  }
  if (isi.jumlahAlat > 0) {
    return "Sudah ada alat tercatat hari ini – itu kegiatan, jadi tidak bisa dinyatakan nihil.";
  }
  return null;
}

/** Ambang hari nihil BERTURUT-TURUT sebelum grup paket ditagih. */
export const AMBANG_NIHIL_BERUNTUN = 3;

export type HariLaporan = { dateKey: string; nihil: boolean };

/**
 * Berapa hari nihil BERTURUT-TURUT sampai `sampaiKey` (termasuk hari itu).
 *
 * Hari yang TIDAK ada laporannya memutus hitungan, bukan dianggap nihil:
 * "belum lapor" bukan pernyataan apa pun, dan memperlakukannya sebagai nihil
 * akan melahirkan peringatan berhenti-bekerja untuk lokasi yang sebenarnya
 * cuma telat mengisi — dua masalah berbeda dengan penanganan berbeda.
 *
 * @param hari daftar laporan lokasi itu; urutan bebas.
 */
export function nihilBeruntun(hari: HariLaporan[], sampaiKey: string): number {
  const peta = new Map(hari.map((h) => [h.dateKey, h.nihil]));
  let n = 0;
  const d = new Date(`${sampaiKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return 0;
  // Dibatasi supaya data aneh tidak membuat putaran ini berjalan selamanya.
  for (let i = 0; i < 400; i++) {
    const kunci = d.toISOString().slice(0, 10);
    if (peta.get(kunci) !== true) break;
    n += 1;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

/** Teks realisasi untuk blanko cetak KKP. `null` bila harinya bukan nihil. */
export function teksNihilCetak(
  nihil: boolean,
  alasan: NoActivityReason | null | undefined,
  catatan?: string | null,
): string | null {
  if (!nihil) return null;
  /*
   * Blanko yang kosong terbaca seperti ada yang lupa mengisi. Yang dicetak
   * harus KALIMAT, supaya pemeriksa di sisi PPK tahu ini pernyataan sengaja.
   */
  const label = alasan ? LABEL_ALASAN_NIHIL[alasan] : null;
  const c = catatan?.trim();
  return ["TIDAK ADA KEGIATAN", label, c].filter(Boolean).join(" – ");
}
