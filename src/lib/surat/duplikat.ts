/**
 * Kunci duplikat surat (DECISIONS 436) — MURNI, unit-tested.
 *
 * Register surat yang membiarkan surat yang SAMA masuk dua kali bukan sekadar
 * berantakan: tiap salinan bisa ditandai dijawab sendiri-sendiri, dijadikan
 * kendala sendiri-sendiri, dan ditagih sendiri-sendiri. Angka "menunggu
 * jawaban" pun ikut salah. Jadi duplikatnya DICEGAH, bukan dirapikan belakangan.
 *
 * Yang dianggap surat yang sama:
 *  1. nomor surat yang sama pada arah yang sama (nomor surat itu identitas
 *     resmi – dua surat masuk bernomor sama adalah surat yang sama), atau
 *  2. berkas yang isinya persis sama (kunci R2 = sha256 isi berkas).
 *
 * Perihal & tanggal sengaja TIDAK dipakai: dua surat berbeda bisa saja
 * berperihal sama di hari yang sama, dan menolaknya akan menghalangi pekerjaan
 * yang sah.
 */

/**
 * Normalisasi nomor surat untuk pembandingan. "16/PPM/VIII/2026",
 * "16 / PPM / VIII / 2026", dan "16/ppm/viii/2026" adalah nomor yang sama —
 * yang membedakannya hanya cara orang mengetiknya.
 */
export function normalNomorSurat(nomor: string | null | undefined): string | null {
  if (!nomor) return null;
  const n = nomor
    .toLowerCase()
    // Spasi di sekitar pemisah dibuang; pemisahnya sendiri disatukan.
    .replace(/\s*([/\-.])\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  return n.length ? n : null;
}

export type PenandaDuplikat = {
  nomorNormal: string | null;
  direction: "masuk" | "keluar";
  fileR2Key: string | null;
};

/**
 * Alasan sebuah surat ditolak sebagai duplikat, dalam bahasa yang menyebut
 * SEBABNYA — pesan "sudah ada" tanpa menyebut yang mana memaksa orang mencari
 * sendiri di daftar.
 */
export function alasanDuplikat(
  baru: PenandaDuplikat,
  lama: { agendaNo: number; agendaYear: number; letterNumber: string | null; fileName: string | null },
  sebab: "nomor" | "berkas",
): string {
  const agenda = `agenda ${lama.agendaNo}/${lama.agendaYear}`;
  return sebab === "nomor"
    ? `Surat bernomor ${lama.letterNumber ?? "(sama)"} sudah tercatat sebagai ${agenda}. ` +
        "Kalau ini surat yang berbeda, betulkan nomornya dulu."
    : `Berkas yang sama sudah tercatat sebagai ${agenda}` +
        `${lama.fileName ? ` (${lama.fileName})` : ""}. Buka surat itu daripada mencatatnya lagi.`;
}

/** Galat khusus supaya pemanggil bisa membedakannya dari kegagalan lain. */
export class SuratDuplikatError extends Error {
  readonly sebab: "nomor" | "berkas";
  constructor(pesan: string, sebab: "nomor" | "berkas") {
    super(pesan);
    this.name = "SuratDuplikatError";
    this.sebab = sebab;
  }
}
