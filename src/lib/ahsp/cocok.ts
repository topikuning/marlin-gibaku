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

import {
  bacaIstilah,
  bacaPenulangan,
  ATURAN_KOSONG,
  type AturanIstilah,
  type Bacaan,
  type BacaanPenulangan,
} from "./istilah";

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
 * Tanda tangan satu baris RAB: uraian + satuan, dinormalkan seadanya.
 *
 * Dipakai sebagai KUNCI padanan yang tersimpan, sehingga satu koreksi manusia
 * berlaku untuk semua lokasi yang uraiannya persis sama (83 lokasi KNMP memakai
 * templat RAB yang sebagian besar identik).
 *
 * Sengaja BUKAN token pencocokan: tokenisasi membuang satuan ukur, sehingga
 * "t = 10 cm" dan "t = 10 mm" akan bertabrakan jadi satu tanda. Ketebalan 10 cm
 * dan 10 mm bukan variasi penulisan. Yang dibuang di sini hanya beda tanda baca,
 * spasi ganda, dan besar-kecil huruf — hal-hal yang memang cuma cara mengetik.
 */
export function tandaItem(uraian: string, satuan: string | null | undefined): string {
  const u = uraian
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${u}|${normalisasiSatuan(satuan)}`;
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

/** Token + hasil pembacaan istilah (alias, elemen, kelas diameter). */
export type TokenLengkap = Token & {
  istilah: Set<string>;
  elemen: Set<string>;
  kelasDiameter: string | null;
};

/**
 * Tokenisasi yang MELEWATI lapisan istilah dulu (DECISIONS 321).
 *
 * "Pekerjaan Pembesian" dan "Penulangan 1 kg" tidak beririsan sebagai teks;
 * setelah alias berkasnya diterapkan, keduanya sama-sama membawa istilah
 * kanonik `penulangan`. Alias milik analisa (`search.aliases`) ikut disatukan
 * supaya istilah lapangan pada sisi AHSP juga terbaca.
 */
export function tokenisasiLengkap(
  raw: string,
  aturan: AturanIstilah,
  aliasTambahan: string[] = [],
): TokenLengkap {
  const bacaan: Bacaan = bacaIstilah(raw, aturan);
  const dasar = tokenisasi(raw);
  const istilah = new Set(bacaan.istilah);
  for (const a of aliasTambahan) {
    for (const [frasa, kanonik] of aturan.padanan) {
      if (a.toLowerCase().includes(frasa)) istilah.add(kanonik);
    }
  }
  // Istilah kanonik ikut jadi token kata: dua uraian yang cuma sepakat lewat
  // alias tetap punya irisan yang bisa diukur.
  const kata = [...new Set([...dasar.kata, ...[...istilah].map((i) => i.replace(/ /g, ""))])];
  return {
    kata,
    angka: dasar.angka,
    istilah,
    elemen: bacaan.elemen,
    kelasDiameter: bacaan.kelasDiameter,
  };
}

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
  token: TokenLengkap;
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
 * Jalur ATURAN untuk pekerjaan penulangan (DECISIONS 321).
 *
 * Analisa penulangan dibedakan oleh elemen struktur + jenis baja + kelas
 * diameter, dan tak satu pun terbaca oleh kemiripan nama. Berkas masternya
 * membawa tabel delapan analisa yang sudah diverifikasi untuk kombinasi itu —
 * jadi di sini keputusannya DITURUNKAN dari tabel, bukan ditebak dari teks.
 *
 * Diukur pada RAB Kedung Mutih sebelum jalur ini ada: "Pembesian Besi Beton
 * D13-150 mm secara semi mekanis" menang ke "1 kg Pekerjaan baja pelat secara
 * semi mekanis" — pekerjaan yang sama sekali lain.
 */
function usulkanLewatAturanPenulangan(
  item: ItemRab,
  token: TokenLengkap,
  kandidat: KandidatAhsp[],
  aturan: AturanIstilah,
): { usulan: Usulan | null; kodeKandidat: string[] } | null {
  const rein: BacaanPenulangan | null = bacaPenulangan(item.uraian, aturan, {
    teks: "",
    istilah: token.istilah,
    elemen: token.elemen,
    kelasDiameter: token.kelasDiameter,
  });
  if (!rein || rein.kodeKandidat.length === 0) return null;

  const satuan = normalisasiSatuan(item.satuan);
  const perKode = new Map(kandidat.map((k) => [k.kode, k]));
  const cocok = rein.kodeKandidat.map((kode) => perKode.get(kode)).filter((k): k is KandidatAhsp => !!k);
  if (cocok.length === 0) return null;

  /*
   * SATUAN tetap menentukan. Analisa penulangan bersatuan kg — berkasnya
   * mengingatkan sendiri bahwa "volume BOQ perlu dikonversi/diambil dari
   * quantity take-off dalam kg". Item RAB bersatuan batang atau m' tidak boleh
   * langsung dikalikan koefisien per kg.
   */
  const satuanCocok = cocok.filter((k) => satuan !== "" && satuan === k.satuanNorm);
  const dipakai = satuanCocok.length > 0 ? satuanCocok : cocok;

  if (rein.perluKonteks || dipakai.length !== 1) {
    // Berkasnya menyuruh menampilkan kandidat dan menandai `needs_context` —
    // bukan memilih paksa. Jadi TIDAK ada usulan otomatis; kandidatnya tetap
    // dikembalikan supaya muncul paling atas saat orang mengoreksi.
    return { usulan: null, kodeKandidat: dipakai.map((k) => k.kode) };
  }

  const k = dipakai[0];
  const bagian = [
    `padanan penulangan dari tabel terverifikasi berkas AHSP (${rein.elemen}/${rein.jenisBaja}/${rein.kelasDiameter})`,
  ];
  if (satuanCocok.length === 0) bagian.push(`satuan item ${satuan || "kosong"} ≠ analisa ${k.satuanNorm}`);
  return {
    usulan: {
      kandidat: k,
      skor: 0.95,
      meyakinkan: satuanCocok.length > 0,
      alasan: bagian.join("; "),
    },
    kodeKandidat: [k.kode],
  };
}

/**
 * Skor 0..1 antara satu item RAB dan satu analisa AHSP.
 *
 * Bobotnya sengaja timpang: kecocokan ANGKA dan SATUAN bisa menjatuhkan skor
 * jauh, karena keduanya yang membedakan pekerjaan yang teksnya nyaris sama.
 */
export function skorCocok(item: TokenLengkap, satuanItem: string, k: KandidatAhsp): number {
  /*
   * TOLAKAN KERAS — panduan berkasnya menyebutnya `hard_reject`: "kelas
   * diameter bertentangan". AHSP penulangan hanya membedakan < 12 mm dan
   * ≥ 12 mm, dan kedua kelas itu berbeda koefisien. Kalau dua-duanya menyebut
   * kelas dan kelasnya berlawanan, tidak ada skor yang boleh menyelamatkannya.
   */
  if (item.kelasDiameter && k.token.kelasDiameter && item.kelasDiameter !== k.token.kelasDiameter) {
    return 0;
  }

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

  // Kelas diameter yang SEPAKAT adalah bukti teknis, bukan kemiripan nama —
  // panduan berkasnya memberinya bobot besar (`diameter_or_size_match`).
  if (item.kelasDiameter && k.token.kelasDiameter && item.kelasDiameter === k.token.kelasDiameter) {
    skor = Math.min(1, skor + 0.1);
  }
  // Elemen struktur yang bertentangan (slab vs frame) bukan variasi penulisan:
  // koefisiennya memang berbeda analisa.
  if (item.elemen.size > 0 && k.token.elemen.size > 0) {
    const sama = [...item.elemen].some((e) => k.token.elemen.has(e));
    skor = sama ? Math.min(1, skor + 0.08) : skor * 0.5;
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
export function usulkanPadanan(
  item: ItemRab,
  kandidat: KandidatAhsp[],
  aturan: AturanIstilah = ATURAN_KOSONG,
): Usulan | null {
  const token = tokenisasiLengkap(item.uraian, aturan);
  if (token.kata.length === 0) return null;

  // Jalur aturan lebih dulu: kalau berkasnya sudah memberi tabel keputusan,
  // kemiripan nama tidak berhak ikut bicara.
  const lewatAturan = usulkanLewatAturanPenulangan(item, token, kandidat, aturan);
  if (lewatAturan) return lewatAturan.usulan;

  const satuan = normalisasiSatuan(item.satuan);

  let terbaik: { k: KandidatAhsp; s: number } | null = null;
  let kedua = 0;
  let keduaK: KandidatAhsp | null = null;
  for (const k of kandidat) {
    const s = skorCocok(token, satuan, k);
    if (!terbaik || s > terbaik.s) {
      if (terbaik) {
        kedua = terbaik.s;
        keduaK = terbaik.k;
      }
      terbaik = { k, s };
    } else if (s > kedua) {
      kedua = s;
      keduaK = k;
    }
  }
  if (!terbaik || terbaik.s < AMBANG_COCOK) return null;

  const bagian = [`skor ${(terbaik.s * 100).toFixed(0)}%`];
  let meyakinkan = terbaik.s - kedua >= AMBANG_YAKIN;
  if (!meyakinkan) bagian.push("beda tipis dengan kandidat lain – perlu diperiksa");

  /*
   * KEMIRIPAN NAMA SAJA TIDAK CUKUP.
   *
   * Panduan berkasnya memberi kemiripan nama pagu skor terendah dari semua
   * sinyal (`name_similarity_only_max: 15`, sementara satuan 20, ukuran 30,
   * material+mutu 35) dan menegaskan: *"Saring kandidat berdasarkan
   * spesifikasi teknis dan satuan. Kemiripan nama saja tidak cukup."*
   *
   * Di sini itu diterjemahkan bukan sebagai penolakan — melainkan sebagai
   * larangan menyebutnya MEYAKINKAN. Padanan tanpa satu pun bukti teknis
   * (satuan, angka, istilah kanonik, kelas diameter) tetap ditampilkan sebagai
   * usulan, tapi tidak boleh lolos ke daftar "sudah pasti" tanpa dilihat orang.
   */
  const buktiTeknis =
    (satuan !== "" && satuan === terbaik.k.satuanNorm) ||
    (token.angka.length > 0 && terbaik.k.token.angka.some((a) => token.angka.includes(a))) ||
    [...token.istilah].some((i) => terbaik!.k.token.istilah.has(i)) ||
    (token.kelasDiameter !== null && token.kelasDiameter === terbaik.k.token.kelasDiameter);
  if (!buktiTeknis) {
    meyakinkan = false;
    bagian.push("cocok dari kemiripan nama saja – tanpa bukti satuan/ukuran/istilah");
  }

  /*
   * ATURAN AMBIGUITAS PENULANGAN, langsung dari berkasnya: *"Jika uraian hanya
   * menyebut pembesian/besi beton dan diameter tanpa elemen struktur, jangan
   * pilih antara AHSP slab dan AHSP kolom/balok/ring balk/sloof."* Pekerjaan
   * pembesian pelat dan pembesian kolom memakai analisa berbeda; RAB yang tidak
   * menyebut elemennya tidak bisa diputuskan dari teksnya sendiri.
   */
  const soalPenulangan = [...token.istilah].some((i) => aturan.penulangan.has(i));
  if (soalPenulangan && token.elemen.size === 0) {
    const bedaElemen =
      terbaik.k.token.elemen.size > 0 &&
      keduaK !== null &&
      keduaK.token.elemen.size > 0 &&
      ![...terbaik.k.token.elemen].some((e) => keduaK!.token.elemen.has(e));
    if (terbaik.k.token.elemen.size > 0) {
      meyakinkan = false;
      bagian.push(
        bedaElemen
          ? "uraian tidak menyebut elemen struktur, kandidatnya beda elemen – periksa gambar/parent item"
          : "uraian tidak menyebut elemen struktur – periksa gambar/parent item",
      );
    }
  }

  if (terbaik.k.perluVerifikasi) bagian.push("analisa perlu verifikasi");
  if (!terbaik.k.punyaKomponen) bagian.push("analisa belum punya koefisien terstruktur");
  return { kandidat: terbaik.k, skor: terbaik.s, meyakinkan, alasan: bagian.join("; ") };
}

/**
 * Beberapa kandidat teratas, untuk DIPILIH manusia saat mengoreksi.
 *
 * Beda tujuan dengan `usulkanPadanan`: yang itu memutuskan sendiri dan diam
 * kalau ragu; yang ini justru dipanggil ketika sudah ada yang memeriksa, jadi
 * ambangnya lebih longgar (`AMBANG_LIHAT`) — kandidat 30% yang ternyata benar
 * lebih berguna di layar daripada disembunyikan.
 */
export const AMBANG_LIHAT = 0.15;

export function peringkatPadanan(
  item: ItemRab,
  kandidat: KandidatAhsp[],
  batas = 8,
  aturan: AturanIstilah = ATURAN_KOSONG,
): { kandidat: KandidatAhsp; skor: number }[] {
  const token = tokenisasiLengkap(item.uraian, aturan);
  if (token.kata.length === 0) return [];
  const satuan = normalisasiSatuan(item.satuan);

  // Kandidat dari tabel terverifikasi ditaruh PALING ATAS: saat orang mengoreksi
  // pembesian, dua-tiga analisa yang benar harus terlihat lebih dulu, bukan
  // terkubur di bawah kemiripan nama yang kebetulan tinggi.
  const lewatAturan = usulkanLewatAturanPenulangan(item, token, kandidat, aturan);
  const kodeUtama = new Set(lewatAturan?.kodeKandidat ?? []);

  const semua = kandidat
    .map((k) => ({ kandidat: k, skor: kodeUtama.has(k.kode) ? 0.95 : skorCocok(token, satuan, k) }))
    .filter((x) => kodeUtama.has(x.kandidat.kode) || x.skor >= AMBANG_LIHAT)
    .sort(
      (a, b) =>
        Number(kodeUtama.has(b.kandidat.kode)) - Number(kodeUtama.has(a.kandidat.kode)) ||
        b.skor - a.skor,
    );
  return semua.slice(0, Math.max(batas, kodeUtama.size));
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
    /** `search.aliases` dari berkasnya; kosong untuk analisa supplemental. */
    aliases?: string[];
  }[],
  aturan: AturanIstilah = ATURAN_KOSONG,
): KandidatAhsp[] {
  return rows.map((r) => ({
    id: r.id,
    kode: r.kode,
    uraian: r.uraian,
    satuan: r.satuan,
    bidang: r.bidang,
    perluVerifikasi: r.perluVerifikasi,
    punyaKomponen: r.jumlahKomponen > 0,
    token: tokenisasiLengkap(r.uraian, aturan, r.aliases ?? []),
    satuanNorm: normalisasiSatuan(r.satuan),
  }));
}
