/**
 * Tipe untuk `audit-hasil.mjs` — lihat alasan JS murni di `ci-perlu.d.mts`.
 */

/** Golongan hasil `pnpm audit`: aman, temuan sungguhan, atau endpoint gagal. */
export type GolonganAudit = "aman" | "temuan" | "endpoint";

export function klasifikasiAudit(keluaran: string, kode: number): GolonganAudit;
