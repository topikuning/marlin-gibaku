import { describe, expect, it } from "vitest";
import {
  buildPrototypeExceptions,
  generatePrototypeLocations,
  provinceDistribution,
  summarizePrototypePortfolio,
} from "../../src/lib/prototype/ui-rebuild/mock-data";

describe("UI rebuild prototype mock data", () => {
  it("menghasilkan 120 lokasi deterministik dengan identitas unik", () => {
    const first = generatePrototypeLocations(120);
    const second = generatePrototypeLocations(120);

    expect(first).toEqual(second);
    expect(first).toHaveLength(120);
    expect(new Set(first.map((location) => location.id)).size).toBe(120);
    expect(new Set(first.map((location) => location.slug)).size).toBe(120);
  });

  it("mencakup edge case yang diperlukan prototype", () => {
    const locations = generatePrototypeLocations(120);

    expect(locations.some((location) => location.reportedPct === 0)).toBe(true);
    expect(locations.some((location) => location.reportedPct === 100)).toBe(true);
    expect(locations.some((location) => location.reportStatus === "belum_ada")).toBe(true);
    expect(locations.some((location) => location.reportStatus === "draft")).toBe(true);
    expect(locations.some((location) => location.deviationPct <= -20)).toBe(true);
    expect(locations.some((location) => location.owner === null)).toBe(true);
    expect(locations.some((location) => !location.hasPhoto)).toBe(true);
    expect(locations.some((location) => location.issueCount >= 9)).toBe(true);
    expect(locations.some((location) => location.name.length > 80)).toBe(true);
  });

  it("menyusun summary, exception, dan distribusi wilayah yang konsisten", () => {
    const locations = generatePrototypeLocations(120);
    const exceptions = buildPrototypeExceptions(locations);
    const summary = summarizePrototypePortfolio(locations, exceptions);
    const regions = provinceDistribution(locations);

    expect(summary.active).toBeLessThanOrEqual(120);
    expect(summary.submitted + summary.missing + summary.draft).toBe(120);
    expect(summary.criticalIssues).toBeGreaterThan(0);
    expect(summary.awaitingDecision).toBeGreaterThan(0);
    expect(exceptions.length).toBeGreaterThan(20);
    expect(exceptions[0].severity).toBe("kritis");
    expect(regions).toHaveLength(7);
    expect(regions.reduce((sum, region) => sum + region.total, 0)).toBe(120);
  });
});
