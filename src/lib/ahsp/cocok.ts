/**
 * Pencocokan item RAB → analisa AHSP. MURNI (tanpa db), supaya aturannya bisa
 * diuji dan diperbaiki tanpa menyentuh basis data. DECISIONS 318.
 *
 * ### Kenapa ini tidak boleh sekadar "mirip namanya"
 *
 * Panduan berkas AHSP sendiri melarangnya: *"jangan memilih hanya dari kemiripan
 * nama"*. Dan di data nyata alasannya langsung kelihatan:
 *
 *   RAB : "Pekerjaan beton semi mekanis setara fc = 25"        (m³)
 *   AHSP: "1 m3 Beton mutu rendah fc' 10 Mpa, Slump (10 ± 2,5) cm …"
 *         "1 m3 Beton mutu rendah fc' 25 Mpa, Slump (10 ± 2,5) cm …"
 *
 * Kedua kandidat itu hampir identik sebagai teks — yang membedakan cuma ANGKA.
 * Memilih yang salah bukan salah ketik: fc 10 dan fc 25 berbeda mutu, berbeda
 * komposisi, berbeda harga. Karena itu angka di sini bukan token biasa; ia
 * penentu, dan ketidakcocokan angka menjatuhkan skor secara tajam.
 *
 * ### Yang dilakukan saat ragu
 *
 * Mengembalikan `null` — bukan kandidat terbaik seadanya. Pemetaan otomatis yang
 * memaksakan padanan pada setiap baris akan membuat kolom "kebutuhan bahan"
 * terisi penuh dan tampak meyakinkan padahal sebagiannya karangan. Baris tanpa
 * padanan harus terlihat sebagai lubang, supaya ada yang memperbaikinya.
 */

/** Satuan dinormalkan: RAB memakai m³/m²/m¹, AHSP memakai m3/m2/m'. */
const SATUAN_KANONIK: Record<string, string> = {
  "m³": "m3", m3: "m3", "meter kubik": "m3", kubik: "m3",
  "m²": "m2", m2: "m2", "meter persegi": "m2", persegi: "m2",
  "m¹": "m", "m'": "m", m: "m", "meter panjang": "m", meter: "m", m1: "m",
  kg: "kg", kilogram: "kg", ton: "ton",
  buah: "buah", bh: "buah", unit: "unit", set: "set", lembar: "lembar", lbr: "lembar",
  batang: "batang", btg: "batang", titik: "titik", ttk: "titik",
  ls: "ls", lsum: "ls", "lump sum": "ls",
  org: "org", orang: "org", oh: "oh", jam: "jam", hari: "hari", bln: "bulan", bulan: "bulan",
  psg: "pasang", pasang: "pasang", roll: "roll", liter: "liter", ltr: "liter",
};

export function normalisasiSatuan(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/\.+$/, "");
  if (!s) return "";
  return SATUAN_KANONIK[s] ?? s;
}

/**
 * Kata yang muncul di hampir semua uraian sehingga tidak membedakan apa pun.
 * Membiarkannya ikut membuat dua pekerjaan yang tidak berhubungan tampak mirip
 * hanya karena sama-sama diawali "Pekerjaan".
 */
const KATA_UMUM = new Set([
  "pekerjaan", "pek", "buat", "pembuatan", "pemasangan", "pasang", "dan", "atau",
  "untuk", "dengan", "yang", "secara", "per", "di", "ke", "dari", "pada", "sd",
  "termasuk", "meliputi", "terdiri", "atas", "adalah", "tiap", "setiap", "dalam",
  "biaya", "harga", "satuan", "analisa",
  // Satuan ukur yang menempel di uraian ("t = 10 cm", "Ø 20 mm"). Ia muncul di
  // ribuan uraian yang tidak berhubungan; membiarkannya ikut membuat "Urugan
  // Sirtu t = 10 cm" bertemu "Shotcrete Wiremesh M10 (t = 10 cm)" hanya karena
  // sama-sama menyebut "cm" — diukur pada data nyata, bukan dugaan.
  "cm", "mm", "mtr", "kali", "buah", "unit", "lbr", "bh",
]);

export type Token = { kata: string[]; angka: string[] };

/**
 * Pecah uraian jadi token kata + token ANGKA (dipisah, karena bobotnya beda).
 *
 * Awalan satuan pada uraian AHSP ("1 m3 Beton mutu…") dibuang: itu penanda
 * satuan analisa, bukan bagian nama pekerjaan, dan kalau ikut dihitung ia
 * menyumbang kemiripan palsu ke semua analisa bersatuan sama.
 */
export function tokenisasi(raw: string): Token {
  const bersih = raw
    .toLowerCase()
    .replace(/^\s*\d+\s*(m³|m²|m¹|m'|m3|m2|m1|kg|buah|unit|kali|set|titik|ls|m)\b\s*/i, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}.,]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const kata: string[] = [];
  const angka: string[] = [];
  for (const t of bersih.split(" ")) {
    if (!t) continue;
    // Angka: termasuk bentuk "13", "0,45", "fc25" dipisah jadi kata+angka.
    const cocokAngka = t.match(/\d+(?:[.,]\d+)?/g);
    if (cocokAngka) {
      for (const a of cocokAngka) angka.push(a.replace(",", "."));
    }
    const sisa = t.replace(/\d+(?:[.,]\d+)?/g, "").replace(/[.,]/g, "");
    if (sisa.length >= 2 && !KATA_UMUM.has(sisa)) kata.push(sisa);
  }
  return { kata: [...new Set(kata)], angka: [...new Set(angka)] };
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const sama = a.filter((x) => setB.has(x)).length;
  return (2 * sama) / (a.length + b.length);
}

export type KandidatAhsp = {
  id: string;
  kode: string;
  uraian: string;
  satuan: string;
  bidang: string;
  perluVerifikasi: boolean;
  punyaKomponen: boolean;
  token: Token;
  satuanNorm: string;
};

export type ItemRab = { uraian: string; satuan: string | null };

/** Ambang skor: di bawah ini dianggap TIDAK ADA padanan, bukan "yang terbaik". */
export const AMBANG_COCOK = 0.42;
/**
 * Kemiripan KATA minimal sebelum kecocokan angka boleh menaikkan skor. Di bawah
 * ini, angka yang sama dianggap kebetulan — bukan bukti pekerjaan yang sama.
 */
export const AMBANG_KATA = 0.34;
/** Selisih skor minimal terhadap runner-up supaya pilihan disebut meyakinkan. */
export const AMBANG_YAKIN = 0.08;

export type Usulan = {
  kandidat: KandidatAhsp;
  skor: number;
  /** true = unggul cukup jauh dari kandidat kedua. */
  meyakinkan: boolean;
  alasan: string;
};

/**
 * Skor 0..1 antara satu item RAB dan satu analisa AHSP.
 *
 * Bobotnya sengaja timpang: kecocokan ANGKA dan SATUAN bisa menjatuhkan skor
 * jauh, karena keduanya yang membedakan pekerjaan yang teksnya nyaris sama.
 */
export function skorCocok(item: Token, satuanItem: string, k: KandidatAhsp): number {
  const skorKata = dice(item.kata, k.token.kata);
  if (skorKata === 0) return 0;
  let skor = skorKata;

  /*
   * ANGKA menajamkan, TIDAK menyelamatkan.
   *
   * Angka adalah penentu antara dua analisa yang katanya nyaris sama (fc 25 vs
   * fc 10). Tapi kalau KATANYA saja sudah tidak mirip, angka yang kebetulan
   * sama tidak boleh mengangkatnya — diukur pada data nyata: "Urugan Sirtu
   * t = 10 cm" sempat menang atas "Shotcrete Wiremesh M10 (t = 10 cm)" dengan
   * 65% justru karena angkanya cocok.
   */
  const adaAngka = item.angka.length > 0 && k.token.angka.length > 0;
  if (adaAngka) {
    const cocokAngka = dice(item.angka, k.token.angka);
    if (cocokAngka === 0) skor *= 0.35; // angka bertabrakan → hampir pasti salah
    else if (skorKata >= AMBANG_KATA) skor = skor * 0.7 + cocokAngka * 0.3;
  } else if (item.angka.length > 0 || k.token.angka.length > 0) {
    // Satu sisi menyebut spesifikasi angka, sisi lain tidak — mungkin, tapi
    // lebih lemah daripada dua-duanya polos.
    skor *= 0.9;
  }

  // SATUAN: m3 vs kg bukan variasi penulisan, itu pekerjaan yang berbeda.
  if (satuanItem && k.satuanNorm) {
    if (satuanItem === k.satuanNorm) skor = Math.min(1, skor + 0.12);
    else skor *= 0.55;
  }

  // Analisa yang menurut sumbernya sendiri perlu diverifikasi tidak boleh
  // menang tipis dari analisa kanonik.
  if (k.perluVerifikasi) skor *= 0.85;
  // Analisa tanpa koefisien terstruktur tidak bisa dipakai menghitung apa pun.
  if (!k.punyaKomponen) skor *= 0.8;

  return skor;
}

/**
 * Usulkan padanan terbaik. `null` = tidak ada yang cukup meyakinkan — dan itu
 * jawaban yang sah, lihat catatan di kepala berkas.
 */
export function usulkanPadanan(item: ItemRab, kandidat: KandidatAhsp[]): Usulan | null {
  const token = tokenisasi(item.uraian);
  if (token.kata.length === 0) return null;
  const satuan = normalisasiSatuan(item.satuan);

  let terbaik: { k: KandidatAhsp; s: number } | null = null;
  let kedua = 0;
  for (const k of kandidat) {
    const s = skorCocok(token, satuan, k);
    if (!terbaik || s > terbaik.s) {
      if (terbaik) kedua = terbaik.s;
      terbaik = { k, s };
    } else if (s > kedua) {
      kedua = s;
    }
  }
  if (!terbaik || terbaik.s < AMBANG_COCOK) return null;

  const meyakinkan = terbaik.s - kedua >= AMBANG_YAKIN;
  const bagian = [`skor ${(terbaik.s * 100).toFixed(0)}%`];
  if (!meyakinkan) bagian.push("beda tipis dengan kandidat lain — perlu diperiksa");
  if (terbaik.k.perluVerifikasi) bagian.push("analisa perlu verifikasi");
  if (!terbaik.k.punyaKomponen) bagian.push("analisa belum punya koefisien terstruktur");
  return { kandidat: terbaik.k, skor: terbaik.s, meyakinkan, alasan: bagian.join("; ") };
}

/** Siapkan kandidat sekali, dipakai untuk ribuan item (token di-precompute). */
export function siapkanKandidat(
  rows: {
    id: string;
    kode: string;
    uraian: string;
    satuan: string;
    bidang: string;
    perluVerifikasi: boolean;
    jumlahKomponen: number;
  }[],
): KandidatAhsp[] {
  return rows.map((r) => ({
    id: r.id,
    kode: r.kode,
    uraian: r.uraian,
    satuan: r.satuan,
    bidang: r.bidang,
    perluVerifikasi: r.perluVerifikasi,
    punyaKomponen: r.jumlahKomponen > 0,
    token: tokenisasi(r.uraian),
    satuanNorm: normalisasiSatuan(r.satuan),
  }));
}
