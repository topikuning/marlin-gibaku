/**
 * Utilitas uang. Storage = BigInt rupiah integer.
 * PPN: RAB tersimpan pre-PPN; nilai kontrak inklusif PPN.
 * Dipakai konsisten di SEMUA modul (perbaikan bug lama: finance mengabaikan PPN).
 */

export function ppnAmount(preTax: bigint, ppnPercent: number): bigint {
  // persen bisa pecahan (mis. 11 / 12); hitung basis 1/100 dgn pembulatan integer
  return (preTax * BigInt(Math.round(ppnPercent * 100))) / 10000n;
}

export function withPpn(preTax: bigint, ppnPercent: number): bigint {
  return preTax + ppnAmount(preTax, ppnPercent);
}

/** Selisih nilai kontrak vs RAB+PPN melebihi toleransi 0.1%? */
export function contractMismatch(contractValue: bigint, rabPreTax: bigint, ppnPercent: number): boolean {
  const expected = withPpn(rabPreTax, ppnPercent);
  if (expected === 0n) return contractValue !== 0n;
  const diff = contractValue > expected ? contractValue - expected : expected - contractValue;
  return diff > expected / 1000n;
}

/** Nilai realisasi item = round(volume × hargaSatuan). Formula lama dipertahankan. */
export function valueDone(volume: number, unitPrice: number): bigint {
  return BigInt(Math.round(volume * unitPrice));
}

export function pct(part: bigint | number, whole: bigint | number): number {
  const w = typeof whole === "bigint" ? Number(whole) : whole;
  if (w <= 0) return 0;
  const p = typeof part === "bigint" ? Number(part) : part;
  return (p / w) * 100;
}

/** Serialisasi BigInt → string untuk boundary JSON (tanpa round-trip penuh). */
export function bigintToString<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}
