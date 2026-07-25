import { describe, expect, it } from "vitest";
import { statusAfterUpload } from "@/lib/milestones/status";

describe("statusAfterUpload (auto-maju + bisa override)", () => {
  it("dokumen memajukan item baru → selesai (tanpa verifikasi)", () => {
    expect(statusAfterUpload("belum_dimulai", "belum_dimulai", false)).toBe("selesai");
  });

  it("dokumen pada item butuh verifikasi → berjalan (menunggu verifikasi)", () => {
    expect(statusAfterUpload("belum_dimulai", "belum_dimulai", true)).toBe("berjalan");
  });

  it("override manual dihormati (user pilih status lain saat upload)", () => {
    expect(statusAfterUpload("belum_dimulai", "menunggu_pihak_lain", false)).toBe("menunggu_pihak_lain");
    expect(statusAfterUpload("belum_dimulai", "tidak_berlaku", true)).toBe("tidak_berlaku");
  });

  it("tidak mundur bila sudah selesai / tidak berlaku", () => {
    expect(statusAfterUpload("selesai", "selesai", false)).toBe("selesai");
    expect(statusAfterUpload("tidak_berlaku", "tidak_berlaku", true)).toBe("tidak_berlaku");
  });

  it("item 'berjalan' yang diunggah lagi tetap berjalan (butuh verifikasi)", () => {
    expect(statusAfterUpload("berjalan", "berjalan", true)).toBe("berjalan");
  });
});
