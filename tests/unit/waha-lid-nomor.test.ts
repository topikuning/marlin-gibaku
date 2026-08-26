import { describe, expect, it } from "vitest";
import { kunciLid, nomorDariBalasanLid } from "@/lib/waha/lid-baca";

/**
 * Membaca balasan WAHA untuk `GET /api/{session}/lids/{lid}` (DECISIONS 444).
 *
 * Bentuk balasannya TIDAK didokumentasikan resmi — yang terdokumentasi hanya
 * rute dan bahwa nomornya kadang tidak ada sama sekali (waha#1830). Karena itu
 * pembacaannya sengaja tidak bergantung pada nama medan: yang diambil adalah
 * nilai PERTAMA yang berbentuk JID bernomor, di mana pun letaknya.
 *
 * Yang dijaga di sini bukan satu bentuk balasan, melainkan sifatnya: nomor
 * ditemukan apa pun namanya, dan `@lid` TIDAK PERNAH lolos sebagai jawaban —
 * karena itulah yang sedang dicari padanannya.
 */
describe("nomorDariBalasanLid", () => {
  it("menemukan nomor apa pun nama medannya", () => {
    expect(nomorDariBalasanLid({ pn: "628123456789@c.us" })).toBe("628123456789@c.us");
    expect(nomorDariBalasanLid({ phoneNumber: "628123456789@c.us" })).toBe("628123456789@c.us");
    expect(nomorDariBalasanLid({ id: "628123456789@c.us" })).toBe("628123456789@c.us");
    expect(nomorDariBalasanLid({ nomor: "628123456789" })).toBe("628123456789");
  });

  it("menemukan nomor yang bersarang maupun di dalam larik", () => {
    expect(nomorDariBalasanLid({ data: { contact: { pn: "628123456789@c.us" } } })).toBe(
      "628123456789@c.us",
    );
    expect(nomorDariBalasanLid([{ lid: "1609@lid" }, { pn: "628123456789@s.whatsapp.net" }])).toBe(
      "628123456789@s.whatsapp.net",
    );
  });

  it("@lid TIDAK diterima sebagai jawaban – itu yang sedang dicari padanannya", () => {
    expect(nomorDariBalasanLid({ lid: "160958311837878@lid" })).toBeNull();
    expect(nomorDariBalasanLid({ id: "160958311837878@lid", pn: null })).toBeNull();
  });

  it("balasan kosong / tanpa nomor menghasilkan null, bukan tebakan", () => {
    expect(nomorDariBalasanLid(null)).toBeNull();
    expect(nomorDariBalasanLid({})).toBeNull();
    expect(nomorDariBalasanLid({ pn: "" })).toBeNull();
    expect(nomorDariBalasanLid({ error: "not found" })).toBeNull();
    // Angka yang jelas BUKAN nomor telepon tidak diambil.
    expect(nomorDariBalasanLid({ count: "12" })).toBeNull();
  });
});

describe("kunciLid", () => {
  it("satu LID selalu menghasilkan satu kunci, apa pun cara menulisnya", () => {
    expect(kunciLid("160958311837878@LID")).toBe(kunciLid(" 160958311837878@lid "));
  });

  it("LID berbeda tidak pernah bertabrakan kuncinya", () => {
    expect(kunciLid("1@lid")).not.toBe(kunciLid("2@lid"));
  });
});
