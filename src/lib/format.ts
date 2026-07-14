import { TZDate } from "@date-fns/tz";
import { format as formatDate } from "date-fns";
import { id as localeId } from "date-fns/locale";

export const APP_TZ = "Asia/Jakarta";

const rupiahFmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const numberFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export function formatRupiah(value: bigint | number): string {
  return rupiahFmt.format(typeof value === "bigint" ? Number(value) : value);
}

/** Rupiah ringkas untuk KPI: 1,2 M / 345 jt. */
export function formatRupiahShort(value: bigint | number): string {
  const n = typeof value === "bigint" ? Number(value) : value;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `Rp ${(n / 1_000_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} T`;
  if (abs >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (abs >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return rupiahFmt.format(n);
}

export function formatNumber(value: number): string {
  return numberFmt.format(value);
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Tanggal di zona Asia/Jakarta. */
export function formatTanggal(date: Date, pattern = "d MMM yyyy"): string {
  return formatDate(new TZDate(date, APP_TZ), pattern, { locale: localeId });
}

export function formatTanggalWaktu(date: Date): string {
  return formatTanggal(date, "d MMM yyyy HH.mm");
}

/** "YYYY-MM-DD" di Asia/Jakarta — kunci bucketing harian. */
export function jakartaDateKey(date: Date): string {
  return formatDate(new TZDate(date, APP_TZ), "yyyy-MM-dd");
}

/** Hari ini (date-only) di Asia/Jakarta sebagai Date UTC-midnight — untuk kolom @db.Date. */
export function jakartaToday(): Date {
  return new Date(`${jakartaDateKey(new Date())}T00:00:00.000Z`);
}

/** Parse "YYYY-MM-DD" ke Date UTC-midnight; null bila tidak valid. */
export function parseDateKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const d = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
