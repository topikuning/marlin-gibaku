/**
 * Formatting Rupiah (CLAUDE.md § Money). Storage BigInt → display id-ID.
 * BigInt nilai kontrak (~miliar) masih di bawah Number.MAX_SAFE_INTEGER,
 * jadi konversi ke Number aman untuk display.
 */
const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatRupiah(value: bigint | number): string {
  return IDR.format(typeof value === "bigint" ? Number(value) : value);
}

/** Versi ringkas: Rp 3,06 M / Rp 450 jt — untuk kartu/tabel padat. */
export function formatRupiahShort(value: bigint | number): string {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (n >= 1_000_000_000)
    return `Rp ${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (n >= 1_000_000)
    return `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} jt`;
  return formatRupiah(n);
}
