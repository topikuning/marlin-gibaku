/**
 * MESIN KESIAPAN termin / PHO / FHO / close-out — MURNI (tanpa DB), DECISIONS 426.
 *
 * Rule engine, BUKAN AI: setiap syarat punya status yang diturunkan dari data
 * dan alasan spesifik yang bisa diklik. Angka progress datang dari calculation
 * layer (`progress.ts`) — modul ini tidak menghitung ulang formula apa pun.
 *
 * "Terverifikasi" di sini = level status laporan internal (disetujui+final,
 * `VERIFIED_REPORT_STATUSES`), bukan verifikasi Wakil PPK.
 */

export type SyaratStatus = "lolos" | "peringatan" | "gagal";

export type Syarat = {
  key: string;
  label: string;
  status: SyaratStatus;
  /** Alasan spesifik ("Progress terverifikasi 43,2% dari ambang 50%"). */
  detail: string;
  /** Deep-link ke objek yang membuat syarat ini tidak lolos. */
  href?: string;
};

export type KesiapanVerdict = "siap" | "siap_catatan" | "belum_siap";

export const KESIAPAN_VERDICT_LABEL: Record<KesiapanVerdict, string> = {
  siap: "Siap",
  siap_catatan: "Siap dengan catatan",
  belum_siap: "Belum siap",
};

export const KESIAPAN_VERDICT_TONE: Record<KesiapanVerdict, "success" | "warning" | "danger"> = {
  siap: "success",
  siap_catatan: "warning",
  belum_siap: "danger",
};

/** Gagal satu saja → belum siap; hanya peringatan → siap dengan catatan. */
export function verdictDariSyarat(syarat: Syarat[]): KesiapanVerdict {
  if (syarat.some((s) => s.status === "gagal")) return "belum_siap";
  if (syarat.some((s) => s.status === "peringatan")) return "siap_catatan";
  return "siap";
}

/**
 * Ambang progress TOTAL kontrak untuk tiap termin (DECISIONS 078 / OPEN_ISSUES
 * "Auto-flag termin"): termin 1..4 ditagih saat progres agregat mencapai
 * 25 / 50 / 80 / 100 %.
 */
export const AMBANG_TERMIN_PCT = [25, 50, 80, 100] as const;

/** Ambang termin berikutnya berdasar jumlah termin yang SUDAH diajukan/cair. */
export function ambangTerminBerikutnya(jumlahTerminTerpakai: number): {
  terminKe: number;
  ambangPct: number;
} | null {
  if (jumlahTerminTerpakai >= AMBANG_TERMIN_PCT.length) return null;
  return { terminKe: jumlahTerminTerpakai + 1, ambangPct: AMBANG_TERMIN_PCT[jumlahTerminTerpakai] };
}

/** Toleransi pembanding persen di presentasi (100% vs 99,999…%). */
export const TOLERANSI_PCT = 0.005;

export function pctMencukupi(nilaiPct: number, ambangPct: number): boolean {
  return nilaiPct >= ambangPct - TOLERANSI_PCT;
}
