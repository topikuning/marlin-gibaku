import { describe, expect, it } from "vitest";
import { cocokkanUsulanHarga, hasilHargaAiSchema } from "@/lib/ahsp/hsd-ai-parse";

describe("usulan harga AI RAPL", () => {
  const target = [
    { id: "r1", kategori: "bahan", nama: "Semen Portland", satuan: "kg" },
    { id: "r2", kategori: "upah", nama: "Pekerja", satuan: "OH" },
  ];

  it("memakai identitas target server dan membuang id asing atau kembar", () => {
    const hasil = cocokkanUsulanHarga(target, [
      { id: "r1", harga: 1_500, keyakinan: "sedang", alasan: "estimasi daerah" },
      { id: "r1", harga: 99_000, keyakinan: "tinggi", alasan: "duplikat" },
      { id: "r999", harga: 1, keyakinan: "tinggi", alasan: "id karangan" },
    ]);
    expect(hasil).toEqual([
      {
        kategori: "bahan",
        nama: "Semen Portland",
        satuan: "kg",
        harga: "1500",
        keyakinan: "sedang",
        alasan: "estimasi daerah",
      },
    ]);
  });

  it("menolak harga nol, pecahan, atau di luar batas", () => {
    expect(
      hasilHargaAiSchema.safeParse({
        suggestions: [{ id: "r1", harga: 0, keyakinan: "rendah", alasan: "tidak sah" }],
      }).success,
    ).toBe(false);
    expect(
      hasilHargaAiSchema.safeParse({
        suggestions: [{ id: "r1", harga: 1.5, keyakinan: "rendah", alasan: "pecahan" }],
      }).success,
    ).toBe(false);
    expect(
      hasilHargaAiSchema.safeParse({
        suggestions: [{ id: "r1", harga: 1_000_000_000_001, keyakinan: "rendah", alasan: "terlalu besar" }],
      }).success,
    ).toBe(false);
  });
});
