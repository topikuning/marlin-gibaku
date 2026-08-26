import { describe, expect, it } from "vitest";
import { alasanDuplikat, normalNomorSurat } from "@/lib/surat/duplikat";

describe("normalNomorSurat", () => {
  it("nomor yang sama walau beda spasi & huruf besar dianggap sama", () => {
    const a = normalNomorSurat("16/PPM/VIII/2026");
    expect(normalNomorSurat("16 / ppm / viii / 2026")).toBe(a);
    expect(normalNomorSurat("  16/PPM/VIII/2026  ")).toBe(a);
  });

  it("nomor yang BERBEDA tetap berbeda – pagar tidak boleh menelan surat sah", () => {
    expect(normalNomorSurat("16/PPM/VIII/2026")).not.toBe(normalNomorSurat("17/PPM/VIII/2026"));
    expect(normalNomorSurat("16/PPM/VIII/2026")).not.toBe(normalNomorSurat("16/PPM/IX/2026"));
  });

  it("kosong, spasi saja, dan null menjadi null (tidak dibandingkan)", () => {
    expect(normalNomorSurat(null)).toBeNull();
    expect(normalNomorSurat(undefined)).toBeNull();
    expect(normalNomorSurat("")).toBeNull();
    expect(normalNomorSurat("   ")).toBeNull();
  });

  it("pemisah titik dan strip disamakan dengan garis miring", () => {
    expect(normalNomorSurat("16-PPM-VIII-2026")).toBe(normalNomorSurat("16/PPM/VIII/2026"));
    expect(normalNomorSurat("16.PPM.VIII.2026")).toBe(normalNomorSurat("16/PPM/VIII/2026"));
  });
});

describe("alasanDuplikat", () => {
  const lama = { agendaNo: 1, agendaYear: 2026, letterNumber: "16/PPM/VIII/2026", fileName: "surat.pdf" };

  it("menyebut agenda yang bentrok, bukan sekadar 'sudah ada'", () => {
    const p = alasanDuplikat(
      { nomorNormal: "16/ppm/viii/2026", direction: "masuk", fileR2Key: null },
      lama,
      "nomor",
    );
    expect(p).toContain("agenda 1/2026");
    expect(p).toContain("16/PPM/VIII/2026");
    // Jalan keluarnya ikut disebut, supaya orang tidak buntu.
    expect(p).toContain("betulkan nomornya");
  });

  it("duplikat berkas menyebut nama berkasnya", () => {
    const p = alasanDuplikat({ nomorNormal: null, direction: "masuk", fileR2Key: "surat/abc" }, lama, "berkas");
    expect(p).toContain("agenda 1/2026");
    expect(p).toContain("surat.pdf");
  });
});
