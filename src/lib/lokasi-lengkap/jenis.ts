import type { SourceRef } from "@/lib/ai-hub/types";
import type { KondisiTerkini, Peristiwa } from "@/lib/kronologi/susun";
import type { EwsWarning } from "@/lib/ews/rules";

/**
 * LAPORAN LENGKAP LOKASI — tipe MURNI (tanpa "server-only").
 *
 * Permintaan user 2026-09-19: *"kalau aku minta kronologi atau kesimpulan atas
 * satu lokasi, kamu akan tarik semua data dari database atas lokasi itu, lalu
 * buatkan laporan lengkap bahkan dalam bentuk deck jika dibutuhkan, termasuk
 * perkembangan progress dan lain-lain."*
 *
 * Satu snapshot = SATU lokasi, KUMULATIF sejak SPMK sampai `asOfKey`. Seluruh
 * angkanya dihitung calculation layer kanonik (`lib/progress`, `lib/baseline`,
 * `lib/progress-calc`, `lib/kronologi/susun`, `lib/ews/rules`) – snapshot,
 * renderer, layar, dan balasan WhatsApp TIDAK menghitung ulang apa pun.
 * Kesimpulannya DETERMINISTIK (templat), bukan keluaran model.
 *
 * Berkas ini dibagi tiga pemakai yang bekerja paralel: pengambil data
 * (`snapshot.ts`), renderer (A4 `render-pdf.ts`, deck `render-deck.ts`, layar),
 * dan jalur WhatsApp (`lib/waha`). Mengubah bentuknya = mengubah ketiganya.
 */

export const LAPORAN_LOKASI_VERSION = 1;

export type IdentitasLaporanLokasi = {
  locationId: string;
  slug: string;
  nama: string;
  desa: string;
  kecamatan: string | null;
  kabupaten: string;
  provinsi: string;
  gps: { lat: number; lng: number } | null;
  /** Enum `LocationStatus` sebagai string + labelnya dari lifecycle.ts. */
  status: string;
  statusLabel: string;
  paket: { id: string; nama: string; nomor: string | null; instansi: string };
  /** null = paket belum berkontrak; laporan tetap disusun dengan limitation. */
  kontrak: {
    nomor: string;
    judulKerja: string | null;
    vendor: string;
    /** BigInt rupiah sebagai string. */
    nilai: string;
    mulaiKey: string;
    akhirKey: string | null;
    durasiHari: number;
    weekMode: "tujuh_hari" | "senin_minggu";
    ppk: string | null;
    pengawas: string | null;
    pengawasFirma: string | null;
  } | null;
  pelaksana: { nama: string; jabatan: string | null } | null;
};

export type ProgresLaporanLokasi = {
  /** null = belum punya kurva-S (bukan target 0%). */
  rencanaPct: number | null;
  realisasiPct: number;
  deviasiPp: number | null;
  /** Realisasi TERVERIFIKASI (disetujui+final) – angka pendamping, DECISIONS 426. */
  terverifikasiPct: number;
  /** BigInt rupiah sebagai string. */
  nilaiRab: string;
  nilaiTerpasang: string;
  mingguKe: number;
  totalMinggu: number;
  punyaRab: boolean;
  punyaKurva: boolean;
};

export type MingguLaporanLokasi = {
  minggu: number;
  mulaiKey: string;
  akhirKey: string;
  rencanaPct: number | null;
  /** Realisasi kumulatif pada akhir minggu; null bila minggu belum tiba. */
  realisasiPct: number | null;
  kenaikanPp: number | null;
  deviasiPp: number | null;
  /** Laporan harian terhitung (dikirim+disetujui+final) dalam minggu itu. */
  laporanTerhitung: number;
};

export type KurvaLaporanLokasi = {
  totalMinggu: number;
  mingguBerjalan: number;
  /** Rencana kumulatif % per minggu (index 0 = minggu 1). */
  planPct: number[];
  /** Realisasi kumulatif % per minggu; null untuk minggu yang belum tiba. */
  actualPct: (number | null)[];
};

export type DurasiLaporanLokasi = {
  totalHari: number;
  hariBerjalan: number;
  sisaHari: number;
  /** % waktu kontrak yang telah berjalan (0..100). */
  pctWaktu: number;
};

export type KategoriLaporanLokasi = {
  lineageKey: string;
  nama: string;
  /** Bobot terhadap total RAB lokasi (%). */
  bobotPct: number;
  realisasiPct: number;
  /** BigInt rupiah sebagai string. */
  nilai: string;
};

export type KelengkapanLaporanLokasi = {
  /** Hari kerja yang seharusnya berlaporan sejak SPMK s.d. asOf (dalam masa kontrak). */
  hariDiharapkan: number;
  final: number;
  disetujui: number;
  dikirim: number;
  draft: number;
  perluKoreksi: number;
  hariNihil: number;
  hariTanpaLaporan: number;
  laporanTerakhirKey: string | null;
  hariSejakLaporanTerakhir: number | null;
};

export type KendalaLaporanLokasi = {
  id: string;
  judul: string;
  tingkat: "rendah" | "sedang" | "tinggi" | "kritis";
  status: "terbuka" | "ditangani" | "selesai";
  dibukaKey: string;
  ditutupKey: string | null;
  pic: string | null;
  tenggatKey: string | null;
  lewatTenggat: boolean;
  /** Umur sejak dibuka sampai asOf (terbuka) atau sampai ditutup (selesai). */
  umurHari: number;
  sumber: string;
};

export type RingkasKendalaLaporanLokasi = {
  terbuka: number;
  kritis: number;
  lewatTenggat: number;
  selesai: number;
  tertuaHari: number | null;
};

/** Kronologi dikelompokkan per BULAN (Asia/Jakarta), terbaru dulu. */
export type BabakKronologiLokasi = {
  /** "YYYY-MM". */
  bulanKey: string;
  /** "September 2026". */
  label: string;
  peristiwa: Peristiwa[];
};

export type KegiatanLaporanLokasi = {
  id: string;
  tanggalKey: string;
  jenis: string;
  judul: string;
  status: "draft" | "final";
  jumlahFoto: number;
};

export type TemuanLaporanLokasi = {
  id: string;
  judul: string;
  kategori: string;
  tingkat: "rendah" | "sedang" | "tinggi" | "kritis";
  status: string;
  statusLabel: string;
  tanggalKey: string;
  tenggatKey: string | null;
  lewatTenggat: boolean;
  penanggungJawab: string | null;
};

export type RingkasTemuanLaporanLokasi = {
  total: number;
  terbuka: number;
  kritis: number;
  lewatTenggat: number;
  selesai: number;
  inspeksi: number;
  inspeksiTerakhirKey: string | null;
};

export type MilestoneLaporanLokasi = {
  fase: string;
  label: string;
  total: number;
  selesai: number;
  terlambat: number;
};

export type DokumenLaporanLokasi = {
  total: number;
  kedaluwarsa: number;
  segeraKedaluwarsa: number;
  perFase: { fase: string; label: string; jumlah: number }[];
};

export type SuratLaporanLokasi = {
  masuk: number;
  keluar: number;
  perluBalas: number;
  lewatTenggatBalas: number;
  terakhir: { id: string; arah: "masuk" | "keluar"; tanggalKey: string; perihal: string }[];
};

export type FotoLaporanLokasi = {
  id: string;
  tanggalKey: string | null;
  /** Keterangan faktual dari sumber (nama pekerjaan / judul kegiatan). */
  keterangan: string | null;
  lineageKey: string | null;
  r2Key: string;
  thumbnailKey: string | null;
};

export type RencanaLaporanLokasi = {
  mingguKe: number;
  catatan: string | null;
  item: { nama: string; unit: string | null; targetVolume: number }[];
};

export type LaporanLokasiLengkap = {
  version: 1;
  /** Tanggal perhitungan (YYYY-MM-DD, Asia/Jakarta). */
  asOfKey: string;
  /** Waktu snapshot dibuat (ISO) – bukan waktu render. */
  dibuatPada: string;
  identitas: IdentitasLaporanLokasi;
  /**
   * KESIMPULAN 2–3 kalimat, DETERMINISTIK dari templat (`kesimpulan.ts`):
   * nama lokasi, posisi progres, apa yang menahannya, akibatnya. Bentuk utama
   * jawaban WhatsApp dan pembuka laporan.
   */
  kesimpulan: string[];
  progres: ProgresLaporanLokasi;
  /** Perkembangan per minggu kontrak, minggu 1 s.d. minggu berjalan. */
  mingguan: MingguLaporanLokasi[];
  kurva: KurvaLaporanLokasi | null;
  durasi: DurasiLaporanLokasi | null;
  kategori: KategoriLaporanLokasi[];
  kelengkapan: KelengkapanLaporanLokasi | null;
  kendala: {
    ringkas: RingkasKendalaLaporanLokasi;
    /** Seluruh yang masih terbuka, terlama dulu. */
    terbuka: KendalaLaporanLokasi[];
    /** Yang selesai, terbaru dulu, maks 10. */
    selesaiTerbaru: KendalaLaporanLokasi[];
  };
  kronologi: {
    sejakKey: string;
    babak: BabakKronologiLokasi[];
    kondisi: KondisiTerkini;
    totalPeristiwa: number;
    dipotong: number;
  };
  kegiatan: { total: number; terakhir: KegiatanLaporanLokasi[] };
  temuan: { ringkas: RingkasTemuanLaporanLokasi; terbuka: TemuanLaporanLokasi[] };
  administrasi: {
    milestone: MilestoneLaporanLokasi[];
    dokumen: DokumenLaporanLokasi;
    surat: SuratLaporanLokasi;
  };
  foto: { total: number; kandidat: FotoLaporanLokasi[] };
  rencanaMingguDepan: RencanaLaporanLokasi | null;
  /** Peringatan EWS lokasi ini – dari `evaluasiEwsLokasi` (rule kanonik). */
  perhatian: EwsWarning[];
  limitations: string[];
  sumber: SourceRef[];
};

/** Nama berkas unduhan – memuat slug & tanggal supaya tidak saling menimpa. */
export function namaBerkasLaporanLokasi(l: LaporanLokasiLengkap, bentuk: "laporan" | "deck"): string {
  return `${bentuk === "deck" ? "deck" : "laporan-lengkap"}-${l.identitas.slug}-${l.asOfKey}.pdf`;
}
