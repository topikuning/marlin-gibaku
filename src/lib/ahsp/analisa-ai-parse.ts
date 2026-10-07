import { z } from "zod";

/**
 * DRAF ANALISA DARI AI – bagian murni (DECISIONS baru 2026-10-07).
 *
 * Permintaan user: *"aku ingin ada integrasi dengan AI atas item-item yang belum
 * terpetakan ahsp sistem kita ataupun analisa bahan dan upah dari sumber impor
 * data, jadi tujuan utama sistem ini bisa memberikan analisa kebutuhan dan
 * breakdown real cost"*. Ini mencabut jawaban "belum" di DECISIONS 326 dengan
 * syarat yang sudah disepakati di sana: draf berstatus tersendiri, wajib
 * diterima orang, dan asalnya DIPISAH di layar maupun Excel.
 *
 * Yang dijaga di sini: identitas item selalu dari server (lewat id buatan
 * server), koefisien wajib angka positif yang masuk akal, dan komponen kembar
 * tidak dijumlahkan diam-diam – yang pertama dipakai, sisanya dibuang.
 */

/** Item per permintaan. Kecil, supaya jawaban muat di satu panggilan dan bisa diperiksa orang. */
export const BATAS_ITEM_ANALISA_AI = 12;
export const BATAS_KOMPONEN = 20;
/** Koefisien per satuan item di atas ini hampir pasti salah satuan, bukan analisa. */
export const BATAS_KOEFISIEN = 100_000;

export const hasilAnalisaAiSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        keyakinan: z.enum(["rendah", "sedang", "tinggi"]),
        alasan: z.string().min(3).max(400),
        komponen: z
          .array(
            z.object({
              kategori: z.enum(["bahan", "upah", "alat"]),
              nama: z.string().min(2).max(160),
              satuan: z.string().min(1).max(40),
              koefisien: z.number(),
            }),
          )
          .min(1)
          .max(BATAS_KOMPONEN * 2),
      }),
    )
    .max(BATAS_ITEM_ANALISA_AI * 2),
});

export type TargetAnalisaAi = {
  id: string;
  lineageKey: string;
  code: string;
  uraian: string;
  satuan: string;
};

export type KomponenAnalisaAi = { kategori: "bahan" | "upah" | "alat"; nama: string; satuan: string; koefisien: number };

export type UsulanAnalisaAi = {
  lineageKey: string;
  code: string;
  uraian: string;
  satuan: string;
  keyakinan: "rendah" | "sedang" | "tinggi";
  alasan: string;
  komponen: KomponenAnalisaAi[];
};

const rapikan = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Jodohkan jawaban AI ke item server lewat id. Nama/satuan ITEM dari model
 * tidak pernah dipercaya; komponen dibersihkan, yang tidak sah dibuang.
 * Item yang tidak menyisakan satu komponen pun tidak menjadi draf.
 */
export function cocokkanUsulanAnalisa(
  target: TargetAnalisaAi[],
  items: z.infer<typeof hasilAnalisaAiSchema>["items"],
): UsulanAnalisaAi[] {
  const byId = new Map(target.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const hasil: UsulanAnalisaAi[] = [];
  for (const it of items) {
    const t = byId.get(it.id);
    if (!t || seen.has(it.id)) continue;
    seen.add(it.id);
    const kunci = new Set<string>();
    const komponen: KomponenAnalisaAi[] = [];
    for (const k of it.komponen) {
      const nama = rapikan(k.nama);
      const satuan = rapikan(k.satuan);
      if (nama.length < 2 || satuan === "") continue;
      if (!Number.isFinite(k.koefisien) || k.koefisien <= 0 || k.koefisien > BATAS_KOEFISIEN) continue;
      const kk = `${k.kategori}|${nama.toLowerCase()}|${satuan.toLowerCase()}`;
      if (kunci.has(kk)) continue;
      kunci.add(kk);
      // Presisi kolom koefisien (Decimal 24,8).
      komponen.push({ kategori: k.kategori, nama, satuan, koefisien: Math.round(k.koefisien * 1e8) / 1e8 });
      if (komponen.length >= BATAS_KOMPONEN) break;
    }
    if (komponen.length === 0) continue;
    hasil.push({
      lineageKey: t.lineageKey,
      code: t.code,
      uraian: t.uraian,
      satuan: t.satuan,
      keyakinan: it.keyakinan,
      alasan: rapikan(it.alasan).slice(0, 400),
      komponen,
    });
  }
  return hasil;
}
