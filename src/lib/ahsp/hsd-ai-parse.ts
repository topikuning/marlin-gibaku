import { z } from "zod";
import { BATAS_HARGA_RUPIAH } from "./hsd-price";
// Batasnya tinggal di `usulan-target.ts` bersama aturan pemilihannya — dua
// definisi untuk satu angka adalah cara termudah keduanya jadi berbeda.
import { BATAS_USULAN_HARGA_AI } from "./usulan-target";

export const hasilHargaAiSchema = z.object({
  suggestions: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        harga: z.number().int().positive().max(Number(BATAS_HARGA_RUPIAH)),
        keyakinan: z.enum(["rendah", "sedang", "tinggi"]),
        alasan: z.string().min(3).max(240),
      }),
    )
    .max(BATAS_USULAN_HARGA_AI),
});

export type TargetHargaAi = {
  id: string;
  kategori: string;
  nama: string;
  satuan: string;
};

export type UsulanHargaAi = {
  kategori: string;
  nama: string;
  satuan: string;
  harga: string;
  keyakinan: "rendah" | "sedang" | "tinggi";
  alasan: string;
};

/**
 * Jodohkan output AI lewat id buatan server. Nama/kategori/satuan dari model
 * tidak pernah dipercaya; identitas selalu dikembalikan dari target server.
 */
export function cocokkanUsulanHarga(
  target: TargetHargaAi[],
  suggestions: z.infer<typeof hasilHargaAiSchema>["suggestions"],
): UsulanHargaAi[] {
  const byId = new Map(target.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const hasil: UsulanHargaAi[] = [];
  for (const s of suggestions) {
    const row = byId.get(s.id);
    if (!row || seen.has(s.id)) continue;
    seen.add(s.id);
    hasil.push({
      kategori: row.kategori,
      nama: row.nama,
      satuan: row.satuan,
      harga: String(s.harga),
      keyakinan: s.keyakinan,
      alasan: s.alasan,
    });
  }
  return hasil;
}
