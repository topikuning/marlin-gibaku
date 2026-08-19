import "server-only";
import { db } from "@/lib/db";
import { locationScopeWhere } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { getLocationsProgress } from "@/lib/progress";
import { getStatusHarian } from "@/lib/daily-report/status-harian";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { parseDateKey } from "@/lib/format";
import type { LokasiKatalog } from "./tanya-niat";
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
 * ### Batas baris bukan hiasan
 *
 * Balasan WhatsApp yang panjang tidak terbaca di lapangan — ia dilipat, di-"baca
 * selengkapnya", lalu dilewati. Karena itu tiap jawaban dipotong ke
 * `BATAS_BARIS`. Pemotongan itu SELALU dilaporkan; daftar yang dipotong diam-diam
 * akan dibaca sebagai daftar lengkap.
 */

/** Maksimal baris per balasan. Sisanya disebut jumlahnya, tidak dibuang diam-diam. */
export const BATAS_BARIS = 15;

/** Maksimal kendala yang dirinci — grup lapangan bisa punya puluhan sekaligus. */
export const BATAS_KENDALA = 20;

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
export async function dataKendala(
  lokasi: LokasiKatalog[],
  sekarang: Date,
): Promise<HasilKendala> {
  if (lokasi.length === 0) return { baris: [], lokasiDiperiksa: 0, catatanBatas: null };
  const namaById = new Map(lokasi.map((l) => [l.id, l.nama]));
  const ids = lokasi.map((l) => l.id);

  const [total, rows] = await Promise.all([
    db.issue.count({ where: { locationId: { in: ids }, status: { not: "selesai" } } }),
    db.issue.findMany({
      where: { locationId: { in: ids }, status: { not: "selesai" } },
      select: { locationId: true, title: true, severity: true, status: true, createdAt: true },
      // Paling berat dulu, lalu paling lama menganggur — itu urutan yang dipakai
      // orang lapangan memutuskan mana yang dikerjakan pagi ini.
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      take: BATAS_KENDALA,
    }),
  ]);

  return {
    baris: rows.map((r) => ({
      lokasi: namaById.get(r.locationId) ?? "(lokasi tidak dikenal)",
      judul: r.title,
      tingkat: r.severity,
      status: r.status,
      umurHari: umurHari(r.createdAt, sekarang),
    })),
    lokasiDiperiksa: lokasi.length,
    catatanBatas: catatanBatas(rows.length, total, "kendala"),
  };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export type HasilProgress = { baris: BarisProgress[]; catatanBatas: string | null };

/**
 * Realisasi / rencana / deviasi per lokasi + kegiatan hari ini.
 *
 * `itemHariIni = null` berarti BELUM ADA laporan hari ini; `0` berarti ada
 * laporan tapi belum berisi item. Dua kabar yang sangat berbeda, dan menyatukan
 * keduanya jadi "0" akan membuat lokasi yang lalai terlihat sama dengan lokasi
 * yang rajin tapi belum sempat mengisi.
 */
export async function dataProgress(
  lokasi: LokasiKatalog[],
  dateKey: string,
): Promise<HasilProgress> {
  if (lokasi.length === 0) return { baris: [], catatanBatas: null };
  const dipakai = lokasi.slice(0, BATAS_BARIS);
  const ids = dipakai.map((l) => l.id);
  const reportDate = parseDateKey(dateKey);

  const [progress, laporan] = await Promise.all([
    getLocationsProgress(ids),
    reportDate
      ? db.dailyReport.findMany({
          where: { locationId: { in: ids }, reportDate },
          select: { locationId: true, status: true, _count: { select: { items: true } } },
        })
      : Promise.resolve([]),
  ]);
  const laporanById = new Map(laporan.map((r) => [r.locationId, r]));

  return {
    baris: dipakai.map((l) => {
      const p = progress.get(l.id);
      const r = laporanById.get(l.id);
      return {
        lokasi: l.nama,
        // Angka BULAT-BULAT dari calc layer — tidak dihitung ulang di sini.
        realisasiPct: p?.realizedPct ?? 0,
        rencanaPct: p?.planPct ?? 0,
        deviasiPct: p?.deviationPct ?? 0,
        itemHariIni: r ? r._count.items : null,
        statusHariIni: r ? REPORT_STATUS_LABEL[r.status] : null,
      };
    }),
    catatanBatas: catatanBatas(dipakai.length, lokasi.length, "lokasi"),
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
 * Lokasi yang tertinggal dari kurva-S, paling parah di atas.
 *
 * Ambangnya nol pas: deviasi 0 bukan keterlambatan. Lokasi yang SPMK-nya belum
 * tiba berada di minggu 0 dengan rencana 0% (DECISIONS 202), jadi ia tidak
 * pernah muncul di sini — memang belum boleh mulai, bukan terlambat.
 */
export async function dataDeviasi(lokasi: LokasiKatalog[]): Promise<HasilDeviasi> {
  if (lokasi.length === 0) return { negatif: [], diperiksa: 0, catatanBatas: null };
  const namaById = new Map(lokasi.map((l) => [l.id, l.nama]));
  const progress = await getLocationsProgress(lokasi.map((l) => l.id));

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

  const [progress, laporan] = await Promise.all([
    getLocationsProgress(ids, { asOf: dAkhir }),
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
        hariBerlaporan: jumlahById.get(l.id) ?? 0,
        totalHari,
      };
    }),
    catatanBatas: catatanBatas(dipakai.length, lokasi.length, "lokasi"),
  };
}
