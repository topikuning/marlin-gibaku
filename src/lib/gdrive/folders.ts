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
  // Nama di Drive KKP (DECISIONS 715); semula "2. PCM" – tetap dikenali lewat
  // ALIAS_FOLDER_AKAR supaya folder lama buatan MARLIN tidak terkembar.
  "2. Peninjauan Lokasi, PCM, MC-0",
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
 * Nama lama folder akar yang tetap dikenali sebagai folder baku (DECISIONS 715).
 * "2. PCM" dipakai MARLIN sebelum mengikuti nama di Drive KKP; Drive yang sudah
 * punya folder itu tidak dibuatkan kembarannya.
 */
export const ALIAS_FOLDER_AKAR: Partial<Record<KkpFolder, readonly string[]>> = {
  "2. Peninjauan Lokasi, PCM, MC-0": ["2. PCM"],
};

/** Sub-folder di dalam folder 2, persis seperti di Drive KKP. */
export const SUB_FOLDER_2 = ["1. Peninjauan Lokasi", "2. PCM", "3. MC-0"] as const;
export type SubFolder2 = (typeof SUB_FOLDER_2)[number];

/**
 * Dua nama folder dianggap SAMA bila hanya berbeda huruf besar/kecil, tanda
 * baca, atau spasi: "TERMIN 1 (25%) CV. Putera Fahlevi" = "termin 1 25 cv
 * putera fahlevi". Folder buatan orang tidak pernah persis sama ejaannya.
 */
export function kunciNamaFolder(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function samaNamaFolder(a: string, b: string): boolean {
  return kunciNamaFolder(a) === kunciNamaFolder(b);
}

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

  pcm: "2. Peninjauan Lokasi, PCM, MC-0",
  ba_serah_terima_lapangan: "2. Peninjauan Lokasi, PCM, MC-0",
  mc0: "2. Peninjauan Lokasi, PCM, MC-0",

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

  // 3. Peninjauan & serah terima lokasi → folder 2 (namanya memang menyebut
  //    Peninjauan Lokasi, DECISIONS 715). SPMK tetap folder 1.
  "undangan-peninjauan-lokasi": "2. Peninjauan Lokasi, PCM, MC-0",
  "pernyataan-pemahaman-lokasi": "2. Peninjauan Lokasi, PCM, MC-0",
  "ba-serah-terima-lokasi": "2. Peninjauan Lokasi, PCM, MC-0",
  spmk: "1. SPPBJ, SPK, SPMK, RAB, DED",

  // 4. PCM & Mutual Check 0% — satu rangkaian acara
  "undangan-pcm": "2. Peninjauan Lokasi, PCM, MC-0",
  "ba-pcm": "2. Peninjauan Lokasi, PCM, MC-0",
  "permohonan-kesiapan-mc0": "2. Peninjauan Lokasi, PCM, MC-0",
  "undangan-pelaksanaan-mc0": "2. Peninjauan Lokasi, PCM, MC-0",
  "ba-pemeriksaan-bersama-mc0": "2. Peninjauan Lokasi, PCM, MC-0",
  "justifikasi-teknis-pengawas": "2. Peninjauan Lokasi, PCM, MC-0",
  "undangan-pembahasan-mc0": "2. Peninjauan Lokasi, PCM, MC-0",
  "ba-persetujuan-mc0": "2. Peninjauan Lokasi, PCM, MC-0",

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

/**
 * Sub-folder di dalam folder 2 (DECISIONS 715): peninjauan lokasi, PCM, atau
 * MC-0. Milestone dulu, baru jenis dokumen – sama dengan penentuan folder.
 */
const MILESTONE_SUB_2: Record<string, SubFolder2> = {
  "undangan-peninjauan-lokasi": "1. Peninjauan Lokasi",
  "pernyataan-pemahaman-lokasi": "1. Peninjauan Lokasi",
  "ba-serah-terima-lokasi": "1. Peninjauan Lokasi",
  "undangan-pcm": "2. PCM",
  "ba-pcm": "2. PCM",
  "permohonan-kesiapan-mc0": "3. MC-0",
  "undangan-pelaksanaan-mc0": "3. MC-0",
  "ba-pemeriksaan-bersama-mc0": "3. MC-0",
  "justifikasi-teknis-pengawas": "3. MC-0",
  "undangan-pembahasan-mc0": "3. MC-0",
  "ba-persetujuan-mc0": "3. MC-0",
};

const DOC_SUB_2: Partial<Record<DocumentType, SubFolder2>> = {
  ba_serah_terima_lapangan: "1. Peninjauan Lokasi",
  pcm: "2. PCM",
  mc0: "3. MC-0",
};

/** Sub-folder folder 2 untuk dokumen; null bila bukan dokumen folder 2 atau tak tertentu. */
export function subFolder2(input: { type: DocumentType; milestoneKey?: string | null }): SubFolder2 | null {
  if (input.milestoneKey && MILESTONE_SUB_2[input.milestoneKey]) return MILESTONE_SUB_2[input.milestoneKey];
  if (input.milestoneKey && MILESTONE_FOLDER[input.milestoneKey]) return null;
  return DOC_SUB_2[input.type] ?? null;
}

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
 * Dokumen administrasi → <folder KKP> / [<sub-folder 2>] / <Lokasi bila dokumen milik lokasi>.
 * Urutan penentuan: MILESTONE dulu (paling spesifik — banyak milestone tidak
 * punya jenis dokumen sendiri), baru jenis dokumen. Null = tak dipetakan.
 */
export function documentPath(
  input: { type: DocumentType; milestoneKey?: string | null; locationName?: string | null },
): string[] | null {
  const folder = folderForMilestone(input.milestoneKey) ?? folderForDocumentType(input.type);
  if (!folder) return null;
  const sub = folder === KKP_FOLDERS[1] ? subFolder2(input) : null;
  return cleanPath([folder, sub, input.locationName ?? null]);
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
