import { describe, expect, it, vi } from "vitest";

// photos.ts mengimpor db (server-only). Set env + mock server-only, lalu import dinamis.
process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";
vi.mock("server-only", () => ({}));

const { parseWhatsAppTime } = await import("@/lib/photos");

/**
 * Ambil jam dari nama file WhatsApp (EXIF terbuang). Diasumsikan WIB (+07:00).
 * DECISIONS 116.
 */
describe("parseWhatsAppTime", () => {
  it("format desktop/iOS 24 jam", () => {
    const d = parseWhatsAppTime("WhatsApp Image 2026-07-25 at 14.30.55.jpeg");
    expect(d?.toISOString()).toBe("2026-07-25T07:30:55.000Z"); // 14:30:55 WIB = 07:30:55 UTC
  });

  it("format 12 jam dengan PM", () => {
    const d = parseWhatsAppTime("WhatsApp Image 2026-07-25 at 2.30.55 PM.jpeg");
    expect(d?.toISOString()).toBe("2026-07-25T07:30:55.000Z");
  });

  it("12 jam AM tengah malam (12 AM → 00)", () => {
    const d = parseWhatsAppTime("WhatsApp Image 2026-07-25 at 12.05.00 AM.jpeg");
    expect(d?.toISOString()).toBe("2026-07-24T17:05:00.000Z"); // 00:05 WIB = 17:05 UTC hari sebelumnya
  });

  it("varian dengan pemisah titik dua & suffix (n)", () => {
    const d = parseWhatsAppTime("WhatsApp Image 2026-07-25 at 09:00:00 (1).jpeg");
    expect(d?.toISOString()).toBe("2026-07-25T02:00:00.000Z");
  });

  it("Android IMG-YYYYMMDD-WAxxxx tanpa jam → null", () => {
    expect(parseWhatsAppTime("IMG-20260725-WA0001.jpg")).toBeNull();
  });

  it("nama non-WhatsApp → null", () => {
    expect(parseWhatsAppTime("foto_lapangan_123.jpg")).toBeNull();
    expect(parseWhatsAppTime(null)).toBeNull();
    expect(parseWhatsAppTime("")).toBeNull();
  });

  it("jam tidak valid → null", () => {
    expect(parseWhatsAppTime("WhatsApp Image 2026-07-25 at 25.00.00.jpeg")).toBeNull();
  });
});
