import { describe, it, expect, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";
// Rusak fontconfig dengan SENGAJA: cap harus tetap ter-render karena font
// dibenamkan (base64 @font-face) ke SVG, bukan bergantung font sistem.
process.env.FONTCONFIG_FILE = "/nonexistent/fonts.conf";
process.env.FONTCONFIG_PATH = "/nonexistent";
vi.mock("server-only", () => ({}));

const { sharpSelfTest } = await import("@/lib/photos");

describe("sharpSelfTest (font dibenamkan)", () => {
  it("cap ter-render walau fontconfig rusak (font base64 @font-face)", async () => {
    const r = await sharpSelfTest();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/webp/);
  }, 20000);
});
