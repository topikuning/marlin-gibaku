import { describe, it, expect, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";
vi.mock("server-only", () => ({}));

const { sharpSelfTest } = await import("@/lib/photos");

describe("sharpSelfTest", () => {
  it("memproses gambar (resize + cap + webp) di runtime ini", async () => {
    const r = await sharpSelfTest();
    console.log("RESULT:", JSON.stringify(r));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/webp/);
  }, 30000);
});
