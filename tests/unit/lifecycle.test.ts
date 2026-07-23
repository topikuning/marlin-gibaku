import { describe, expect, it } from "vitest";
import {
  canTransitionPackage,
  revertTargetFor,
  PACKAGE_STAGE_ORDER,
} from "@/lib/lifecycle";
import type { PackageStage } from "@/generated/prisma/enums";

describe("revertTargetFor", () => {
  it("mengembalikan tahap sebelumnya untuk langkah aman (tanpa efek samping)", () => {
    expect(revertTargetFor("tender")).toBe("prospek");
    expect(revertTargetFor("penetapan")).toBe("tender");
    expect(revertTargetFor("serah_terima")).toBe("pelaksanaan");
    expect(revertTargetFor("selesai")).toBe("serah_terima");
  });

  it("menolak mundur pada batas berkontrak & terminal (kontrak/pelaksanaan/prospek/batal)", () => {
    // kontrak↔penetapan & pelaksanaan↔kontrak sengaja dikecualikan (Contract,
    // SPMK, status lokasi) — koreksinya lewat Koreksi Kontrak / Batalkan.
    expect(revertTargetFor("kontrak")).toBeNull();
    expect(revertTargetFor("pelaksanaan")).toBeNull();
    expect(revertTargetFor("prospek")).toBeNull();
    expect(revertTargetFor("batal")).toBeNull();
  });

  it("target mundur selalu tepat satu langkah sebelum stage saat ini di urutan", () => {
    for (const stage of PACKAGE_STAGE_ORDER) {
      const target = revertTargetFor(stage);
      if (target) {
        const i = PACKAGE_STAGE_ORDER.indexOf(stage);
        expect(PACKAGE_STAGE_ORDER[i - 1]).toBe(target);
      }
    }
  });

  it("mundur BUKAN transisi maju yang valid (arah berlawanan)", () => {
    const stages = PACKAGE_STAGE_ORDER;
    for (const stage of stages) {
      const target = revertTargetFor(stage);
      if (target) {
        expect(canTransitionPackage(stage, target)).toBe(false);
      }
    }
  });
});

describe("canTransitionPackage — serah terima satu arah", () => {
  it("pelaksanaan hanya boleh maju ke serah_terima", () => {
    const targets: PackageStage[] = [
      "prospek",
      "tender",
      "penetapan",
      "kontrak",
      "pelaksanaan",
      "serah_terima",
      "selesai",
      "batal",
    ];
    for (const t of targets) {
      expect(canTransitionPackage("pelaksanaan", t)).toBe(t === "serah_terima");
    }
  });
});
