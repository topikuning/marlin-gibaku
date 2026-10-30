import { z } from "zod";

/**
 * Bentuk `SuratPenyedia.isian` (DECISIONS 716/717). Disimpan sebagai JSON;
 * selalu dibaca lewat skema ini supaya isian lama/rusak tidak menjatuhkan
 * unduhan. Isian rapat (pimpinan, peserta, cara) hanya dipakai BA pembahasan
 * kemajuan; kosong = bawaan.
 */
export const isianSuratSchema = z.object({
  kepada: z.array(z.string().trim().min(1).max(200)).max(8).catch([]).default([]),
  lampiran: z.array(z.string().trim().min(1).max(200)).max(20).catch([]).default([]),
  pimpinan: z.string().trim().max(200).catch("").default(""),
  peserta: z.array(z.string().trim().min(1).max(200)).max(20).catch([]).default([]),
  cara: z.string().trim().max(200).catch("").default(""),
});

export type IsianSurat = z.infer<typeof isianSuratSchema>;

/**
 * Satu baris progres lokasi dari laporan kemajuan konsultan
 * (`TerminProgresKonsultan.lokasi`, DECISIONS 717).
 */
export const progresLokasiSchema = z.object({
  locationId: z.uuid(),
  /** Nomor laporan konsultan – boleh kosong; contoh asli bahkan menyalin nomor kontrak. */
  nomor: z.string().trim().max(120).default(""),
  /** Tanggal laporan, "YYYY-MM-DD". */
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mingguKe: z.number().int().min(1).max(260),
  persen: z.number().min(0).max(100),
});

export type ProgresLokasi = z.infer<typeof progresLokasiSchema>;

/** Baris lokasi tersimpan; baris yang rusak dibuang, bukan menjatuhkan halaman. */
export function bacaProgresLokasi(raw: unknown): ProgresLokasi[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = progresLokasiSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

/** Baris teks dari textarea → daftar tanpa baris kosong. */
export function barisTeks(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
