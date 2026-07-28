import { describe, expect, it } from "vitest";
import {
  filterNav,
  MAIN_NAV,
  MOBILE_NAV,
  NAV_GROUP_ORDER,
} from "@/components/shell/nav-config";

describe("navigation redesign", () => {
  it("assigns every production destination to a stable work group", () => {
    expect(MAIN_NAV.length).toBeGreaterThan(10);
    expect(MAIN_NAV.every((item) => NAV_GROUP_ORDER.includes(item.group))).toBe(true);
    expect(new Set(MAIN_NAV.map((item) => item.href)).size).toBe(MAIN_NAV.length);
  });

  it("shows the unified action centre only to roles with portfolio access", () => {
    expect(filterNav("super_admin").some((item) => item.href === "/tindakan")).toBe(true);
    expect(filterNav("field_supervisor").some((item) => item.href === "/tindakan")).toBe(false);
  });

  it("keeps mobile navigation compact and capability-filtered", () => {
    const management = MOBILE_NAV("super_admin");
    const field = MOBILE_NAV("field_supervisor");

    expect(management).toHaveLength(4);
    expect(field.length).toBeLessThanOrEqual(4);
    expect(management.some((item) => item.href === "/tindakan")).toBe(true);
    expect(field[0]?.href).toBe("/hari-ini");
  });
});
