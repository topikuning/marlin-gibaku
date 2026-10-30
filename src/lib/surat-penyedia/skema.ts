import { z } from "zod";

/**
 * Bentuk `SuratPenyedia.isian` (DECISIONS 716). Disimpan sebagai JSON; selalu
 * dibaca lewat skema ini supaya isian lama/rusak tidak menjatuhkan unduhan.
 */
export const isianSuratSchema = z.object({
  kepada: z.array(z.string().trim().min(1).max(200)).max(8).catch([]).default([]),
  lampiran: z.array(z.string().trim().min(1).max(200)).max(20).catch([]).default([]),
});

export type IsianSurat = z.infer<typeof isianSuratSchema>;

/** Baris teks dari textarea → daftar tanpa baris kosong. */
export function barisTeks(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
