/**
 * Nama & lokasi berkas basis AHSP. MURNI (tanpa db, tanpa fs) supaya bisa
 * dipakai skrip penyiap maupun jalur impor tanpa saling menarik. DECISIONS 325.
 */

export const AHSP_SOURCE_CODE = "SE_DJBK_47_2026";

/** Berkas master apa adanya dari penyusunnya — sumber yang sah, dipakai audit. */
export const NAMA_MASTER = "ahsp-se-djbk-47-2026.json";

/**
 * Bentuk siap-alir hasil `pnpm ahsp:siapkan`. Dipakai jalur impor karena master
 * 14,6 MB tidak muat di-`JSON.parse` pada server 512 MB.
 */
export const FOLDER_SIAP = "ahsp";
export const NAMA_MANIFEST = "manifest.json";
export const NAMA_NDJSON = "entri.ndjson";

/** Bentuk manifest — dibaca impor, ditulis skrip penyiap. */
export type ManifestAhsp = {
  sourceCode: string;
  /** sha256 berkas MASTER, bukan sha NDJSON: itu yang membuktikan versinya. */
  fileSha256: string;
  masterFile: string;
  sumber: {
    code: string;
    name: string;
    subject: string | null;
    schemaVersion: string;
    /** ISO string — JSON tidak punya tipe tanggal. */
    generatedAt: string;
    documents: unknown;
    matchingEngine: unknown;
  };
  ringkas: {
    total: number;
    kanonik: number;
    perluVerifikasi: number;
    tanpaKomponen: number;
    punyaAlias: number;
    komponen: { upah: number; bahan: number; alat: number };
    kategoriLain: Record<string, number>;
    bidang: Record<string, number>;
  };
  jumlah: { entri: number; komponen: number };
};
