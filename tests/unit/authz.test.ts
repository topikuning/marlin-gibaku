import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  can,
  canCreateRole,
  creatableRoles,
  isCrossLocation,
  ROLE_CAPABILITIES,
} from "@/lib/authz";

describe("authz capability matrix", () => {
  it("super_admin punya SEMUA capability", () => {
    for (const cap of CAPABILITIES) {
      expect(can("super_admin", cap)).toBe(true);
    }
  });

  it("field_supervisor hanya view + daily_report.create + field_activity.manage", () => {
    const expected = new Set([
      "location.view",
      "rab.view",
      "progress.view",
      "document.view",
      "daily_report.create",
      "field_activity.manage",
    ]);
    for (const cap of CAPABILITIES) {
      expect(can("field_supervisor", cap), cap).toBe(expected.has(cap));
    }
  });

  it("program_director TIDAK punya system.manage & contract.edit, sisanya punya", () => {
    expect(can("program_director", "system.manage")).toBe(false);
    expect(can("program_director", "contract.edit")).toBe(false); // koreksi kontrak khusus super_admin
    for (const cap of CAPABILITIES) {
      if (cap === "system.manage" || cap === "contract.edit") continue;
      expect(can("program_director", cap), cap).toBe(true);
    }
  });

  it("contract.edit hanya super_admin", () => {
    expect(can("super_admin", "contract.edit")).toBe(true);
    for (const role of ["program_director", "regional_manager", "project_manager", "site_manager", "field_supervisor", "exec_viewer"] as const) {
      expect(can(role, "contract.edit"), role).toBe(false);
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

describe("pembuatan user berjenjang (creatableRoles / canCreateRole)", () => {
  it("PM boleh bikin Site Manager & Mandor, bukan PM/atasan", () => {
    expect(creatableRoles("project_manager")).toEqual(["site_manager", "field_supervisor"]);
    expect(canCreateRole("project_manager", "site_manager")).toBe(true);
    expect(canCreateRole("project_manager", "field_supervisor")).toBe(true);
    expect(canCreateRole("project_manager", "project_manager")).toBe(false);
    expect(canCreateRole("project_manager", "super_admin")).toBe(false);
  });

  it("Site Manager hanya boleh bikin Mandor", () => {
    expect(creatableRoles("site_manager")).toEqual(["field_supervisor"]);
    expect(canCreateRole("site_manager", "field_supervisor")).toBe(true);
    expect(canCreateRole("site_manager", "site_manager")).toBe(false);
  });

  it("Mandor & exec tidak boleh bikin user", () => {
    expect(creatableRoles("field_supervisor")).toEqual([]);
    expect(creatableRoles("exec_viewer")).toEqual([]);
    expect(canCreateRole("field_supervisor", "field_supervisor")).toBe(false);
  });

  it("PM & Site Manager punya capability user.create", () => {
    expect(can("project_manager", "user.create")).toBe(true);
    expect(can("site_manager", "user.create")).toBe(true);
    expect(can("field_supervisor", "user.create")).toBe(false);
  });
});
