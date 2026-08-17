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
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, nama: r.name }));
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
