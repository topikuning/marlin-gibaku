import { cocokkanLokasi, type LokasiKatalog, type Niat } from "./tanya-niat";
import type { PeriodeDiminta } from "./tanya-tanggal";

/**
 * PARSER NIAT DETERMINISTIK + kandidat maksud (DECISIONS 375).
 *
 * MURNI: tanpa DB, tanpa AI. Dua tugas yang saling menyambung.
 *
 * ### 1. Pola yang jelas TIDAK perlu AI
 *
 * Sebelumnya SETIAP pertanyaan bebas memanggil provider AI, termasuk
 * *"progress hari ini"* yang tidak punya tafsir kedua. Ongkosnya bukan cuma
 * uang: tiap panggilan menambah 1–3 detik sebelum balasan muncul, memakai kuota
 * yang dibagi seluruh organisasi, dan membuat fitur ini MATI TOTAL setiap kali
 * provider-nya sedang bermasalah. Perintah sederhana seharusnya tetap bisa
 * dipakai saat AI mati.
 *
 * ### 2. Yang tidak jelas DITAWARKAN, bukan ditolak
 *
 * Keberatan user 2026-08-19: `niat = null → balasTidakMengerti()` terlalu cepat
 * menyerah dan membuang waktu. *"bagaimana yang kemarin?"* memang tidak pasti —
 * tapi tafsirnya hanya dua atau tiga, dan menyebutkannya jauh lebih menolong
 * daripada menyodorkan menu kemampuan yang sama untuk semua orang.
 *
 * Karena itu keluarannya KANDIDAT, bukan satu niat. Kandidatnya sempit (maks 3)
 * dan tetap melewati resolver tanggal, izin, dan calculation layer setelah
 * dipilih — persis seperti niat dari AI. Parser ini tidak pernah menjadi sumber
 * angka.
 */

export type KandidatNiat = {
  niat: Niat;
  lokasiDisebut: string[];
  periode: PeriodeDiminta;
  /** Kalimat pilihan untuk penanya. Harus menyebut kata yang IA tulis. */
  label: string;
};

export type HasilParser =
  /** Satu tafsir, dan tidak ada saingannya. Langsung dijalankan. */
  | { jenis: "yakin"; kandidat: KandidatNiat }
  /** 2–3 tafsir yang sama masuk akal. Penanya yang memilih. */
  | { jenis: "ambigu"; kandidat: KandidatNiat[] }
  /** Tidak ada petunjuk sama sekali — serahkan ke AI. */
  | { jenis: "tidak_tahu" };

const bersih = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const BULAN: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12,
};

/**
 * Periode dari TEKS MENTAH — pasangan deterministik `bacaPeriode`, yang membaca
 * bentuk terstruktur dari AI.
 *
 * `null` = penanya tidak menyebut waktu sama sekali. Itu BUKAN "hari ini":
 * bedanya menentukan apakah kita boleh yakin. "progress" tanpa keterangan waktu
 * memang berarti hari ini, tapi "bagaimana yang kemarin" menyebut waktu tanpa
 * menyebut niat — dan justru itu yang perlu ditanyakan balik.
 */
/**
 * Pola periode — SATU tabel, dipakai dua arah.
 *
 * `bacaPeriodeTeks` memakainya untuk MEMBACA, `hapusPeriode` untuk MEMBUANG
 * potongan waktu sebelum sisa kalimat diperiksa. Dulu keduanya akan jadi dua
 * daftar terpisah, dan daftar kedua yang tertinggal satu pola berarti kata waktu
 * tersisa sebagai "kata yang tidak dikenali" — lalu pertanyaan yang sudah jelas
 * dilempar ke AI karena kata "kemarin"-nya sendiri dianggap mencurigakan.
 *
 * Urutan mengikat: yang lebih panjang lebih dulu. "kemarin lusa" memuat kata
 * "kemarin", jadi urutan terbalik akan SELALU membacanya 1 hari.
 */
const PERIODE: { pola: RegExp; baca: (m: RegExpMatchArray) => PeriodeDiminta | null }[] = [
  { pola: /\b(?:hari ini|sekarang)\b/, baca: () => ({ jenis: "hari_ini" }) },
  {
    pola: /\b(?:kemarin lusa|kemaren lusa|dua hari (?:yang )?lalu)\b/,
    baca: () => ({ jenis: "mundur_hari", hari: 2 }),
  },
  { pola: /\b(?:kemarin|kemaren)\b/, baca: () => ({ jenis: "mundur_hari", hari: 1 }) },
  {
    pola: /\b(\d{1,3}) hari (?:yang )?lalu\b/,
    baca: (m) => ({ jenis: "mundur_hari", hari: Number(m[1]) }),
  },
  {
    pola: /\b(?:minggu (?:ini|berjalan)|pekan ini)\b/,
    baca: () => ({ jenis: "rentang", satuan: "minggu", mundur: 0 }),
  },
  {
    pola: /\b(?:minggu (?:lalu|kemarin)|pekan (?:lalu|kemarin))\b/,
    baca: () => ({ jenis: "rentang", satuan: "minggu", mundur: 1 }),
  },
  { pola: /\bbulan ini\b/, baca: () => ({ jenis: "rentang", satuan: "bulan", mundur: 0 }) },
  {
    pola: /\bbulan (?:lalu|kemarin)\b/,
    baca: () => ({ jenis: "rentang", satuan: "bulan", mundur: 1 }),
  },
  // "17 agustus", "17 agustus 2026"
  {
    pola: /\b(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\b/,
    baca: (m) =>
      BULAN[m[2]]
        ? {
            jenis: "tanggal",
            hari: Number(m[1]),
            bulan: BULAN[m[2]],
            tahun: m[3] ? Number(m[3]) : null,
          }
        : null,
  },
  {
    pola: /\btanggal (\d{1,2})\b/,
    baca: (m) => ({ jenis: "tanggal", hari: Number(m[1]), bulan: null, tahun: null }),
  },
];

export function bacaPeriodeTeks(teksMentah: string): PeriodeDiminta | null {
  const t = bersih(teksMentah);
  for (const p of PERIODE) {
    const m = t.match(p.pola);
    if (!m) continue;
    const hasil = p.baca(m);
    if (hasil) return hasil;
  }
  return null;
}

/**
 * Kata kunci per niat. Sengaja sempit — ragu berarti serahkan ke AI.
 *
 * Akhiran DITOLERANSI (`\w*`): bahasa lapangan menulis "deviasinya",
 * "progresnya", "kendalanya", "laporannya". Menuntut kata dasar telanjang
 * berarti melempar pertanyaan yang sudah jelas ke AI hanya karena satu sufiks —
 * dan justru bentuk bersufiks itulah yang paling sering diketik orang.
 *
 * Urutannya berarti: yang lebih SPESIFIK ditulis lebih dulu, karena kata
 * kuncinya saling memuat ("belum lapor" memuat "lapor", "laporan mingguan"
 * memuat "laporan"). Lihat `buangYangTermuat`.
 */
const KUNCI: { niat: Niat; pola: RegExp }[] = [
  { niat: "bantuan", pola: /\b(bantuan\w*|bisa apa|apa saja yang bisa|kamu bisa|help|menu)\b/ },
  { niat: "laporan_mingguan", pola: /\b(laporan mingguan|rekap mingguan|mingguan|progress mingguan|rekap pekan)\b/ },
  { niat: "kendala", pola: /\b(kendala\w*|masalah\w*|hambatan\w*|problem\w*)\b/ },
  { niat: "deviasi", pola: /\b(deviasi\w*|terlambat\w*|tertinggal\w*|keterlambatan\w*|telat\w*)\b/ },
  // "siapa yang belum" IKUT menelan kata "lapor"/"kirim" di belakangnya. Kalau
  // tidak, potongan yang cocok berhenti di "belum" sementara "lapor" tertinggal
  // di luar — dan niat `laporan` ikut kena di potongan yang tersisa itu, seolah
  // penanya menyebut dua maksud. Pola harus mengaku seluas jangkauannya.
  {
    niat: "kelengkapan",
    pola: /\b(belum lapor\w*|sudah lapor\w*|siapa yang belum(?: lapor\w*| kirim\w*)?|kelengkapan\w*|belum kirim)\b/,
  },
  { niat: "progress", pola: /\b(progress\w*|progres\w*|kemajuan\w*|realisasi\w*|sudah sampai mana|berapa persen)\b/ },
  { niat: "laporan", pola: /\b(laporan\w*|lapor\w*)\b/ },
];

type Temuan = { niat: Niat; mulai: number; akhir: number };

/**
 * Buang niat yang kata kuncinya TERMUAT di dalam kata kunci niat lain.
 *
 * Sebabnya bahasa, bukan selera: *"siapa yang belum lapor"* memuat kata
 * "lapor", jadi pola `kelengkapan` dan `laporan` sama-sama kena — padahal
 * penanya hanya menulis SATU maksud. Begitu pula "laporan mingguan" yang selalu
 * memuat "laporan". Memperlakukan pasangan seperti itu sebagai dua niat yang
 * bersaing berarti melempar pertanyaan yang sudah gamblang ke AI.
 *
 * Yang benar-benar bersaing menempati potongan teks yang TERPISAH — "kendala
 * apa yang bikin progress turun" menyebut dua hal di dua tempat berbeda, dan
 * itu memang layak ditimbang AI.
 *
 * Perbandingannya rentang teks, bukan daftar pasangan yang di-hardcode: menulis
 * pasangannya satu per satu berarti tiap kata kunci baru diam-diam menambah
 * lubang yang sama.
 */
function buangYangTermuat(temuan: Temuan[]): Niat[] {
  return temuan
    .filter(
      (a) =>
        !temuan.some((b) => b !== a && b.mulai <= a.mulai && b.akhir >= a.akhir && b.akhir - b.mulai > a.akhir - a.mulai),
    )
    .map((t) => t.niat);
}

/** Sebutan untuk pilihan — memakai kata penanya bila ada, bukan istilah baku. */
function labelPeriode(p: PeriodeDiminta | null): string {
  if (!p) return "";
  switch (p.jenis) {
    case "hari_ini":
      return " hari ini";
    case "mundur_hari":
      return p.hari === 1 ? " kemarin" : p.hari === 2 ? " kemarin lusa" : ` ${p.hari} hari lalu`;
    case "rentang":
      return ` ${p.satuan} ${p.mundur === 0 ? "ini" : "lalu"}`;
    case "tanggal":
      return ` tanggal ${p.hari}`;
  }
}

const LABEL_NIAT: Record<Niat, string> = {
  kendala: "Kendala yang masih terbuka",
  progress: "Progress pekerjaan",
  deviasi: "Deviasi terhadap kurva-S",
  kelengkapan: "Siapa yang sudah/belum lapor",
  laporan: "Isi laporan harian",
  laporan_mingguan: "Rekap laporan mingguan",
  bantuan: "Daftar yang bisa saya jawab",
};

function kandidat(niat: Niat, periode: PeriodeDiminta | null, imbuhan = ""): KandidatNiat {
  return {
    niat,
    lokasiDisebut: [],
    periode: periode ?? { jenis: "hari_ini" },
    label: `${LABEL_NIAT[niat]}${imbuhan || labelPeriode(periode)}`,
  };
}

export function parseNiatDeterministik(teksMentah: string): HasilParser {
  const t = bersih(teksMentah);
  if (!t) return { jenis: "tidak_tahu" };

  const periode = bacaPeriodeTeks(teksMentah);
  const temuan: Temuan[] = [];
  for (const k of KUNCI) {
    const m = t.match(k.pola);
    if (m?.index != null) temuan.push({ niat: k.niat, mulai: m.index, akhir: m.index + m[0].length });
  }
  const cocok = buangYangTermuat(temuan);

  /*
   * TIDAK ADA kata niat sama sekali, tapi ADA keterangan waktu.
   *
   * Inilah contoh yang diberikan user: *"bagaimana yang kemarin?"*. Menolaknya
   * dengan menu kemampuan generik membuang waktu penanya, padahal tafsirnya
   * cuma tiga dan ketiganya bisa disebut memakai kata yang ia tulis sendiri.
   */
  if (cocok.length === 0) {
    if (!periode) return { jenis: "tidak_tahu" };
    return {
      jenis: "ambigu",
      kandidat: [
        kandidat("progress", periode),
        kandidat("laporan", periode),
        // Kendala sengaja TANPA imbuhan periode: MARLIN tidak menyimpan riwayat
        // status kendala, jadi menuliskan "kendala kemarin" di daftar pilihan
        // sudah menjanjikan yang tidak bisa ditepati (WATANYA-02).
        kandidat("kendala", periode, " (yang masih terbuka sekarang)"),
      ],
    };
  }

  /*
   * "laporan" + periode RENTANG itu genuinely dua hal, dan bedanya besar:
   * laporan harian selalu SATU tanggal, sedangkan rekap mingguan meliputi
   * sepekan. Menebak salah satunya berarti menjawab pertanyaan yang tidak
   * ditanyakan (keluhan user 2026-08-18, DECISIONS 358).
   */
  if (
    cocok.includes("laporan") &&
    !cocok.includes("laporan_mingguan") &&
    periode?.jenis === "rentang" &&
    periode.satuan === "minggu"
  ) {
    return {
      jenis: "ambigu",
      kandidat: [
        kandidat("laporan_mingguan", periode),
        kandidat("laporan", periode, " pada hari terakhir pekan itu"),
      ],
    };
  }

  // Dua niat di dua potongan teks yang terpisah → biar AI menimbang kalimat
  // utuhnya. Yang cuma saling memuat sudah disaring `buangYangTermuat`.
  if (cocok.length > 1) return { jenis: "tidak_tahu" };

  return { jenis: "yakin", kandidat: kandidat(cocok[0], periode) };
}

/* ------------------------------------------------------------------ */
/* Boleh dijalankan tanpa AI?                                          */
/* ------------------------------------------------------------------ */

/**
 * Kata yang TIDAK menambah maksud: kata tugas, kata tanya, sapaan, dan kata
 * sifat yang cuma mempertajam niat yang sudah terbaca ("negatif", "terbesar").
 *
 * Gunanya bukan memahami kalimat, melainkan menjawab satu pertanyaan sempit:
 * *masih adakah kata yang belum terjelaskan?* Kata yang tersisa dicurigai
 * sebagai nama tempat — dan bila ia tidak ada di katalog, pertanyaannya
 * DISERAHKAN ke AI, bukan dijawab untuk semua lokasi.
 */
const KATA_ABAIKAN = new Set(
  ("di ke dari pada untuk yang apa apakah siapa mana bagaimana gimana kenapa berapa ada adakah " +
    "itu ini dan atau saja aja per semua seluruh sudah belum masih lagi dong ya yah nih sih kah kok " +
    "tolong minta mintakan kirim kirimkan coba mohon bisa boleh mau ingin lihat cek update info " +
    "status kondisi lokasi lokasinya tempat titik proyek pekerjaan gak nggak tidak bukan " +
    "negatif positif minus turun naik terbesar tertinggi terendah terburuk parah paling " +
    "pak bu bapak ibu halo hai selamat pagi siang sore malam terima kasih min admin marlin " +
    "hari harinya dengan dgn sampai saat waktu jam total ringkasan rekap detail rinci").split(" "),
);

/** Buang potongan waktu dari kalimat — hanya yang benar-benar TERBACA sebagai periode. */
function hapusPeriode(t: string): string {
  let out = t;
  for (const p of PERIODE) {
    out = out.replace(new RegExp(p.pola.source, "g"), (...args) => {
      // args = [match, ...grup, offset, string]; grup yang kosong tetap undefined
      // supaya `baca` bisa membedakan "tahun tidak ditulis" dari "tahun 0".
      const m = args.slice(0, args.length - 2) as unknown as RegExpMatchArray;
      return p.baca(m) ? " " : String(args[0]);
    });
  }
  return out;
}

/**
 * Frasa yang tidak terjelaskan oleh niat, waktu, maupun kata tugas.
 *
 * Kandidat nama tempat — dikembalikan APA ADANYA seperti diketik, karena
 * pencocokannya tugas `cocokkanLokasi`, bukan tugas parser ini.
 */
export function frasaSisa(teksMentah: string): string[] {
  let sisa = hapusPeriode(bersih(teksMentah));
  for (const k of KUNCI) sisa = sisa.replace(new RegExp(k.pola.source, "g"), " ");

  const frasa: string[] = [];
  let kini: string[] = [];
  for (const kata of sisa.split(/\s+/)) {
    if (!kata || KATA_ABAIKAN.has(kata)) {
      if (kini.length) frasa.push(kini.join(" "));
      kini = [];
      continue;
    }
    kini.push(kata);
  }
  if (kini.length) frasa.push(kini.join(" "));
  return frasa;
}

export type RencanaDeterministik =
  /** Cukup jelas — dijawab TANPA memanggil AI sama sekali. */
  | { jenis: "jalan"; niat: Niat; periode: PeriodeDiminta; lokasiDisebut: string[] }
  /** Jelas tafsirnya terbatas — tawarkan pilihan, juga tanpa AI. */
  | { jenis: "ambigu"; kandidat: KandidatNiat[] }
  /** Ada yang tidak bisa dipertanggungjawabkan sendiri — biar AI yang membaca. */
  | { jenis: "serahkan_ai"; alasan: string };

/**
 * Putuskan apakah satu pertanyaan bisa dijawab tanpa AI (DECISIONS 375).
 *
 * ### Syaratnya dua, dan yang kedua yang paling menentukan
 *
 * 1. niatnya terbaca deterministik;
 * 2. **tidak ada satu kata pun yang tak terjelaskan.**
 *
 * Syarat kedua yang menjaga jalur ini tetap jujur. Tanpa itu *"progress di
 * Kedung"* akan lolos sebagai "progress" polos, lalu dijawab untuk SELURUH
 * lokasi — jawaban yang benar untuk pertanyaan yang tidak ditanyakan, dan
 * penerimanya tidak punya cara mengetahuinya. Sisa kata yang tidak cocok
 * dengan katalog karena itu DISERAHKAN ke AI, bukan diabaikan.
 *
 * Yang cocok sebagai nama diteruskan APA ADANYA ke `resolusiLokasi` — persis
 * jalur yang dilewati niat dari AI. Ambigu, wilayah, dan "tidak dikenal" tetap
 * ditangani di satu tempat, bukan diduplikasi di sini.
 */
export function rencanaDeterministik(
  teksMentah: string,
  katalog: LokasiKatalog[],
): RencanaDeterministik {
  const parse = parseNiatDeterministik(teksMentah);
  if (parse.jenis === "tidak_tahu") return { jenis: "serahkan_ai", alasan: "niat tidak terbaca" };

  const sisa = frasaSisa(teksMentah);
  for (const f of sisa) {
    if (cocokkanLokasi(f, katalog).jenis === "tidak_ada") {
      return { jenis: "serahkan_ai", alasan: `kata di luar katalog: "${f}"` };
    }
  }

  if (parse.jenis === "ambigu") {
    return { jenis: "ambigu", kandidat: parse.kandidat.map((k) => ({ ...k, lokasiDisebut: sisa })) };
  }
  return {
    jenis: "jalan",
    niat: parse.kandidat.niat,
    periode: parse.kandidat.periode,
    lokasiDisebut: sisa,
  };
}
