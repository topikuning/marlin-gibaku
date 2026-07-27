import { describe, expect, it } from "vitest";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";

/** Guard scope jalur baca AI (audit 2026-07-27, B9). */

describe("scopeCoveredBy", () => {
  it("role lintas lokasi (accessible=null) selalu boleh", () => {
    expect(scopeCoveredBy(null, ["a", "b"])).toBe(true);
    expect(scopeCoveredBy(null, [])).toBe(true);
    expect(scopeCoveredBy(null, undefined)).toBe(true);
  });

  it("boleh hanya bila SEMUA lokasi run tercakup izin", () => {
    expect(scopeCoveredBy(["a", "b", "c"], ["a", "b"])).toBe(true);
    expect(scopeCoveredBy(["a"], ["a"])).toBe(true);
  });

  it("SATU lokasi di luar izin = tolak (jangan bocorkan sebagian)", () => {
    expect(scopeCoveredBy(["a"], ["a", "b"])).toBe(false);
    expect(scopeCoveredBy([], ["a"])).toBe(false);
  });

  it("scope tak teridentifikasi = tolak untuk role scoped, jangan menebak", () => {
    expect(scopeCoveredBy(["a"], [])).toBe(false);
    expect(scopeCoveredBy(["a"], null)).toBe(false);
    expect(scopeCoveredBy(["a"], undefined)).toBe(false);
    expect(scopeCoveredBy(["a"], "bukan-array")).toBe(false);
    expect(scopeCoveredBy(["a"], [123, "a"])).toBe(false); // elemen korup = scope tak teridentifikasi
  });
});
