import "server-only";
import { db } from "@/lib/db";
import { locationScopeWhere } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { getLocationsProgress, getLocationsProgressRentang } from "@/lib/progress";
import { getStatusHarian } from "@/lib/daily-report/status-harian";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { formatTanggal, parseDateKey } from "@/lib/format";
import type { LokasiKatalog } from "./tanya-niat";
import type { UrutanJawaban } from "./parser-niat";
import { urutkanProgress } from "./urutan-progress";

export { urutkanProgress };
import type {
  BarisDeviasi,
  BarisKelengkapan,
  BarisKendala,
  BarisProgress,
} from "./tanya-format";

/**
 * PENGAMBIL ANGKA untuk tanya-jawab WhatsApp bebas (DECISIONS 339).
 *
 * Berkas ini adalah SATU-SATUNYA jembatan antara pertanyaan bebas dan data.
 * AI tidak pernah menyentuhnya: AI hanya mengisi struktur niat, lalu berkas ini
 * yang menjemput angkanya (`ai-hub/source.ts`: *"AI tidak pernah query DB"*,
 * DECISIONS 133/193).
 *
 * ### Tidak ada formula di sini
 *
 * Realisasi, rencana, dan deviasi diambil BULAT-BULAT dari `getLocationsProgress`
 * (calc layer, CLAUDE.md aturan 7). Tidak ada satu pun pembagian, persentase,
 * atau penjumlahan nilai di berkas ini — kalau suatu saat ada yang tergoda
 * menuliskannya, itu berarti angka WhatsApp mulai berbeda dari angka layar, dan
 * pembacanya tidak akan pernah tahu yang mana yang benar.
 *
 * ### Batas baris: dikirim BERTAHAP, bukan dipangkas
 *
 * Dulu tiap jawaban dipotong di baris ke-15 dan sisanya diganti kalimat
 * "Selengkapnya buka MARLIN". Jujur, tapi menjawab setengah — keberatan user
 * 2026-08-20: *"kenapa cuma batasi 15, kalau pun harus dikirim bertahap, ya
 * buat bertahap beberapa pesan"*. Orang yang bertanya "siapa yang belum lapor"
 * justru butuh daftar LENGKAPnya untuk ditindaklanjuti; menyuruhnya membuka
 * aplikasi meniadakan alasan ia bertanya lewat WhatsApp.
 *
 * Sekarang batasnya jauh lebih longgar dan pemotongan sesungguhnya terjadi di
 * `potong-pesan.ts`, yang membelah balasan panjang menjadi beberapa PESAN
 * berurutan bertanda `(bagian n/m)`. Yang benar-benar tidak terkirim tetap
 * diakui — daftar yang dipotong diam-diam akan dibaca sebagai daftar lengkap.
 */

/**
 * Maksimal baris per balasan.
 *
 * Bukan lagi batas keterbacaan (itu tugas `potongPesan`), melainkan pagar
 * terhadap organisasi yang punya ratusan lokasi: satu jawaban tidak boleh
 * menjadi ratusan baris yang harus dirakit lalu dibuang lagi. 120 baris cukup
 * untuk seluruh 83 lokasi KNMP plus ruang tumbuh.
 */
export const BATAS_BARIS = 120;

function catatanBatas(ditampilkan: number, total: number, satuan: string): string | null {
  if (total <= ditampilkan) return null;
  return `Ditampilkan ${ditampilkan} dari ${total} ${satuan}. Selengkapnya buka MARLIN.`;
}

/** Umur dalam hari penuh (24 jam) sejak dicatat — dibulatkan ke bawah. */
function umurHari(sejak: Date, sekarang: Date): number {
  return Math.max(0, Math.floor((sekarang.getTime() - sejak.getTime()) / 86_400_000));
}

/* ------------------------------------------------------------------ */
/* Katalog lokasi                                                      */
/* ------------------------------------------------------------------ */

/**
 * Lokasi yang boleh disebut penanya — sudah dipotong izin DAN lingkup grup.
 *
 * Pencocokan nama pertanyaan dilakukan terhadap katalog INI, bukan terhadap
 * seluruh basis data. Akibatnya lokasi di luar hak penanya tidak sekadar
 * "tidak dijawab": namanya tidak pernah bisa dicocokkan sama sekali, sehingga
 * keberadaannya pun tidak terkonfirmasi lewat balasan.
 */
export async function katalogLokasi(
  user: SessionUser,
  lokasiIds: string[] | null,
): Promise<LokasiKatalog[]> {
  const rows = await db.location.findMany({
    where: { ...locationScopeWhere(user, lokasiIds), isActive: true },
    // Wilayah ikut supaya penanya boleh menyebut daerah, bukan cuma nama titik
    // proyek — "apa jember kemarin laporan?" (DECISIONS 367).
    select: {
      id: true,
      name: true,
      village: true,
      district: true,
      regency: true,
      province: true,
      // Perusahaan pelaksana: vendor pada kontrak; sebelum kontrak ada, calon
      // vendor paket. Keduanya boleh kosong — lokasi yang paketnya belum
      // berkontrak memang belum punya pelaksana.
      package: {
        select: {
          candidateVendorName: true,
          contract: { select: { vendor: { select: { name: true } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    nama: r.name,
    desa: r.village,
    kecamatan: r.district,
    kabupaten: r.regency,
    provinsi: r.province,
    pelaksana: r.package?.contract?.vendor.name ?? r.package?.candidateVendorName ?? null,
  }));
}

/* ------------------------------------------------------------------ */
/* Kendala                                                             */
/* ------------------------------------------------------------------ */

export type HasilKendala = {
  baris: BarisKendala[];
  lokasiDiperiksa: number;
  catatanBatas: string | null;
};

/**
 * Kendala yang BELUM SELESAI (terbuka + sedang ditangani).
 *
 * `ditangani` sengaja ikut: pertanyaan *"ada kendala apa hari ini"* menanyakan
 * apa yang masih menekan pekerjaan, dan kendala yang sedang ditangani masih
 * menekan. Statusnya tetap ditulis per baris supaya "sudah ada yang pegang"
 * tidak hilang.
 */
/**
 * Cara kendala disaring (DECISIONS 381).
 *
 * `terbuka_sekarang` adalah perilaku lama: apa pun yang masih terbuka HARI INI,
 * tanpa peduli kapan dibukanya. Dua yang lain menjawab pertanyaan tentang
 * PERIODE, dan keduanya cukup memakai `Issue.createdAt` + status terkini —
 * tidak butuh histori status yang memang belum dicatat.
 *
 * Yang TETAP tidak bisa dijawab: "kendala apa yang berstatus terbuka PADA hari
 * X". Itu butuh riwayat status. Tidak satu pun saringan di sini berpura-pura
 * bisa menjawabnya.
 */
/**
 * Penghujung hari untuk batas periode.
 *
 * `Issue.createdAt` bertimestamp sedangkan periode datang sebagai tanggal.
 * Tanpa ini, kendala yang dibuka pukul 09:00 pada hari terakhir periode jatuh
 * DI LUAR rentang — dan yang hilang justru yang paling baru.
 */
function akhirHari(d: Date): Date {
  return new Date(d.getTime() + 24 * 3600 * 1000 - 1);
}

export type SaringKendala =
  /** Masih terbuka sekarang, kapan pun dibukanya. */
  | "terbuka_sekarang"
  /** DIBUKA dalam periode itu — apa pun statusnya sekarang. */
  | "dibuka_periode"
  /** Dibuka dalam periode itu DAN masih terbuka sekarang. */
  | "dibuka_periode_masih_terbuka";

export async function dataKendala(
  lokasi: LokasiKatalog[],
  sekarang: Date,
  saring: SaringKendala = "terbuka_sekarang",
  periode?: { mulai: Date; akhir: Date },
): Promise<HasilKendala> {
  if (lokasi.length === 0) return { baris: [], lokasiDiperiksa: 0, catatanBatas: null };
  const namaById = new Map(lokasi.map((l) => [l.id, l.nama]));
  const ids = lokasi.map((l) => l.id);

  /*
   * Saringan periode memakai `createdAt` — kapan kendalanya DIBUKA. Batas
   * akhirnya inklusif sampai penghujung hari, karena tanggal kerja disimpan
   * sebagai tanggal sedangkan `createdAt` bertimestamp.
   */
  const dalamPeriode =
    periode != null
      ? { createdAt: { gte: periode.mulai, lte: akhirHari(periode.akhir) } }
      : {};
  // `mergedIntoId: null` di KETIGA cabang, termasuk "dibuka_periode" yang
  // tidak menyaring status sama sekali — di situlah kembar yang sudah
  // digabungkan akan muncul lagi kalau dilewatkan.
  const where =
    saring === "terbuka_sekarang"
      ? { locationId: { in: ids }, mergedIntoId: null, status: { not: "selesai" as const } }
      : saring === "dibuka_periode"
        ? { locationId: { in: ids }, mergedIntoId: null, ...dalamPeriode }
        : {
            locationId: { in: ids },
            mergedIntoId: null,
            status: { not: "selesai" as const },
            ...dalamPeriode,
          };

  /*
   * Kendala tidak dipotong: daftar panjang dikirim sebagai PDF dan PDF itulah
   * jawaban lengkapnya. Memotong 20 dari 28 lalu menyuruh penanya membuka
   * MARLIN membuat lampiran tidak berguna sebagai register tindak lanjut.
   * PDFKit sudah memecah halaman secara otomatis, jadi banyaknya baris bukan
   * alasan untuk membuang data di lapisan pengambilan.
   */
  const rows = await db.issue.findMany({
    where,
    select: { locationId: true, title: true, severity: true, status: true, createdAt: true },
    // Paling berat dulu, lalu paling lama menganggur — itu urutan yang dipakai
    // orang lapangan memutuskan mana yang dikerjakan pagi ini.
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
  });

  return {
    baris: rows.map((r) => ({
      lokasi: namaById.get(r.locationId) ?? "(lokasi tidak dikenal)",
      judul: r.title,
      tingkat: r.severity,
      status: r.status,
      umurHari: umurHari(r.createdAt, sekarang),
    })),
    lokasiDiperiksa: lokasi.length,
    catatanBatas: null,
  };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export type HasilProgress = { baris: BarisProgress[]; catatanBatas: string | null };

/**
 * Realisasi / rencana / deviasi per lokasi + kegiatan pada tanggal yang diminta.
 *
 * `itemHariIni = null` berarti BELUM ADA laporan pada tanggal itu; `0` berarti
 * ada laporan tapi belum berisi item. Dua kabar yang sangat berbeda, dan
 * menyatukan keduanya jadi "0" akan membuat lokasi yang lalai terlihat sama
 * dengan lokasi yang rajin tapi belum sempat mengisi.
 *
 * ### `asOf` bukan tambahan — tanpanya jawabannya bercampur
 *
 * Fungsi ini SUDAH menerima `dateKey` dan memakainya untuk mengambil laporan
 * tanggal itu, tapi angka realisasi/rencana/deviasinya dulu diambil tanpa
 * `asOf` — yaitu posisi HARI INI. Akibatnya satu balasan berjudul "minggu lalu"
 * memuat status laporan minggu lalu di sebelah realisasi hari ini, dan tidak
 * ada apa pun di layar yang memberi tahu bahwa dua angka itu dari dua waktu
 * berbeda. Jalurnya sendiri sudah lama tersedia (DECISIONS 275); yang kurang
 * hanya meneruskannya.
 */
export async function dataProgress(
  lokasi: LokasiKatalog[],
  dateKey: string,
  /**
   * Urutan yang diminta penanya (DECISIONS 390). null = urutan katalog.
   *
   * Saat diminta, angka SELURUH lokasi dihitung dulu baru diurut baru dipotong.
   * Kebalikannya – memotong dulu lalu mengurut – akan mengurutkan 120 lokasi
   * pertama menurut abjad dan menyebutnya "terbaik", yang persis jenis jawaban
   * yang salah tapi terlihat benar.
   */
  urutan: UrutanJawaban | null = null,
  /**
   * Banyak baris yang diminta ("5 terbaik", DECISIONS 449). null = batas
   * bawaan. TIDAK pernah melebihi `BATAS_BARIS`: pagar panjang pesan tetap
   * milik sistem, bukan milik penanya.
   */
  batas: number | null = null,
): Promise<HasilProgress> {
  if (lokasi.length === 0) return { baris: [], catatanBatas: null };
  const dipakai = urutan ? lokasi : lokasi.slice(0, BATAS_BARIS);
  const ids = dipakai.map((l) => l.id);
  const reportDate = parseDateKey(dateKey);

  const [progress, rentang, laporan] = await Promise.all([
    /*
     * `reportDate` null (dateKey tak terbaca) → tanpa `asOf` = posisi terkini.
     * Itu perilaku lama, dan dipertahankan HANYA untuk keadaan yang memang
     * tidak punya tanggal — bukan sebagai jalan pintas diam-diam.
     */
    getLocationsProgress(ids, reportDate ? { asOf: reportDate } : {}),
    /*
     * Tambahan HARI ITU saja (DECISIONS 458). Tanpa ini balasan "progres
     * kemarin" hanya memuat angka kumulatif, yang persis sama dengan angka di
     * balasan "laporan mingguan" — dan user tidak bisa membedakan keduanya.
     * Rentangnya satu hari: sejak = sampai = tanggal yang ditanyakan.
     */
    reportDate
      ? getLocationsProgressRentang(ids, reportDate, reportDate)
      : Promise.resolve(null),
    reportDate
      ? db.dailyReport.findMany({
          where: { locationId: { in: ids }, reportDate },
          select: { locationId: true, status: true, _count: { select: { items: true } } },
        })
      : Promise.resolve([]),
  ]);
  const laporanById = new Map(laporan.map((r) => [r.locationId, r]));

  const baris = dipakai.map((l) => {
    const p = progress.get(l.id);
    const r = laporanById.get(l.id);
    return {
      lokasi: l.nama,
      // Angka BULAT-BULAT dari calc layer — tidak dihitung ulang di sini.
      realisasiPct: p?.realizedPct ?? 0,
      rencanaPct: p?.planPct ?? 0,
      deviasiPct: p?.deviationPct ?? 0,
      // null = tanggalnya tak terbaca, jadi "tambahan" tidak punya arti. Nol
      // BUKAN penggantinya: nol menyatakan hari itu memang tidak bergerak.
      tambahanPct: rentang ? (rentang.get(l.id)?.tambahanPct ?? 0) : null,
      itemHariIni: r ? r._count.items : null,
      statusHariIni: r ? REPORT_STATUS_LABEL[r.status] : null,
    };
  });

  if (!urutan) {
    return { baris, catatanBatas: catatanBatas(baris.length, lokasi.length, "lokasi") };
  }

  const urut = urutkanProgress(baris, urutan);
  const potong = urut.slice(0, Math.min(batas ?? BATAS_BARIS, BATAS_BARIS));
  return {
    baris: potong,
    catatanBatas: catatanBatas(potong.length, urut.length, "lokasi"),
  };
}

/* ------------------------------------------------------------------ */
/* Deviasi                                                             */
/* ------------------------------------------------------------------ */

export type HasilDeviasi = {
  negatif: BarisDeviasi[];
  diperiksa: number;
  catatanBatas: string | null;
};

/**
 * Lokasi yang tertinggal dari kurva-S pada tanggal yang diminta, paling parah
 * di atas.
 *
 * Ambangnya nol pas: deviasi 0 bukan keterlambatan. Lokasi yang SPMK-nya belum
 * tiba berada di minggu 0 dengan rencana 0% (DECISIONS 202), jadi ia tidak
 * pernah muncul di sini — memang belum boleh mulai, bukan terlambat.
 *
 * ### Deviasi lampau BISA dihitung, dan dulu diakui tidak bisa
 *
 * Balasan lama membawa catatan *"Deviasi ini posisi HARI INI; saya belum bisa
 * menghitung deviasi pada [periode]"*. Pengakuannya jujur — tapi premisnya
 * salah: `getLocationsProgress` sudah menerima `asOf` sejak DECISIONS 275, dan
 * `asOf` memang mengatur dua hal yang persis dibutuhkan di sini — laporan mana
 * yang ikut dihitung (`report_date <= asOf`) dan minggu ke berapa tanggal itu
 * jatuh. Yang kurang cuma meneruskan tanggalnya.
 */
export async function dataDeviasi(
  lokasi: LokasiKatalog[],
  dateKey: string,
): Promise<HasilDeviasi> {
  if (lokasi.length === 0) return { negatif: [], diperiksa: 0, catatanBatas: null };
  const namaById = new Map(lokasi.map((l) => [l.id, l.nama]));
  const asOf = parseDateKey(dateKey);
  const progress = await getLocationsProgress(
    lokasi.map((l) => l.id),
    asOf ? { asOf } : {},
  );

  const semua: BarisDeviasi[] = [...progress.values()]
    .filter((p) => p.deviationPct < 0)
    .sort((a, b) => a.deviationPct - b.deviationPct)
    .map((p) => ({
      lokasi: namaById.get(p.locationId) ?? "(lokasi tidak dikenal)",
      deviasiPct: p.deviationPct,
      realisasiPct: p.realizedPct,
      rencanaPct: p.planPct,
    }));

  return {
    negatif: semua.slice(0, BATAS_BARIS),
    diperiksa: lokasi.length,
    catatanBatas: catatanBatas(Math.min(semua.length, BATAS_BARIS), semua.length, "lokasi tertinggal"),
  };
}

/* ------------------------------------------------------------------ */
/* Kelengkapan laporan                                                 */
/* ------------------------------------------------------------------ */

export type HasilKelengkapan = {
  /** HANYA lokasi yang perlu ditindak — yang beres cukup lewat `total`. */
  perlu: BarisKelengkapan[];
  /** Seluruh lokasi yang diperiksa (penyebut). */
  total: number;
  catatanBatas: string | null;
};

/**
 * Siapa sudah / belum melapor pada tanggal itu.
 *
 * Memakai papan yang sudah ada (`getStatusHarian`, DECISIONS 262) supaya
 * jawaban WhatsApp dan halaman `/laporan/status-harian` tidak pernah berbeda.
 *
 * Yang TIDAK dilakukan: menyimpulkan apa pun dari ketiadaan. "Belum ada laporan"
 * ditulis apa adanya — hari libur, lokasi yang belum SPMK, dan kelalaian
 * menghasilkan keadaan yang sama, dan hanya dua yang terakhir perlu ditindak.
 */
export async function dataKelengkapan(
  user: SessionUser,
  lokasiIds: string[],
  dateKey: string,
): Promise<HasilKelengkapan> {
  if (lokasiIds.length === 0) return { perlu: [], total: 0, catatanBatas: null };
  const papan = await getStatusHarian(user, lokasiIds, dateKey);
  if (!papan) return { perlu: [], total: 0, catatanBatas: null };

  const perlu: BarisKelengkapan[] = papan.rows
    .filter((r) => r.status === null || r.status === "draft" || r.status === "perlu_koreksi")
    .map((r) => ({
      lokasi: r.locationName,
      status: r.status ? REPORT_STATUS_LABEL[r.status] : "Belum ada laporan",
      perluTindakan: true,
    }));

  return {
    perlu: perlu.slice(0, BATAS_BARIS),
    // Penyebut = SELURUH lokasi yang diperiksa, bukan yang dirinci.
    total: papan.rows.length,
    catatanBatas: catatanBatas(
      Math.min(perlu.length, BATAS_BARIS),
      perlu.length,
      "lokasi belum beres",
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Isi laporan harian satu tanggal                                     */
/* ------------------------------------------------------------------ */

export type BarisLaporan = {
  lokasi: string;
  /** null = tidak ada laporan sama sekali untuk tanggal itu. */
  status: string | null;
  itemCount: number;
  /** Beberapa nama pekerjaan teratas — bukti bahwa laporannya berisi. */
  contohItem: string[];
  pekerjaCount: number;
  fotoCount: number;
  cuaca: string | null;
  jamKerja: string | null;
};

export type HasilLaporan = { baris: BarisLaporan[]; catatanBatas: string | null };

/**
 * ISI laporan harian satu tanggal (DECISIONS 356).
 *
 * Menjawab permintaan yang paling sering diucapkan di lapangan — *"minta
 * laporan harian"*, *"laporan tanggal 12"* — dan itu pertanyaan yang berbeda
 * dari `kelengkapan`: yang ini menanyakan APA ISINYA, bukan siapa yang belum
 * mengisi.
 *
 * Lokasi TANPA laporan tetap dikembalikan dengan `status: null`. Menghilangkan
 * barisnya akan membuat "belum ada laporan" tak bisa dibedakan dari "lokasinya
 * tidak termasuk yang saya tanyakan" — dua kabar yang menuntut tindakan
 * berbeda.
 */
export async function dataLaporan(
  lokasi: LokasiKatalog[],
  dateKey: string,
): Promise<HasilLaporan> {
  if (lokasi.length === 0) return { baris: [], catatanBatas: null };
  const dipakai = lokasi.slice(0, BATAS_BARIS);
  const ids = dipakai.map((l) => l.id);
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return { baris: [], catatanBatas: null };

  const rows = await db.dailyReport.findMany({
    where: { locationId: { in: ids }, reportDate },
    select: {
      locationId: true,
      status: true,
      weather: true,
      workStart: true,
      workEnd: true,
      _count: { select: { items: true, photos: true, workers: true } },
      items: { select: { rabNode: { select: { name: true } } }, take: 5 },
    },
  });
  const byId = new Map(rows.map((r) => [r.locationId, r]));

  return {
    baris: dipakai.map((l) => {
      const r = byId.get(l.id);
      return {
        lokasi: l.nama,
        status: r ? REPORT_STATUS_LABEL[r.status] : null,
        itemCount: r?._count.items ?? 0,
        contohItem: r?.items.map((i) => i.rabNode.name).filter(Boolean) ?? [],
        pekerjaCount: r?._count.workers ?? 0,
        fotoCount: r?._count.photos ?? 0,
        cuaca: r?.weather ?? null,
        // Jam mulai tanpa jam selesai BUKAN jam kerja — jangan ditampilkan
        // separuh seolah lengkap.
        jamKerja: r?.workStart && r.workEnd ? `${r.workStart}–${r.workEnd}` : null,
      };
    }),
    catatanBatas: catatanBatas(dipakai.length, lokasi.length, "lokasi"),
  };
}

/* ------------------------------------------------------------------ */
/* Laporan MINGGUAN                                                    */
/* ------------------------------------------------------------------ */

export type BarisMingguan = {
  lokasi: string;
  /** null = lokasi belum punya kurva-S; rencana yang tidak ada bukan nol. */
  rencanaPct: number | null;
  realisasiPct: number;
  deviasiPct: number | null;
  /** Tambahan realisasi SEPANJANG pekan itu, poin persen (DECISIONS 458). */
  tambahanPct: number;
  /** Berapa hari dalam pekan itu yang punya laporan. */
  hariBerlaporan: number;
  /** Penyebutnya: hari dalam pekan yang sudah lewat. */
  totalHari: number;
};

export type HasilMingguan = { baris: BarisMingguan[]; catatanBatas: string | null };

/**
 * Rekap MINGGUAN per lokasi (DECISIONS 358).
 *
 * Pertanyaan yang berbeda dari `laporan` harian: yang ini menanyakan posisi
 * pekerjaan pada akhir sebuah pekan, bukan isi laporan satu hari.
 *
 * Angkanya dihitung `asOf` hari TERAKHIR pekan itu — bukan hari ini. Tanpa itu,
 * "laporan mingguan minggu lalu" akan berjudul pekan lalu tapi berisi realisasi
 * hari ini: jawaban benar untuk pekan yang salah, lewat saluran yang
 * di-screenshot dan diteruskan (alasan yang sama dengan DECISIONS 357).
 */
export async function dataMingguan(
  lokasi: LokasiKatalog[],
  mulai: string,
  akhir: string,
): Promise<HasilMingguan> {
  if (lokasi.length === 0) return { baris: [], catatanBatas: null };
  const dipakai = lokasi.slice(0, BATAS_BARIS);
  const ids = dipakai.map((l) => l.id);
  const dMulai = parseDateKey(mulai);
  const dAkhir = parseDateKey(akhir);
  if (!dMulai || !dAkhir) return { baris: [], catatanBatas: null };

  const [progress, rentang, laporan] = await Promise.all([
    getLocationsProgress(ids, { asOf: dAkhir }),
    // Tambahan SEPANJANG PEKAN ITU (DECISIONS 458) — pasangan dari angka
    // kumulatif di sebelahnya. Tanpa ini rekap mingguan menampilkan angka yang
    // sama persis dengan balasan progres harian, dan tidak ada cara membedakan
    // "sudah sampai mana" dari "pekan ini ngapain".
    getLocationsProgressRentang(ids, dMulai, dAkhir),
    db.dailyReport.groupBy({
      by: ["locationId"],
      where: { locationId: { in: ids }, reportDate: { gte: dMulai, lte: dAkhir } },
      _count: { _all: true },
    }),
  ]);
  const jumlahById = new Map(laporan.map((r) => [r.locationId, r._count._all]));
  const totalHari =
    Math.floor((dAkhir.getTime() - dMulai.getTime()) / 86_400_000) + 1;

  return {
    baris: dipakai.map((l) => {
      const p = progress.get(l.id);
      // `totalWeeks === 0` = belum ada baseline sama sekali. Rencana yang tidak
      // ada BUKAN nol: nol menyatakan rencananya memang nol pekan itu.
      const adaKurva = (p?.totalWeeks ?? 0) > 0;
      return {
        lokasi: l.nama,
        rencanaPct: adaKurva ? (p?.planPct ?? 0) : null,
        realisasiPct: p?.realizedPct ?? 0,
        deviasiPct: adaKurva ? (p?.deviationPct ?? 0) : null,
        tambahanPct: rentang.get(l.id)?.tambahanPct ?? 0,
        hariBerlaporan: jumlahById.get(l.id) ?? 0,
        totalHari,
      };
    }),
    catatanBatas: catatanBatas(dipakai.length, lokasi.length, "lokasi"),
  };
}

/* ------------------------------------------------------------------ */
/* RENCANA kerja (satu-satunya yang menghadap KE DEPAN)                */
/* ------------------------------------------------------------------ */

export type ItemRencanaWa = {
  nama: string;
  satuan: string | null;
  target: number;
  /** Sisa volume kontrak yang belum terealisasi. */
  sisa: number;
  pic: string | null;
};

export type BarisRencanaWa = {
  lokasi: string;
  /** null = lokasi belum punya kontrak/baseline, jadi pekannya belum bernomor. */
  minggu: number | null;
  totalMinggu: number | null;
  periode: string | null;
  /** Tuntutan kurva-S di akhir pekan itu. */
  targetPct: number | null;
  realisasiPct: number | null;
  deviasiPct: number | null;
  /** Kosong = rencana pekan itu BELUM disusun siapa pun. */
  item: ItemRencanaWa[];
  itemTersembunyi: number;
  /** Bobot seluruh komitmen pekan itu terhadap nilai RAB lokasi (poin persen). */
  bobotTarget: number | null;
  /**
   * Terisi bila pekan yang DIMINTA tidak bisa dijawab apa adanya — mis. pekan
   * depan sudah di luar masa kontrak. Balasan WAJIB menyebutkannya
   * (perbaikan review 2026-08-28).
   */
  catatan: string | null;
  /** Komitmen pekan LALU yang tidak tuntas — bahan pertama untuk mengejar. */
  tidakTuntas: { nama: string; satuan: string | null; target: number; realisasi: number }[];
};

export type HasilRencana = { baris: BarisRencanaWa[]; catatanBatas: string | null };

/** Item yang dirinci per lokasi — sisanya disebut jumlahnya, tidak dibuang diam-diam. */
const BATAS_ITEM_RENCANA = 8;
/**
 * Lokasi yang dirinci sekali jawab.
 *
 * Jauh lebih ketat daripada `BATAS_BARIS` dan memang harus: tiap lokasi di sini
 * berarti satu penyusunan rencana mingguan penuh (RAB aktif + kumulatif per
 * lineage + kurva-S). Menjawab "rencana minggu depan" untuk 83 lokasi sekaligus
 * berarti puluhan ribu baris dibaca untuk satu pesan WhatsApp.
 */
const BATAS_LOKASI_RENCANA = 5;

/**
 * RENCANA KERJA satu pekan per lokasi (DECISIONS 458).
 *
 * ### Kenapa niat ini ada
 *
 * Tangkapan layar user 2026-08-28 memuat tiga pertanyaan yang semuanya
 * menghadap ke depan — *"rencana seminggu ke depan untuk kemantren?"*,
 * *"apa yang perlu dilakukan minggu depan?"*, *"pekerjaan apa yang perlu
 * dilakukan untuk mengejar progress?"* — dan tidak satu pun terjawab. Yang
 * lewat WhatsApp malah dibalas KUTIPAN notulen rapat 10 Agustus, disodorkan di
 * bawah judul yang membuatnya terbaca sebagai rencana.
 *
 * Datanya sebenarnya sudah ada dan sudah dipakai di tempat lain: `WeeklyPlan`
 * beserta itemnya, yang dirakit `getRencanaMingguan` untuk formulir rencana
 * mingguan, PDF, Excel, dan siaran WhatsApp. Yang tidak ada cuma sambungannya
 * ke tanya-jawab.
 *
 * ### Tidak menghitung apa pun
 *
 * Sama seperti seluruh berkas ini: angka datang bulat-bulat dari
 * `getRencanaMingguan`, yang sendirinya bersandar pada calculation layer.
 */
export async function dataRencana(
  lokasi: LokasiKatalog[],
  pekanDepan: boolean,
): Promise<HasilRencana> {
  if (lokasi.length === 0) return { baris: [], catatanBatas: null };
  const dipakai = lokasi.slice(0, BATAS_LOKASI_RENCANA);
  const { getRencanaMingguan } = await import("@/lib/plan/rencana-mingguan");

  const baris: BarisRencanaWa[] = [];
  for (const l of dipakai) {
    // Pekan berjalan dulu — dari situlah nomor pekan berikutnya diketahui.
    // `getRencanaMingguan` tidak menerima "pekan depan", ia menerima NOMOR.
    const kini = await getRencanaMingguan(l.id);
    if (!kini) {
      baris.push({
        lokasi: l.nama,
        minggu: null,
        totalMinggu: null,
        periode: null,
        targetPct: null,
        realisasiPct: null,
        deviasiPct: null,
        item: [],
        itemTersembunyi: 0,
        bobotTarget: null,
        catatan: null,
        tidakTuntas: [],
      });
      continue;
    }
    /*
     * Pekan depan bisa saja TIDAK ADA — di minggu terakhir kontrak,
     * `getRencanaMingguan(n + 1)` mengembalikan null karena nomornya melewati
     * `totalWeeks`.
     *
     * Versi pertama diam-diam jatuh kembali ke pekan berjalan, sementara
     * kepala balasannya tetap berbunyi "pekan depan": jawaban yang benar untuk
     * pekan yang salah, persis jenis kesalahan yang paling sulit dibantah
     * karena angkanya sendiri tidak keliru. Sekarang kejatuhannya DIKATAKAN.
     */
    let catatan: string | null = null;
    let r = kini;
    if (pekanDepan) {
      const depan = await getRencanaMingguan(l.id, kini.currentWeek + 1);
      if (depan) {
        r = depan;
      } else {
        catatan =
          `Minggu ${kini.currentWeek + 1} di luar masa kontrak (kontrak berakhir di minggu ` +
          `${kini.totalWeeks}) – yang saya tampilkan pekan berjalan.`;
      }
    }
    const semua = r.baris;
    baris.push({
      lokasi: l.nama,
      minggu: r.weekNumber,
      totalMinggu: r.totalWeeks,
      periode: `${formatTanggal(r.header.periodeStart, "d MMM yyyy")} – ${formatTanggal(r.header.periodeEnd, "d MMM yyyy")}`,
      targetPct: r.targetPct,
      realisasiPct: r.actualPct,
      deviasiPct: r.deviationPct,
      item: semua.slice(0, BATAS_ITEM_RENCANA).map((b) => ({
        nama: b.name,
        satuan: b.unit,
        target: b.target,
        sisa: b.sisa,
        pic: b.picName,
      })),
      itemTersembunyi: Math.max(0, semua.length - BATAS_ITEM_RENCANA),
      bobotTarget: r.totalBobot,
      catatan,
      tidakTuntas: r.tidakTuntas.map((t) => ({
        nama: t.name,
        satuan: t.unit,
        target: t.target,
        realisasi: t.realisasi,
      })),
    });
  }

  return {
    baris,
    catatanBatas: catatanBatas(dipakai.length, lokasi.length, "lokasi"),
  };
}
