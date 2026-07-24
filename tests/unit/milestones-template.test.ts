import { describe, expect, it } from "vitest";
import {
  ADMIN_MILESTONE_TEMPLATE,
  ADMIN_MILESTONE_TOTAL,
  LOKASI_MILESTONES,
  PAKET_MILESTONES,
  milestoneScope,
} from "@/lib/milestones/template";

describe("scope milestone (induk paket vs lokasi) — DECISIONS 078", () => {
  it("partisi induk + lokasi = total, tanpa tumpang tindih", () => {
    expect(PAKET_MILESTONES.length + LOKASI_MILESTONES.length).toBe(ADMIN_MILESTONE_TOTAL);
    const paketKeys = new Set(PAKET_MILESTONES.map((t) => t.key));
    for (const l of LOKASI_MILESTONES) expect(paketKeys.has(l.key)).toBe(false);
  });

  it("hanya serah terima lokasi & MC-0 yang per lokasi", () => {
    expect(LOKASI_MILESTONES.map((t) => t.key).sort()).toEqual(
      [
        "ba-pemeriksaan-bersama-mc0",
        "ba-persetujuan-mc0",
        "ba-serah-terima-lokasi",
        "justifikasi-teknis-pengawas",
        "permohonan-kesiapan-mc0",
        "pernyataan-pemahaman-lokasi",
        "undangan-pelaksanaan-mc0",
        "undangan-pembahasan-mc0",
        "undangan-peninjauan-lokasi",
      ].sort(),
    );
  });

  it("dokumen kontrak/induk = scope paket (ikut induk, bukan per lokasi)", () => {
    for (const key of ["sppbj", "kontrak", "jaminan-pelaksanaan", "keabsahan-jaminan-pelaksanaan", "spmk", "bast-pho", "bast-fho", "ba-pembayaran", "ba-pcm"]) {
      expect(milestoneScope(key)).toBe("paket");
    }
  });

  it("MC-0 & serah terima lokasi = scope lokasi", () => {
    for (const key of ["ba-persetujuan-mc0", "ba-serah-terima-lokasi", "undangan-peninjauan-lokasi"]) {
      expect(milestoneScope(key)).toBe("lokasi");
    }
  });

  it("templateKey tak dikenal → default paket (aman)", () => {
    expect(milestoneScope("entah-apa")).toBe("paket");
  });

  it("semua item punya scope valid", () => {
    for (const t of ADMIN_MILESTONE_TEMPLATE) expect(["paket", "lokasi"]).toContain(t.scope);
  });
});
