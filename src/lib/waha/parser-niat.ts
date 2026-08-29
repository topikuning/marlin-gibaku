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

/**
 * KENAPA sebuah pertanyaan ambigu — dan ini bukan sekadar keterangan.
 *
 * `tanpa_niat`  : penanya TIDAK menyebut maksudnya sama sekali, hanya waktu
 *                 ("kalau kemarin?"). Pertanyaan seperti ini memang tidak
 *                 berarti apa-apa sendirian, jadi boleh dilengkapi dari
 *                 konteks pertanyaan sebelumnya.
 * `niat_bercabang`: maksudnya SUDAH disebut ("kendala minggu lalu"); yang
 *                 bercabang cuma cara membacanya. Konteks TIDAK BOLEH dipakai
 *                 di sini — meminjam niat lama berarti membuang kata yang baru
 *                 saja ditulis penanya.
 *
 * Dua-duanya dulu bertipe sama, dan `tanya.ts` memperlakukan keduanya sebagai
 * "pertanyaan susulan yang perlu dilengkapi". Akibatnya di produksi:
 * "siapa yang belum lapor kemarin?" lalu "kendala minggu lalu" dijawab
 * KELENGKAPAN LAPORAN minggu lalu — kata "kendala" ditelan mentah-mentah.
 */
export type SebabAmbigu = "tanpa_niat" | "niat_bercabang";

export type HasilParser =
  /** Satu tafsir, dan tidak ada saingannya. Langsung dijalankan. */
  | { jenis: "yakin"; kandidat: KandidatNiat }
  /** 2–3 tafsir yang sama masuk akal. Penanya yang memilih. */
  | { jenis: "ambigu"; sebab: SebabAmbigu; kandidat: KandidatNiat[] }
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
  /*
   * RENCANA ditulis SEBELUM `laporan_mingguan`, dan bentuk "rencana mingguan"
   * sengaja ditaruh paling depan di dalam alternasinya sendiri.
   *
   * Sebabnya `buangYangTermuat` membandingkan RENTANG TEKS: kalau yang cocok
   * hanya kata "rencana", potongan "mingguan" di sebelahnya tetap menjadi
   * temuan `laporan_mingguan` yang terpisah, dan pertanyaan yang gamblang
   * berubah jadi ambigu. Dengan potongan yang menelan kedua katanya, niat
   * mingguan yang termuat di dalamnya gugur sebagaimana mestinya.
   */
  {
    niat: "rencana",
    pola: /\b(rencana (?:mingguan|kerja|minggu\w*|pekan\w*)|rencana\w*|jadwal kerja|akan dikerjakan|mau dikerjakan|yang perlu dikerjakan|perlu dilakukan|harus dikerjakan|target mingguan)\b/,
  },
  { niat: "laporan_bulanan", pola: /\b(laporan bulanan|rekap bulanan|bulanan|progress bulanan|rekap bulan)\b/ },
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

/**
 * KATA KERJA PRODUKSI/DISTRIBUSI ARTEFAK.
 *
 * Dirancang supaya TIDAK termakan dua jebakan bahasa Indonesia:
 *
 * 1. "buat" juga berarti "untuk". *"laporan buat direksi"* adalah permintaan
 *    MELIHAT laporan, bukan membuatnya — karena itu kata kerjanya wajib diikuti
 *    kata benda artefak, dan "direksi" bukan artefak.
 * 2. "kirim laporan" bisa berarti pelapor MENGAKU sudah mengirim. Karena itu
 *    "sudah"/"belum" di depannya membatalkan — kalimat itu urusan niat
 *    `kelengkapan`, bukan perintah kepada MARLIN.
 */
const ARTEFAK = "laporan|rekap|paparan|ringkasan|excel|xls\\w*|pdf|slide|dokumen|berkas|grafik|kurva";
const POLA_PRODUKSI = new RegExp(
  [
    // buatkan/susun/cetak … <artefak>  (boleh disela maks 2 kata: "buatkan saya laporan")
    `\\b(?:buat|bikin|susun|siapkan|terbitkan|cetak|print|generate)(?:kan)?\\s+(?:\\w+\\s+){0,2}?(?:${ARTEFAK})\\b`,
    // export/unduh berdiri sendiri — objeknya selalu artefak
    "\\b(?:export|ekspor|eksport|unduh|download)\\b",
    // kirim(kan) … <artefak>, kecuali didahului "sudah"/"belum"
    `(?<!sudah )(?<!belum )\\bkirim(?:kan)?\\s+(?:\\w+\\s+){0,2}?(?:${ARTEFAK})\\b`,
  ].join("|"),
);

const LABEL_NIAT: Record<Niat, string> = {
  kendala: "Kendala yang masih terbuka",
  kendala_dibuka: "Semua kendala yang DIBUKA",
  // Dipakai lewat LABEL_PERIODE_DI_TENGAH – periodenya masuk ke tengah kalimat.
  kendala_periode_terbuka: "Kendala yang MASIH TERBUKA sekarang",
  progress: "Progress pekerjaan",
  deviasi: "Deviasi terhadap kurva-S",
  kelengkapan: "Siapa yang sudah/belum lapor",
  laporan: "Isi laporan harian",
  laporan_mingguan: "Rekap laporan mingguan",
  laporan_bulanan: "Rekap laporan bulanan",
  rencana: "Rencana kerja",
  produksi: "Membuat/mengirim laporan",
  bantuan: "Daftar yang bisa saya jawab",
};

/**
 * Penanda bahwa yang ditanya adalah pekan YANG AKAN DATANG.
 *
 * Sengaja BUKAN bagian dari tabel `PERIODE`. Seluruh modul tanggal
 * (`tanya-tanggal.ts`) memang dibangun menghadap ke belakang — ia menolak
 * tanggal depan dengan sadar, karena "hari yang belum terjadi" akan dijawab
 * dengan data kosong yang terbaca seperti "tidak ada pekerjaan". Menambahkan
 * periode maju ke tabel itu akan melonggarkan penjagaan tersebut untuk SEMUA
 * niat, demi satu niat yang memang berbeda sifatnya.
 *
 * Jadi penanda ini hanya dibaca oleh niat `rencana`, yang datanya
 * (`WeeklyPlan`) memang bernomor pekan, bukan bertanggal laporan.
 */
const POLA_KE_DEPAN =
  /\b(?:(?:se)?(?:minggu|pekan)\s+(?:ini\s+)?ke\s?depan|(?:minggu|pekan)\s+depan|ke\s?depan|kedepan|mendatang|selanjutnya|berikutnya)\b/;

export function mintaPekanDepan(teksMentah: string): boolean {
  // Kata urutan dibuang dulu: "paling depan" adalah superlatif, bukan waktu.
  return POLA_KE_DEPAN.test(hapusUrutan(bersih(teksMentah)));
}

/** Periode yang artinya "hari ini" — di situ kendala tidak ambigu. */
function periodeHariIni(p: PeriodeDiminta): boolean {
  if (p.jenis === "hari_ini") return true;
  // "minggu ini"/"bulan ini" MEMUAT hari ini, tapi tetap sebuah rentang lampau
  // + berjalan; pertanyaannya tetap dua tafsir. Hanya `mundur_hari: 0` yang
  // benar-benar berarti hari ini.
  return p.jenis === "mundur_hari" && p.hari === 0;
}

/**
 * Label yang periodenya duduk di TENGAH kalimat, bukan ditempel di belakang.
 *
 * Bawaannya `LABEL_NIAT[niat] + labelPeriode(...)`, dan itu benar untuk hampir
 * semua niat. Tapi untuk `kendala_periode_terbuka` hasilnya berbunyi *"Kendala
 * dari periode itu yang MASIH TERBUKA sekarang minggu lalu"* – artinya tidak
 * salah, bacaannya yang jelek, dan ini kalimat yang dibaca orang lapangan
 * sebagai PILIHAN yang harus mereka putuskan. Pilihan yang canggung dibaca
 * ulang dua kali, lalu ditebak.
 *
 * Ketahuan saat menyusun naskah uji manual (`SKENARIO_UJI_WA_AI.md`) – yaitu
 * saat balasannya ditulis apa adanya untuk dibaca orang, bukan diperiksa
 * sebagai `toContain("MASIH TERBUKA")`.
 */
const LABEL_PERIODE_DI_TENGAH: Partial<Record<Niat, (periode: string) => string>> = {
  kendala_periode_terbuka: (p) => `Kendala${p} yang MASIH TERBUKA sekarang`,
};

function kandidat(niat: Niat, periode: PeriodeDiminta | null, imbuhan = ""): KandidatNiat {
  const teksPeriode = imbuhan || labelPeriode(periode);
  const khusus = LABEL_PERIODE_DI_TENGAH[niat];
  return {
    niat,
    lokasiDisebut: [],
    periode: periode ?? { jenis: "hari_ini" },
    label: khusus ? khusus(teksPeriode) : `${LABEL_NIAT[niat]}${teksPeriode}`,
  };
}

export function parseNiatDeterministik(teksMentah: string): HasilParser {
  const t = bersih(teksMentah);
  if (!t) return { jenis: "tidak_tahu" };

  const periode = bacaPeriodeTeks(teksMentah);

  /*
   * KATA KERJA MENANG ATAS KATA BENDA (audit 2026-08-28).
   *
   * Diperiksa PALING AWAL, sebelum tabel kata kunci. Sebabnya urutan itu yang
   * salah selama ini: pola `laporan` cocok dengan kalimat mana pun yang memuat
   * kata "laporan", jadi *"buatkan laporan eksekutif untuk direksi"* keluar
   * sebagai niat `laporan` — dan `yakin`, sehingga tidak jatuh ke AI dan tidak
   * menawarkan pilihan apa pun. Penanya menerima isi laporan harian HARI INI:
   * jawaban yang rapi, bersumber, dan bukan yang ia minta.
   *
   * Perintah membuat/mengirim artefak adalah maksud tersendiri, bukan varian
   * dari melihat data. Yang menentukan kata KERJANYA.
   */
  if (POLA_PRODUKSI.test(t)) {
    return { jenis: "yakin", kandidat: kandidat("produksi", periode) };
  }
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
      sebab: "tanpa_niat",
      kandidat: [
        kandidat("progress", periode),
        kandidat("laporan", periode),
        /*
         * Kendala MENGHORMATI periode yang ditulis penanya (DECISIONS 381).
         *
         * Dulu kandidat ini sengaja tanpa imbuhan periode dan berbunyi "(yang
         * masih terbuka sekarang)", karena MARLIN belum bisa menjawab kendala
         * per periode sama sekali. Sejak `kendala_dibuka` ada, kalimat itu
         * berubah dari pengakuan jujur menjadi pembatasan yang tidak perlu:
         * orang yang menulis "kemarin" memang menanyakan kemarin.
         */
        kandidat("kendala_dibuka", periode),
      ],
    };
  }

  /*
   * "kendala" + periode LAMPAU = dua tafsir yang sama masuk akal
   * (DECISIONS 381), dan penanya yang memilih — bukan MARLIN.
   *
   * *"kendala minggu lalu"* bisa berarti **semua yang dibuka** minggu lalu
   * (apa pun statusnya sekarang) atau **yang dibuka minggu lalu dan masih
   * terbuka**. Dua-duanya bisa dijawab dari `Issue.createdAt` + status
   * terkini — tidak butuh riwayat status.
   *
   * Sebelumnya MARLIN memilih sendiri: ia menjawab SEMUA yang terbuka
   * sekarang, kapan pun dibukanya, lalu menempelkan catatan bahwa itu bukan
   * keadaan pada periode yang ditanya. Jujur, tapi menjawab pertanyaan yang
   * tidak ditanyakan — padahal mesin klarifikasi (DECISIONS 376) memang ada
   * untuk kasus persis ini.
   */
  if (cocok.length === 1 && cocok[0] === "kendala" && periode && !periodeHariIni(periode)) {
    return {
      jenis: "ambigu",
      sebab: "niat_bercabang",
      kandidat: [
        kandidat("kendala_dibuka", periode),
        kandidat("kendala_periode_terbuka", periode),
      ],
    };
  }

  /*
   * "laporan" + periode RENTANG sengaja TIDAK ditawarkan sebagai pilihan.
   *
   * Sekilas ia kandidat sempurna: laporan harian selalu SATU tanggal sedangkan
   * rekap mingguan meliputi sepekan, jadi keduanya terasa sama masuk akal.
   * Tapi kasus ini SUDAH diputus di DECISIONS 358, sesudah keluhan user
   * 2026-08-18: jawabannya laporan harian pada hari terakhir rentang, DAN
   * balasannya menyebut tanggal mana yang diambil beserta cara meminta rekap
   * sepekan.
   *
   * Menawarkan pilihan di sini berarti menarik kembali keputusan itu — menukar
   * jawaban langsung yang sudah jujur dengan satu putaran tanya-jawab tambahan,
   * untuk mandor yang sedang di lapangan. Tawaran pilihan disediakan untuk yang
   * BELUM pernah diputuskan, bukan untuk membuka ulang yang sudah selesai.
   */

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
/**
 * URUTAN yang diminta penanya — "progress terbaik", "yang paling tertinggal".
 *
 * Cacat produksi 2026-08-20, dilaporkan user dengan tangkapan layar: pertanyaan
 * *"progress terbaik"* dijawab daftar lokasi ber-realisasi 0,00% – yaitu justru
 * yang TERBURUK, diurut abjad. Dua sebab bertumpuk:
 *
 * 1. sebagian kata superlatif ("tertinggi", "terendah", "terburuk", "paling")
 *    dulu ada di `KATA_ABAIKAN`, jadi DIBUANG diam-diam sebagai kata sampah;
 * 2. yang tidak ada di sana ("terbaik") membuat pertanyaannya dilempar ke AI,
 *    dan AI mengembalikan niat `progress` tanpa membawa superlatifnya.
 *
 * Dua-duanya berujung sama: kata yang justru menentukan isi jawaban hilang
 * tanpa jejak, dan penanya menerima daftar yang berkebalikan dengan yang ia
 * minta – tanpa satu pun tanda bahwa permintaannya tidak dipenuhi.
 *
 * Diam-diam mengabaikan kata adalah bentuk mengarang yang paling halus: yang
 * dikarang bukan angkanya, melainkan PERTANYAANNYA.
 */
export type UrutanJawaban = "terbaik" | "terburuk";

const URUTAN: { arah: UrutanJawaban; pola: RegExp }[] = [
  {
    arah: "terbaik",
    pola: /\b(terbaik|tertinggi|terbesar|teratas|termaju|paling (?:baik|bagus|tinggi|besar|maju|depan))\b/,
  },
  {
    arah: "terburuk",
    pola: /\b(terburuk|terjelek|terendah|terkecil|terparah|terbelakang|paling (?:buruk|jelek|rendah|kecil|parah|ketinggalan|tertinggal|belakang))\b/,
  },
];

/** Arah urutan yang diminta, atau null bila penanya tidak menyebut apa pun. */
/**
 * Perintah MELEPAS konteks – "abaikan", "lupakan", "mulai lagi".
 *
 * Bukan pertanyaan, jadi ia diperiksa sebelum niat apa pun. Ditambahkan karena
 * user benar-benar mengetiknya secara alami saat jawabannya melenceng, dan
 * MARLIN membalas "belum mengerti" sambil tetap memegang konteks yang salah.
 */
const POLA_LUPAKAN =
  /^(abaikan|lupakan|lupain|batal|batalkan|reset|ulang|mulai lagi|mulai dari awal|hapus konteks|lupakan yang tadi|abaikan yang tadi)\b/;

/**
 * Pertanyaan SEBAB — "kenapa", "mengapa", "apa penyebabnya" (DECISIONS 390).
 *
 * Keberatan user 2026-08-20: *"kenapa randuputih tertinggal, malah cuma jawab
 * progress"*. Balasannya benar – deviasi −30,93% – tapi ia menjawab "berapa",
 * bukan "kenapa". Angkanya justru sudah diketahui penanya; itu sebabnya ia
 * bertanya.
 *
 * Jawabannya bukan menukar angka dengan cerita, melainkan MENAMBAHKAN: angka
 * resmi tetap di depan, catatan lapangan yang menjelaskannya menyusul sebagai
 * kutipan bertanda.
 */
const POLA_SEBAB = /\b(kenapa|mengapa|kok|knp|apa (?:sebab|penyebab|alasan)\w*|penyebabnya|sebabnya)\b/;

export function mintaSebab(teksMentah: string): boolean {
  return POLA_SEBAB.test(bersih(teksMentah));
}

export function mintaLupakanKonteks(teksMentah: string): boolean {
  return POLA_LUPAKAN.test(bersih(teksMentah));
}

/**
 * "5 terbaik" → 5. Berapa banyak baris yang diminta penanya (DECISIONS 449).
 *
 * Keberatan user 2026-08-26: *"pertanyaan ke wa 'progress hari ini' dan
 * 'progress 5 terbaik' sama sekali tidak memberikan perbedaan hasil"*. Dua
 * sebabnya bertumpuk, dan angka inilah yang pertama: "5" bukan nama lokasi,
 * tapi dulu ia diperlakukan sebagai kata sisa yang tidak dikenal — sehingga
 * seluruh kalimat diserahkan ke AI, dan di jalur itu urutannya hilang.
 *
 * Hanya dibaca BERSAMA kata urutan. "progress 5" sendirian tidak berarti
 * "lima teratas" — ia tidak berarti apa-apa, dan menebaknya lebih buruk
 * daripada menyerah.
 *
 * Batasnya 1–99: angka lain hampir pasti bukan cacahan baris (tahun, nomor
 * kontrak), dan menafsirkannya sebagai cacahan akan diam-diam memotong daftar.
 */
export function bacaBatas(teksMentah: string): number | null {
  const t = bersih(teksMentah);
  const m = /\b(\d{1,2})\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

export function bacaUrutan(teksMentah: string): UrutanJawaban | null {
  const t = bersih(teksMentah);
  for (const u of URUTAN) if (u.pola.test(t)) return u.arah;
  return null;
}

/** Buang kata urutan dari kalimat — ia modifier, bukan nama lokasi. */
function hapusUrutan(t: string): string {
  let out = t;
  for (const u of URUTAN) out = out.replace(new RegExp(u.pola.source, "g"), " ");
  return out;
}

const KATA_ABAIKAN = new Set(
  ("di ke dari pada untuk yang apa apakah siapa mana bagaimana gimana kenapa berapa ada adakah " +
    "itu ini dan atau saja aja per semua seluruh sudah belum masih lagi dong ya yah nih sih kah kok " +
    "tolong minta mintakan kirim kirimkan coba mohon bisa boleh mau ingin lihat cek update info " +
    "status kondisi lokasi lokasinya tempat titik proyek pekerjaan gak nggak tidak bukan " +
    "negatif positif minus turun naik " +
    "pak bu bapak ibu halo hai selamat pagi siang sore malam terima kasih min admin marlin " +
    // Penyambung pertanyaan SUSULAN — "kalau kemarin?", "terus minggu lalu?".
    // Tanpa ini satu kata sambung membuat susulan yang paling lazim diketik
    // dilempar ke AI, justru pada jalur yang dibuat untuk menghindarinya.
    "kalau kalo klo terus trus lalu nah oke ok juga sama gimana bagaimana yg " +
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
  // Penanda "ke depan" DIJELASKAN, bukan dibiarkan jadi kata asing. Tanpa baris
  // ini, "rencana seminggu ke depan" melaporkan *"Tidak saya kenali: seminggu,
  // depan"* — persis balasan yang dikeluhkan user 2026-08-28, di bawah jawaban
  // yang juga sudah salah.
  let sisa = hapusUrutan(hapusPeriode(bersih(teksMentah))).replace(
    new RegExp(POLA_KE_DEPAN.source, "g"),
    " ",
  );
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
  | {
      jenis: "jalan";
      niat: Niat;
      periode: PeriodeDiminta;
      lokasiDisebut: string[];
      /** Urutan yang diminta penanya; null = urutan bawaan. */
      urutan: UrutanJawaban | null;
      /** Banyak baris yang diminta ("5 terbaik"); null = batas bawaan. */
      batas: number | null;
    }
  /** Jelas tafsirnya terbatas — tawarkan pilihan, juga tanpa AI. */
  | { jenis: "ambigu"; sebab: SebabAmbigu; kandidat: KandidatNiat[] }
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
  const urutan = bacaUrutan(teksMentah);
  // Angka hanya berarti cacahan baris bila ada kata urutannya; tanpa itu ia
  // tetap kata asing dan kalimatnya diserahkan ke AI seperti dulu.
  const batas = urutan ? bacaBatas(teksMentah) : null;

  const sisa = frasaSisa(teksMentah).filter((f) => batas == null || f !== String(batas));
  for (const f of sisa) {
    if (cocokkanLokasi(f, katalog).jenis === "tidak_ada") {
      return { jenis: "serahkan_ai", alasan: `kata di luar katalog: "${f}"` };
    }
  }

  if (parse.jenis === "ambigu") {
    return {
      jenis: "ambigu",
      sebab: parse.sebab,
      kandidat: parse.kandidat.map((k) => ({ ...k, lokasiDisebut: sisa })),
    };
  }
  /*
   * Urutan hanya berlaku untuk niat yang PUNYA angka untuk diurutkan.
   *
   * Kalau penanya menulis superlatif pada niat lain ("kendala terparah"),
   * pertanyaannya diserahkan ke AI alih-alih dijawab sambil membuang katanya —
   * karena membuangnya diam-diam persis kesalahan yang sedang diperbaiki di
   * sini.
   */
  const niat = parse.kandidat.niat;
  const bisaDiurut = niat === "progress" || niat === "deviasi";
  if (urutan && !bisaDiurut) {
    return { jenis: "serahkan_ai", alasan: `urutan "${urutan}" tidak berlaku untuk niat ${niat}` };
  }
  return {
    jenis: "jalan",
    niat,
    periode: parse.kandidat.periode,
    lokasiDisebut: sisa,
    urutan: bisaDiurut ? urutan : null,
    batas: bisaDiurut ? batas : null,
  };
}
