/*
 * DRAF ANALISA AI – pembersih jawaban (DECISIONS baru 2026-10-07).
 *
 * AI boleh MENGUSULKAN koefisien; ia tidak boleh menentukan item mana yang
 * dianalisa, dan angka yang tidak masuk akal tidak boleh lolos jadi draf.
 */
import { describe, expect, it } from "vitest";
import { cocokkanUsulanAnalisa, hasilAnalisaAiSchema, BATAS_KOEFISIEN } from "@/lib/ahsp/analisa-ai-parse";

const target = [
  { id: "r1", lineageKey: "I#1", code: "1", uraian: "Pasangan batu kali 1:4", satuan: "m3" },
  { id: "r2", lineageKey: "I#2", code: "2", uraian: "Mobilisasi", satuan: "Ls" },
];

describe("cocokkanUsulanAnalisa", () => {
  it("identitas item selalu dari server; id asing dan id ganda dibuang", () => {
    const h = cocokkanUsulanAnalisa(target, [
      { id: "r1", keyakinan: "sedang", alasan: "SNI pasangan batu", komponen: [{ kategori: "bahan", nama: "Batu kali", satuan: "m3", koefisien: 1.2 }] },
      { id: "r1", keyakinan: "tinggi", alasan: "duplikat", komponen: [{ kategori: "bahan", nama: "Semen", satuan: "kg", koefisien: 163 }] },
      { id: "r9", keyakinan: "tinggi", alasan: "item karangan", komponen: [{ kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1 }] },
    ]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ lineageKey: "I#1", uraian: "Pasangan batu kali 1:4", satuan: "m3", alasan: "SNI pasangan batu" });
  });

  it("koefisien nol, negatif, tak hingga, atau berlebihan dibuang; komponen kembar tidak dijumlahkan", () => {
    const h = cocokkanUsulanAnalisa(target, [
      {
        id: "r1",
        keyakinan: "rendah",
        alasan: "uji",
        komponen: [
          { kategori: "bahan", nama: "Semen  PC", satuan: "kg", koefisien: 163.123456789 },
          { kategori: "bahan", nama: "semen pc", satuan: "KG", koefisien: 50 },
          { kategori: "bahan", nama: "Pasir", satuan: "m3", koefisien: 0 },
          { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: -1 },
          { kategori: "alat", nama: "Molen", satuan: "jam", koefisien: Number.POSITIVE_INFINITY },
          { kategori: "alat", nama: "Truk", satuan: "jam", koefisien: BATAS_KOEFISIEN + 1 },
          { kategori: "upah", nama: "Tukang batu", satuan: "OH", koefisien: 0.6 },
        ],
      },
    ]);
    expect(h[0]!.komponen).toEqual([
      { kategori: "bahan", nama: "Semen PC", satuan: "kg", koefisien: 163.12345679 },
      { kategori: "upah", nama: "Tukang batu", satuan: "OH", koefisien: 0.6 },
    ]);
  });

  it("item yang tidak menyisakan komponen sah tidak menjadi draf", () => {
    const h = cocokkanUsulanAnalisa(target, [
      { id: "r2", keyakinan: "rendah", alasan: "tidak yakin", komponen: [{ kategori: "alat", nama: "Truk", satuan: "rit", koefisien: 0 }] },
    ]);
    expect(h).toEqual([]);
  });

  it("skema menolak kategori di luar bahan/upah/alat", () => {
    const r = hasilAnalisaAiSchema.safeParse({
      items: [{ id: "r1", keyakinan: "sedang", alasan: "uji", komponen: [{ kategori: "overhead", nama: "Untung", satuan: "%", koefisien: 10 }] }],
    });
    expect(r.success).toBe(false);
  });
});
