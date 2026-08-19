import { describe, expect, it } from "vitest";
import {
  canTransitionPackage,
  canTransitionReport,
  revertTargetFor,
  PACKAGE_STAGE_ORDER,
} from "@/lib/lifecycle";
import { can } from "@/lib/authz";
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

describe("canTransitionPackage – serah terima satu arah", () => {
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

describe("transisi laporan harian – buka kunci final (DECISIONS 149)", () => {
  it("alur normal draft → dikirim → disetujui → final", () => {
    expect(canTransitionReport("draft", "dikirim")).toBe(true);
    expect(canTransitionReport("dikirim", "disetujui")).toBe(true);
    expect(canTransitionReport("disetujui", "final")).toBe(true);
  });

  it("final HANYA boleh kembali ke disetujui (koreksi), tidak ke status lain", () => {
    expect(canTransitionReport("final", "disetujui")).toBe(true);
    expect(canTransitionReport("final", "draft")).toBe(false);
    expect(canTransitionReport("final", "dikirim")).toBe(false);
    expect(canTransitionReport("final", "perlu_koreksi")).toBe(false);
  });

  it("lompatan yang melewati review tetap ditolak", () => {
    expect(canTransitionReport("draft", "final")).toBe(false);
    expect(canTransitionReport("draft", "disetujui")).toBe(false);
    expect(canTransitionReport("dikirim", "final")).toBe(false);
  });
});

describe("kapabilitas buka kunci final", () => {
  it("hanya super_admin", () => {
    expect(can("super_admin", "daily_report.unfinalize")).toBe(true);
    for (const r of ["program_director", "regional_manager", "project_manager", "site_manager"] as const) {
      expect(can(r, "daily_report.unfinalize")).toBe(false);
    }
  });

  it("finalisasi biasa TIDAK ikut terbuka aksesnya", () => {
    // Site manager boleh memfinalkan, tapi tetap tidak boleh membuka kunci.
    expect(can("site_manager", "daily_report.finalize")).toBe(true);
    expect(can("site_manager", "daily_report.unfinalize")).toBe(false);
  });
});
