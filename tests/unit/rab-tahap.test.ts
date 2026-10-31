import { describe, expect, it } from "vitest";
import { labelTahapBerlaku, tahapRevisi, type RevisiUntukTahap } from "@/lib/rab/tahap";

/** Tahap revisi diturunkan dari riwayat (DECISIONS 728). */
const r = (revisionNo: number, source: RevisiUntukTahap["source"], status: RevisiUntukTahap["status"] = "digantikan") => ({
  id: `r${revisionNo}`,
  revisionNo,
  source,
  status,
});

describe("tahapRevisi", () => {
  it("kontrak → MC-0 → CCO-01 → CCO-02 menurut urutan nomor revisi", () => {
    const t = tahapRevisi([r(4, "adendum", "draft"), r(1, "hps_awal"), r(3, "adendum", "aktif"), r(2, "adendum")]);
    expect(["r1", "r2", "r3", "r4"].map((id) => t.get(id)!.label)).toEqual(["RAB kontrak", "MC-0", "CCO-01", "CCO-02"]);
  });

  it("koreksi bukan tahap: tidak menggeser nomor (kasus Buyat Tengah – dulu draft pertama tercetak CCO-02)", () => {
    const t = tahapRevisi([r(1, "hps_awal"), r(2, "koreksi", "aktif"), r(3, "adendum", "draft")]);
    expect(t.get("r2")).toEqual({ jenis: "koreksi", label: "Koreksi" });
    expect(t.get("r3")!.label).toBe("MC-0");
  });

  it("koreksi di tengah riwayat juga tidak dihitung", () => {
    const t = tahapRevisi([r(1, "hps_awal"), r(2, "adendum"), r(3, "koreksi"), r(4, "adendum", "aktif")]);
    expect(t.get("r4")!.label).toBe("CCO-01");
  });
});

describe("labelTahapBerlaku – blok dasar dokumen", () => {
  it("koreksi memakai tahap terakhir sebelumnya", () => {
    const d = [r(1, "hps_awal"), r(2, "koreksi", "aktif"), r(3, "adendum", "draft")];
    expect(labelTahapBerlaku(d, "r2")).toBe("KONTRAK");
    const e = [r(1, "hps_awal"), r(2, "adendum"), r(3, "koreksi", "aktif"), r(4, "adendum", "draft")];
    expect(labelTahapBerlaku(e, "r3")).toBe("MC - 0");
    expect(labelTahapBerlaku(e, "r4")).toBe("CCO - 01");
  });
});
