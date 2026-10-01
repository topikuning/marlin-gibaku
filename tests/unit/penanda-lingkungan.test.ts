/*
 * PENANDA LINGKUNGAN (DECISIONS 640).
 *
 * User 2026-10-01: server dev/test harus terlihat beda – "kalau cuma domain
 * yang beda rentan lupa". Produksi bersih; selain produksi selalu berlabel,
 * walau PENANDA_LINGKUNGAN lupa diisi.
 */
import { describe, expect, it } from "vitest";
import { labelLingkungan } from "@/lib/lingkungan";

describe("labelLingkungan", () => {
  it("produksi tanpa label → tidak ada penanda", () => {
    expect(labelLingkungan({ APP_ENV: "production" })).toBeNull();
    expect(labelLingkungan({ APP_ENV: "production", PENANDA_LINGKUNGAN: "  " })).toBeNull();
  });
  it("server uji ber-image produksi tetap berlabel bila PENANDA_LINGKUNGAN diisi", () => {
    expect(labelLingkungan({ APP_ENV: "production", PENANDA_LINGKUNGAN: "dev lenovo" })).toBe("DEV LENOVO");
  });
  it("lupa mengisi label di lingkungan non-produksi tetap berlabel", () => {
    expect(labelLingkungan({ APP_ENV: "development" })).toBe("DEV");
    expect(labelLingkungan({ APP_ENV: "test" })).toBe("TEST");
  });
});
