import { z } from "zod";
import type { SourceRef } from "@/lib/ai-hub/types";

/**
 * PAPARAN MINGGUAN KONTRAK KKP (DECISIONS 416) — tipe & skema MURNI.
 *
 * Satu paparan = SATU paket/kontrak + SATU minggu kontrak + satu versi.
 * Deck PDF lanskap 16:9 untuk dipaparkan ke KKP; seluruh angkanya dihitung
 * kode MARLIN (snapshot di bawah), AI hanya menyumbang narasi yang sudah
 * disaring grounding. Tanpa data keuangan internal pelaksana — deck ini
 * dibaca pemberi kerja.
 *
 * File ini sengaja tanpa "server-only": dipakai builder server, komponen
 * preview, renderer PDF, dan unit test.
 */

export const PAPARAN_TEMPLATE_KEY = "paparan_mingguan_kkp";
/**
 * v2 (2026-08-22): rombak desain mengikuti contoh paparan Mataram dari user –
 * sampul gelap ber-meta-strip, kurva-S, durasi pelaksanaan, status pekerjaan
 * per kategori, foto per pekerjaan, Action Plan yang digenerate, penutup.
 * Artefak v1 tetap terbaca: kolom snapshot barunya opsional.
 */
export const PAPARAN_TEMPLATE_VERSION = 2;

/* ── Snapshot deterministik ─────────────────────────────────────────────── */

export type ProgresLokasiPaparan = {
  locationId: string;
  slug: string;
  name: string;
  regency: string;
  province: string;
  /** null = lokasi belum punya kurva-S (bukan target 0%). */
  targetPct: number | null;
  realisasiPct: number;
  deviasiPp: number | null;
  /** Realisasi pada akhir minggu SEBELUMNYA; null utk minggu pertama tanpa data. */
  realisasiSebelumPct: number | null;
  kenaikanPp: number | null;
  /** BigInt rupiah sebagai string — bobot agregasi tertimbang. */
  grandTotal: string;
  sourceRefIds: string[];
};

export type CapaianPaparan = {
  locationId: string;
  lokasiNama: string;
  pekerjaan: string;
  unit: string | null;
  /** Σ volume item ini selama minggu paparan (laporan terhitung saja). */
  volume: number;
  sourceRefIds: string[];
};

export type KegiatanPaparan = {
  id: string;
  locationId: string;
  lokasiNama: string;
  tanggalKey: string;
  jenis: string;
  judul: string;
  hasil: string | null;
};

export type KendalaPaparan = {
  id: string;
  judul: string;
  severity: "rendah" | "sedang" | "tinggi" | "kritis";
  status: "terbuka" | "ditangani" | "selesai";
  locationId: string;
  lokasiNama: string;
  punyaRecovery: boolean;
};

export type PemulihanPaparan = {
  issueId: string;
  judulKendala: string;
  tindakan: string;
  pic: string | null;
  targetKey: string | null;
  status: string;
  overdue: boolean;
  lokasiNama: string;
};

export type FotoKandidatPaparan = {
  id: string;
  locationId: string;
  lokasiNama: string;
  tanggalKey: string | null;
  /** Keterangan faktual dari sumber (nama pekerjaan / judul kegiatan). */
  keterangan: string | null;
  /** lineageKey item RAB foto laporan — pengelompok slide foto per pekerjaan. */
  lineageKey?: string | null;
  r2Key: string;
  thumbnailKey: string | null;
};

export type RencanaLokasiPaparan = {
  locationId: string;
  lokasiNama: string;
  catatan: string | null;
  item: { nama: string; unit: string | null; targetVolume: number }[];
};

/**
 * Kurva-S paket untuk slide diagram (contoh Mataram): rencana kumulatif SATU
 * deret penuh (gabungan tertimbang deret kanonik tiap lokasi), realisasi hanya
 * pada JENDELA tiga minggu terakhir s.d. minggu paparan – persis pola contoh:
 * garis rencana putus-putus sepanjang kontrak, garis realisasi pendek yang
 * menegaskan posisi sekarang.
 */
export type KurvaPaparan = {
  totalMinggu: number;
  /** Rencana kumulatif % per minggu (index 0 = minggu 1). */
  planPct: number[];
  /** Realisasi kumulatif pada minggu (mingguKe−2..mingguKe yang valid). */
  jendela: { minggu: number; realisasiPct: number; kenaikanPp: number | null }[];
};

export type DurasiPaparan = {
  totalHari: number;
  hariBerjalan: number;
  sisaHari: number;
  /** % waktu kontrak yang telah berjalan (0..100). */
  pctWaktu: number;
};

/** Status pekerjaan per KATEGORI RAB satu lokasi – bahan bar berwarna. */
export type KategoriLokasiPaparan = {
  locationId: string;
  lokasiNama: string;
  kelompok: {
    lineageKey: string;
    nama: string;
    realisasiPct: number;
    /**
     * Bobot kategori terhadap TOTAL RAB PAKET (%) – dasar rekomendasi Action
     * Plan: sisa bobot = bobotPct × (1 − realisasi). Opsional: artefak lama
     * belum memilikinya, dan rekomendasi berbasis bobot dilewati tanpa itu.
     */
    bobotPct?: number;
  }[];
};

export type PaparanSnapshot = {
  version: 1;
  paket: {
    id: string;
    name: string;
    packageNumber: string | null;
    ownerAgency: string;
    province: string | null;
  };
  kontrak: {
    contractNumber: string;
    workTitle: string | null;
    vendorName: string;
    /** BigInt rupiah sebagai string. */
    contractValue: string;
    startDateKey: string;
    endDateKey: string | null;
    durationDays: number;
    ppkName: string | null;
    supervisorName: string | null;
    supervisorFirm: string | null;
  };
  periode: {
    mingguKe: number;
    totalMinggu: number;
    mulaiKey: string;
    akhirKey: string;
    /** Minggu BERJALAN — belum genap; wajib berlabel di setiap tampilan. */
    berjalan: boolean;
    /** Tanggal perhitungan angka (akhir minggu, atau hari ini utk minggu berjalan). */
    asOfKey: string;
  };
  /** Watermark terakhir data sumber berubah (ISO) — bukan waktu render. */
  dataAsOf: string | null;
  progres: {
    paket: {
      targetPct: number | null;
      realisasiPct: number;
      deviasiPp: number | null;
      realisasiSebelumPct: number | null;
      kenaikanPp: number | null;
      lokasiDihitung: number;
      lokasiTanpaKurva: number;
    };
    lokasi: ProgresLokasiPaparan[];
  };
  kelengkapan: {
    diharapkan: number;
    final: number;
    diproses: number;
    draft: number;
    perluKoreksi: number;
    hariNihil: number;
    lokasiTanpaLaporan: string[];
  };
  capaian: CapaianPaparan[];
  kegiatan: KegiatanPaparan[];
  kendala: {
    baruMingguIni: KendalaPaparan[];
    terbukaSaatIni: KendalaPaparan[];
    /**
     * Minggu lampau: status terbuka/pemulihan adalah status TERKINI saat
     * paparan dibuat (Issue tidak menyimpan histori status) — bukan status pada
     * akhir minggu itu. Jujur di limitation, jangan mengarang sejarah.
     */
    statusTerkini: boolean;
  };
  pemulihan: PemulihanPaparan[];
  fotoKandidat: FotoKandidatPaparan[];
  /** null = modul rencana mingguan belum diisi utk minggu berikutnya. */
  rencanaMingguDepan: RencanaLokasiPaparan[] | null;
  /** Deret kurva-S paket; tidak ada bila belum satu pun lokasi berkurva. Opsional: snapshot v1 belum memilikinya. */
  kurva?: KurvaPaparan | null;
  /** Durasi pelaksanaan kontrak. Opsional: snapshot v1 belum memilikinya. */
  durasi?: DurasiPaparan;
  /** Status pekerjaan per kategori RAB per lokasi. Opsional: snapshot v1 belum memilikinya. */
  kategori?: KategoriLokasiPaparan[];
  limitations: string[];
  sourceRefs: SourceRef[];
};

/* ── Narasi (keluaran AI ATAU fallback deterministik) ───────────────────── */

const butir = z.object({
  text: z.string().min(3).max(360),
  sourceRefIds: z.array(z.string()).min(1),
});
const butirLokasi = butir.extend({ locationId: z.string().nullable() });

export const paparanNarasiSchema = z.object({
  title: z.string().max(160),
  ringkasanEksekutif: z.array(butir).max(4),
  capaianNaratif: z.array(butirLokasi).max(8),
  kegiatanNaratif: z.array(butirLokasi).max(8),
  sintesisKendala: z.array(butirLokasi).max(8),
  rencanaNaratif: z.array(butirLokasi).max(6),
  dukunganDibutuhkan: z.array(butir).max(5),
  /**
   * ACTION PLAN – saran NYATA kegiatan satu minggu ke depan berdasarkan data
   * minggu terakhir (permintaan user 2026-08-22, mengikuti contoh Mataram).
   * `.default([])` supaya narasi v1 yang tersimpan tetap lolos parse.
   */
  actionPlan: z.array(butir).max(6).default([]),
  limitations: z.array(z.string().max(300)).max(15),
});
export type PaparanNarasi = z.infer<typeof paparanNarasiSchema>;

/* ── Suntingan manusia (terbatas — angka TIDAK bisa disunting) ──────────── */

/**
 * Yang boleh disunting manusia hanya NARASI dan caption foto. Angka, periode,
 * nama kontrak, dan tabel selalu ditarik renderer dari snapshot — tidak ada
 * jalur menyunting angka lewat UI narasi.
 */
export type PaparanHumanEdits = {
  title?: string;
  ringkasanEksekutif?: string[];
  capaianNaratif?: string[];
  kegiatanNaratif?: string[];
  sintesisKendala?: string[];
  rencanaNaratif?: string[];
  dukunganDibutuhkan?: string[];
  actionPlan?: string[];
  /** photoId → caption pengganti. */
  captionFoto?: Record<string, string>;
};

/** Isi kanonik `AiArtifact.structuredContent` untuk kind=paparan. */
export type PaparanContent = {
  scopeHash: string;
  templateKey: typeof PAPARAN_TEMPLATE_KEY;
  templateVersion: number;
  packageId: string;
  weekNumber: number;
  snapshot: PaparanSnapshot;
  narasi: PaparanNarasi;
  /** "ai" = lolos grounding · "deterministik" = fallback tanpa AI. */
  narasiSumber: "ai" | "deterministik";
  selectedPhotoIds: string[];
  humanEdits: PaparanHumanEdits | null;
};
