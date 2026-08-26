export const BATAS_HARGA_RUPIAH = 1_000_000_000_000n;

export type HasilBacaRupiah = bigint | null | "salah";

/**
 * "1.250.000" / "1250000" / "Rp 1 250 000" → 1250000n.
 * Kosong atau nol berarti belum berharga, bukan sumber daya gratis.
 */
export function bacaRupiah(raw: string): HasilBacaRupiah {
  if (raw.trim() === "") return null;
  if (raw.includes("-")) return "salah";
  const digit = raw.replace(/[^\d]/g, "");
  if (digit === "") return "salah";
  try {
    const nilai = BigInt(digit);
    if (nilai === 0n) return null;
    return nilai <= BATAS_HARGA_RUPIAH ? nilai : "salah";
  } catch {
    return "salah";
  }
}
