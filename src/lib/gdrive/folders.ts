import type { DocumentType } from "@/generated/prisma/enums";

/**
 * Struktur folder standar KKP di dalam Drive tiap paket (9 folder bernomor),
 * plus pemetaan keluaran MARLIN ke folder-folder itu. MURNI (tanpa DB/network).
 *
 * Prinsip: nama folder ditulis PERSIS seperti yang dipakai KKP — MARLIN mencari
 * folder itu dulu; kalau tidak ada baru dibuat, sehingga folder buatan KKP yang
 * sudah berisi file tidak pernah terduplikasi. Di dalamnya dibuat lapisan
 * <Nama Lokasi> supaya satu paket dengan banyak lokasi tetap rapi & seragam.
 * DECISIONS 143.
 */

export const KKP_FOLDERS = [
  "1. SPPBJ, SPK, SPMK, RAB, DED",
  "2. PCM",
  "3. LAPORAN HARIAN",
  "4. LAPORAN MINGGUAN",
  "5. LAPORAN BULANAN",
  "6. DOKUMENTASI",
  "7. BERKAS TERMIN",
  "8. SHOP DRAWING",
  "9. AS BUILT",
] as const;

export type KkpFolder = (typeof KKP_FOLDERS)[number];

/**
 * Dokumen administrasi → folder KKP. Yang TIDAK dipetakan (dokumen proses
 * tender internal: undangan, penawaran, BA evaluasi, dll) sengaja tidak
 * diupload — bukan bagian dari yang perlu dishare ke KKP.
 */
const DOC_FOLDER: Partial<Record<DocumentType, KkpFolder>> = {
  sppbj: "1. SPPBJ, SPK, SPMK, RAB, DED",
  kontrak: "1. SPPBJ, SPK, SPMK, RAB, DED",
  spmk: "1. SPPBJ, SPK, SPMK, RAB, DED",
  hps: "1. SPPBJ, SPK, SPMK, RAB, DED",
  ded: "1. SPPBJ, SPK, SPMK, RAB, DED",
  adendum: "1. SPPBJ, SPK, SPMK, RAB, DED",
  jaminan: "1. SPPBJ, SPK, SPMK, RAB, DED",

  pcm: "2. PCM",
  ba_serah_terima_lapangan: "2. PCM",
  mc0: "2. PCM",

  mc_berkala: "7. BERKAS TERMIN",
  invoice: "7. BERKAS TERMIN",
  faktur_pajak: "7. BERKAS TERMIN",
  ba_pembayaran: "7. BERKAS TERMIN",
  bast_pho: "7. BERKAS TERMIN",
  bast_fho: "7. BERKAS TERMIN",

  rks: "1. SPPBJ, SPK, SPMK, RAB, DED",
  smkk: "1. SPPBJ, SPK, SPMK, RAB, DED",

  shop_drawing: "8. SHOP DRAWING",
  as_built: "9. AS BUILT",
};

/**
 * Pemetaan MILESTONE → folder KKP. Lebih tepat daripada jenis dokumen karena
 * banyak milestone (Justifikasi Teknis, BA Pemeriksaan, Permohonan CCO, …) tidak
 * punya jenis dokumen sendiri dan akan tersimpan sebagai "lainnya". Selama
 * dokumen tertaut ke milestone, tujuannya tetap pasti. DECISIONS 144.
 *
 * Prinsip pengelompokan:
 *  - Perencanaan, penunjukan, kontrak, adendum, SCM → folder 1 (administrasi kontrak)
 *  - Serah terima lokasi & SPMK → folder 1 (SPMK memang disebut di nama folder)
 *  - PCM & seluruh rangkaian MC-0 → folder 2
 *  - Termin/pembayaran & serah terima pekerjaan (PHO/FHO) → folder 7
 */
const MILESTONE_FOLDER: Record<string, KkpFolder> = {
  // 1. Perencanaan & persiapan
  "rab-hps": "1. SPPBJ, SPK, SPMK, RAB, DED",
  ded: "1. SPPBJ, SPK, SPMK, RAB, DED",
  rks: "1. SPPBJ, SPK, SPMK, RAB, DED",
  smkk: "1. SPPBJ, SPK, SPMK, RAB, DED",

  // 2. Penunjukan & kontrak
  sppbj: "1. SPPBJ, SPK, SPMK, RAB, DED",
  "pakta-integritas": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "jaminan-pelaksanaan": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "keabsahan-jaminan-pelaksanaan": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "undangan-kontrak": "1. SPPBJ, SPK, SPMK, RAB, DED",
  kontrak: "1. SPPBJ, SPK, SPMK, RAB, DED",

  // 3. Serah terima lokasi & mulai kerja
  "undangan-peninjauan-lokasi": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "pernyataan-pemahaman-lokasi": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "ba-serah-terima-lokasi": "1. SPPBJ, SPK, SPMK, RAB, DED",
  spmk: "1. SPPBJ, SPK, SPMK, RAB, DED",

  // 4. PCM & Mutual Check 0% — satu rangkaian acara
  "undangan-pcm": "2. PCM",
  "ba-pcm": "2. PCM",
  "permohonan-kesiapan-mc0": "2. PCM",
  "undangan-pelaksanaan-mc0": "2. PCM",
  "ba-pemeriksaan-bersama-mc0": "2. PCM",
  "justifikasi-teknis-pengawas": "2. PCM",
  "undangan-pembahasan-mc0": "2. PCM",
  "ba-persetujuan-mc0": "2. PCM",

  // 5. Adendum / CCO
  "adendum-1-kontrak": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "permohonan-cco": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "ba-perhitungan-bersama-cco": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "justifikasi-teknis-cco": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "undangan-pembahasan-cco": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "ba-pembahasan-cco": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "persetujuan-cco": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "undangan-penandatanganan-adendum": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "adendum-surat-perjanjian": "1. SPPBJ, SPK, SPMK, RAB, DED",

  // 6. Termin & pembayaran
  "ba-pembahasan-kemajuan": "7. BERKAS TERMIN",
  "laporan-kemajuan": "7. BERKAS TERMIN",
  "permohonan-pemeriksaan-pekerjaan": "7. BERKAS TERMIN",
  "ba-pemeriksaan-pekerjaan": "7. BERKAS TERMIN",
  "ba-persetujuan-persentase": "7. BERKAS TERMIN",
  "permohonan-pembayaran": "7. BERKAS TERMIN",
  "ba-pembayaran": "7. BERKAS TERMIN",

  // 7. Kontrak kritis / SCM — administrasi kontrak
  "surat-peringatan-kontrak-kritis": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "undangan-ba-scm": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "ba-pembuktian-scm": "1. SPPBJ, SPK, SPMK, RAB, DED",
  "adendum-pemberian-kesempatan": "1. SPPBJ, SPK, SPMK, RAB, DED",

  // 8. Serah terima pekerjaan — prasyarat pembayaran akhir
  "permohonan-pho": "7. BERKAS TERMIN",
  "bast-pho": "7. BERKAS TERMIN",
  "bast-fho": "7. BERKAS TERMIN",
};

/** Folder KKP untuk milestone (templateKey). Null bila key tak dikenal. */
export function folderForMilestone(templateKey: string | null | undefined): KkpFolder | null {
  if (!templateKey) return null;
  return MILESTONE_FOLDER[templateKey] ?? null;
}

/** Folder KKP untuk satu dokumen; null = tidak perlu/ tidak layak dishare. */
export function folderForDocumentType(type: DocumentType): KkpFolder | null {
  return DOC_FOLDER[type] ?? null;
}

/** Semua tipe dokumen yang punya tujuan folder KKP (untuk UI & pengecekan). */
export function mappedDocumentTypes(): DocumentType[] {
  return Object.keys(DOC_FOLDER) as DocumentType[];
}

/* ── Penamaan segmen path ───────────────────────────────────────────────── */

/**
 * Bersihkan satu segmen nama folder Drive: buang karakter pemisah path & kontrol,
 * rapatkan spasi, potong panjang. String kosong → null (jangan bikin folder tanpa nama).
 */
export function sanitizeSegment(raw: string): string | null {
  const s = raw
    .replace(/[/\\]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return s.length > 0 ? s : null;
}


/** Buang segmen kosong/tak valid dari sebuah path. */
export function cleanPath(segments: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg == null) continue;
    const s = sanitizeSegment(seg);
    if (s) out.push(s);
  }
  return out;
}

const MONTHS_ID = [
  "01 Januari", "02 Februari", "03 Maret", "04 April", "05 Mei", "06 Juni",
  "07 Juli", "08 Agustus", "09 September", "10 Oktober", "11 November", "12 Desember",
];

/** Folder bulan dari dateKey "YYYY-MM-DD" → "2026-07 Juli". Null bila format salah. */
export function monthFolder(dateKey: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateKey);
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return null;
  return `${m[1]}-${m[2]} ${MONTHS_ID[idx].slice(3)}`;
}

/* ── Path per jenis keluaran ────────────────────────────────────────────── */

export type PathInput = { locationName: string; dateKey?: string };

/** 3. LAPORAN HARIAN / <Lokasi> / <2026-07 Juli> */
export function dailyReportPath(input: PathInput & { dateKey: string }): string[] {
  return cleanPath(["3. LAPORAN HARIAN", input.locationName, monthFolder(input.dateKey)]);
}

/** 3. … / <bulan> / Foto — foto dipisah agar PDF laporan mudah dicari. */
export function dailyPhotoPath(input: PathInput & { dateKey: string }): string[] {
  return [...dailyReportPath(input), "Foto"];
}

/** 4/5. LAPORAN MINGGUAN|BULANAN / <Lokasi> */
export function periodReportPath(kind: "mingguan" | "bulanan", locationName: string): string[] {
  return cleanPath([kind === "mingguan" ? "4. LAPORAN MINGGUAN" : "5. LAPORAN BULANAN", locationName]);
}

/** 6. DOKUMENTASI / <Lokasi> / <bulan> / <tanggal — judul kegiatan> */
export function activityPath(input: {
  locationName: string;
  dateKey: string;
  title: string;
}): string[] {
  return cleanPath([
    "6. DOKUMENTASI",
    input.locationName,
    monthFolder(input.dateKey),
    `${input.dateKey} ${input.title}`,
  ]);
}

/**
 * Dokumen administrasi → <folder KKP> / <Lokasi bila dokumen milik lokasi>.
 * Urutan penentuan: MILESTONE dulu (paling spesifik — banyak milestone tidak
 * punya jenis dokumen sendiri), baru jenis dokumen. Null = tak dipetakan.
 */
export function documentPath(
  input: { type: DocumentType; milestoneKey?: string | null; locationName?: string | null },
): string[] | null {
  const folder = folderForMilestone(input.milestoneKey) ?? folderForDocumentType(input.type);
  if (!folder) return null;
  return cleanPath([folder, input.locationName ?? null]);
}

/* ── Penamaan file ──────────────────────────────────────────────────────── */

/** Nama file aman untuk Drive (tanpa pemisah path), ekstensi dipertahankan. */
export function safeFileName(raw: string, fallback = "file"): string {
  const s = sanitizeSegment(raw);
  return s ?? fallback;
}

/**
 * Nama foto: urut & informatif tanpa bergantung nama asli dari HP —
 * "2026-07-26 Pasar Banggi 01.jpg".
 */
export function photoFileName(input: {
  dateKey: string;
  locationName: string;
  index: number;
  ext: string;
}): string {
  const n = String(Math.max(1, input.index)).padStart(2, "0");
  const ext = input.ext.replace(/^\.+/, "").toLowerCase() || "jpg";
  return safeFileName(`${input.dateKey} ${input.locationName} ${n}.${ext}`, `foto-${n}.${ext}`);
}

/** Ekstensi + MIME dari r2Key foto (default jpg — semua foto distempel ke JPEG). */
export function photoMimeFromKey(r2Key: string): { ext: string; mime: string } {
  const m = /\.([a-z0-9]+)$/i.exec(r2Key);
  const ext = (m?.[1] ?? "jpg").toLowerCase();
  if (ext === "png") return { ext, mime: "image/png" };
  if (ext === "webp") return { ext, mime: "image/webp" };
  return { ext: ext === "jpeg" ? "jpg" : ext, mime: "image/jpeg" };
}
