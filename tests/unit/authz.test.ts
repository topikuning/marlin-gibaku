import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, isCrossLocation, ROLE_CAPABILITIES } from "@/lib/authz";

describe("authz capability matrix", () => {
  it("super_admin punya SEMUA capability", () => {
    for (const cap of CAPABILITIES) {
      expect(can("super_admin", cap)).toBe(true);
    }
  });

  it("field_supervisor hanya daily_report.create + view", () => {
    const expected = new Set([
      "location.view",
      "rab.view",
      "progress.view",
      "document.view",
      "daily_report.create",
    ]);
    for (const cap of CAPABILITIES) {
      expect(can("field_supervisor", cap), cap).toBe(expected.has(cap));
    }
  });

  it("program_director TIDAK punya system.manage, sisanya punya", () => {
    expect(can("program_director", "system.manage")).toBe(false);
    for (const cap of CAPABILITIES) {
      if (cap === "system.manage") continue;
      expect(can("program_director", cap), cap).toBe(true);
    }
  });

  it("exec_viewer tidak bisa finance.input (hanya lihat)", () => {
    expect(can("exec_viewer", "finance.input")).toBe(false);
    expect(can("exec_viewer", "finance.view")).toBe(true);
    expect(can("exec_viewer", "daily_report.create")).toBe(false);
  });

  it("matrix terdefinisi untuk semua role", () => {
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      expect(ROLE_CAPABILITIES[role as keyof typeof ROLE_CAPABILITIES].size).toBeGreaterThan(0);
    }
  });

  it("cross-location: super_admin/program_director/exec_viewer saja", () => {
    expect(isCrossLocation("super_admin")).toBe(true);
    expect(isCrossLocation("program_director")).toBe(true);
    expect(isCrossLocation("exec_viewer")).toBe(true);
    expect(isCrossLocation("site_manager")).toBe(false);
    expect(isCrossLocation("project_manager")).toBe(false);
  });
});
