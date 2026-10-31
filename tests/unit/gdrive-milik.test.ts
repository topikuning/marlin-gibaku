import { describe, expect, it } from "vitest";
import { milikMarlin, TOLERANSI_DIBUAT_MS } from "@/lib/gdrive/milik";

/** MARLIN hanya mengubah/membuang berkas Drive buatannya sendiri (DECISIONS 723). */

const jam = (h: number) => new Date(Date.UTC(2026, 9, 31, h));
const berkas = (o: Partial<Parameters<typeof milikMarlin>[0]> = {}) => ({
  id: "x",
  createdTime: jam(10),
  terbitanMarlin: true,
  diubahOrangLain: false,
  ...o,
});

describe("milikMarlin", () => {
  it("terbitan MARLIN, dibuat saat unggahan pertamanya, tidak diubah orang → milik MARLIN", () => {
    // Jejak ditulis SESUDAH unggahan selesai: dibuat sedikit lebih dulu dari jejaknya.
    expect(milikMarlin(berkas(), new Date(jam(10).getTime() + 30_000))).toBe(true);
    expect(milikMarlin(berkas(), new Date(jam(10).getTime() + TOLERANSI_DIBUAT_MS))).toBe(true);
  });

  it("berkas yang sudah ada sebelum MARLIN pertama mengunggah ke sana bukan buatannya, walau bertanda", () => {
    expect(milikMarlin(berkas({ createdTime: jam(8) }), jam(10))).toBe(false);
    expect(milikMarlin(berkas(), new Date(jam(10).getTime() + TOLERANSI_DIBUAT_MS + 1))).toBe(false);
  });

  it("tanpa penanda, tanpa jejak unggah, atau sudah diubah orang lain → tidak disentuh", () => {
    expect(milikMarlin(berkas({ terbitanMarlin: false }), jam(10))).toBe(false);
    expect(milikMarlin(berkas(), null)).toBe(false);
    expect(milikMarlin(berkas(), undefined)).toBe(false);
    expect(milikMarlin(berkas({ diubahOrangLain: true }), jam(10))).toBe(false);
  });
});
