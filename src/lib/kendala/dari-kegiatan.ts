/**
 * KENDALA KEGIATAN LAPANGAN → ISSUE — BAGIAN MURNI (DECISIONS 392).
 *
 * Sebelum ini `FieldActivity.kendala` adalah teks bebas yang mati: tidak punya
 * status, tidak punya pemilik, tidak pernah muncul di daftar kendala mana pun,
 * dan hanya terbaca lagi kalau ada orang membuka kegiatan itu satu per satu.
 * Orang lapangan tidak bisa membedakannya dari kendala yang sesungguhnya —
 * dua-duanya berlabel "Kendala" di layar, dua-duanya terasa "sudah dilaporkan".
 *
 * User memilih: **otomatis jadi Issue saat kegiatan difinalkan.**
 *
 * Risiko pilihan itu sudah disebut sejak awal di `docs/rebuild/PETA_KENDALA.md`
 * — "bisa melahirkan banyak Issue dari catatan yang sebenarnya sekadar
 * keterangan". Modul ini yang menahan risiko tersebut, dan sengaja dipisah dari
 * server action supaya bisa diuji tanpa basis data.
 */

/**
 * Teks yang berarti "tidak ada kendala".
 *
 * Dicocokkan pada SELURUH teks yang sudah dinormalisasi, bukan sebagai
 * potongan. Kalau dicocokkan sebagai potongan, "tidak ada material besi di
 * lokasi" ikut terbuang karena memuat "tidak ada" – padahal itu justru kendala.
 */
const BUKAN_KENDALA = new Set([
  "",
  "-",
  "--",
  "0",
  "na",
  "n a",
  "nil",
  "nihil",
  "none",
  "kosong",
  "aman",
  "lancar",
  "aman lancar",
  "tidak ada",
  "tidak ada kendala",
  "tdk ada",
  "tdk ada kendala",
  "belum ada kendala",
  "kendala tidak ada",
  "tanpa kendala",
  "clear",
]);

/** Bentuk panjang dari keluarga yang sama: "tidak ada kendala yang berarti". */
const POLA_BUKAN_KENDALA =
  /^(tidak|tdk|belum|blm|gak|ga|nggak)\s+ada\s+kendala(\s+(yang\s+)?(berarti|signifikan|serius|apa\s*apa|apapun))?$/;

function normalisasi(teks: string): string {
  return teks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Apakah teks kendala kegiatan layak dinaikkan jadi Issue?
 *
 * Ambang panjang 4 karakter ada supaya coretan seperti "ok" atau "x" tidak
 * melahirkan kendala berjudul satu huruf yang tidak bisa ditindaklanjuti siapa
 * pun.
 */
export function layakJadiKendala(teks: string | null | undefined): boolean {
  if (!teks) return false;
  const n = normalisasi(teks);
  if (n.length < 4) return false;
  if (BUKAN_KENDALA.has(n)) return false;
  return !POLA_BUKAN_KENDALA.test(n);
}

export type IsiKendalaKegiatan = { title: string; description: string | null };

/** Batas judul Issue di skema. */
const MAKS_JUDUL = 200;

/**
 * Pecah teks kendala kegiatan menjadi judul + keterangan.
 *
 * Judul diambil dari kalimat/baris PERTAMA. Alasannya bukan estetika: papan
 * kendala mengurutkan dan menyandingkan puluhan baris, dan judul sepanjang
 * paragraf membuat papan itu tidak bisa dibaca sekali lihat. Teks utuh tidak
 * hilang – ia tetap disimpan sebagai keterangan.
 *
 * `solusi` yang sudah ditulis di kegiatan ikut dibawa sebagai keterangan:
 * itu rencana penanganan yang sudah dipikirkan orang lapangan, dan membuangnya
 * berarti menyuruh orang berikutnya memikirkannya lagi dari nol.
 */
export function isiKendalaDariKegiatan(
  kendala: string,
  solusi?: string | null,
): IsiKendalaKegiatan {
  const utuh = kendala.trim();
  const potonganPertama = utuh.split(/\r?\n|(?<=[.;!?])\s+/)[0].trim() || utuh;

  let title = potonganPertama;
  if (title.length > MAKS_JUDUL) {
    // Potong di batas kata terakhir sebelum ambang supaya judul tidak berakhir
    // di tengah kata.
    const potong = title.slice(0, MAKS_JUDUL - 1);
    const spasi = potong.lastIndexOf(" ");
    title = `${(spasi > 40 ? potong.slice(0, spasi) : potong).trimEnd()}…`;
  }

  const bagian: string[] = [];
  // Keterangan hanya diisi kalau ada yang BELUM ada di judul.
  if (utuh !== title) bagian.push(utuh);
  const s = solusi?.trim();
  if (s && layakJadiKendala(s)) bagian.push(`Rencana penanganan (dari kegiatan): ${s}`);

  return { title, description: bagian.length ? bagian.join("\n\n") : null };
}
