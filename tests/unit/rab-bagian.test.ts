// BAGIAN halaman Rencana & RAB (DECISIONS 362).
//
// Yang diuji bukan "apakah fungsinya mengembalikan string", melainkan dua hal
// yang kalau rusak akan rusak DIAM-DIAM: bagian tak dikenal harus jatuh ke
// bagian yang sah, dan berpindah bagian tidak boleh membuang minggu yang
// sedang dilihat.
import { describe, expect, it } from "vitest";
import { BAGIAN_RAB, bacaBagian, hrefBagian } from "@/lib/rab/bagian";

describe("bacaBagian", () => {
  it("setiap bagian sah dikenali apa adanya", () => {
    for (const b of BAGIAN_RAB) expect(bacaBagian(b)).toBe(b);
  });

  it("tanpa parameter → bagian default, bukan halaman kosong", () => {
    expect(bacaBagian(undefined)).toBe("rab");
    expect(bacaBagian(null)).toBe("rab");
    expect(bacaBagian("")).toBe("rab");
  });

  it("nilai ngawur JATUH ke bagian sah", () => {
    // Alamat diketik, disalin, dan dipotong orang. Halaman yang kosong karena
    // querynya salah ketik terbaca sebagai fitur yang rusak.
    expect(bacaBagian("Rencana")).toBe("rab");
    expect(bacaBagian("../../etc")).toBe("rab");
    expect(bacaBagian("__proto__")).toBe("rab");
  });
});

describe("hrefBagian", () => {
  it("MEMBAWA minggu yang sedang dilihat", () => {
    // Inti keluhannya: mampir ke pohon RAB lalu kembali ke rencana tidak boleh
    // melempar orang ke minggu berjalan.
    const url = new URL(hrefBagian("tambakagung", "rencana", "5"), "https://x");
    expect(url.searchParams.get("bagian")).toBe("rencana");
    expect(url.searchParams.get("minggu")).toBe("5");
  });

  it("tanpa minggu, parameternya TIDAK ditulis kosong", () => {
    // `?minggu=` kosong akan lolos ke parseInt sebagai NaN dan menutupi minggu
    // berjalan yang seharusnya jadi default.
    for (const kosong of [undefined, null, ""]) {
      const url = new URL(hrefBagian("tambakagung", "rab", kosong), "https://x");
      expect(url.searchParams.has("minggu"), String(kosong)).toBe(false);
    }
  });

  it("bagian SELALU ditulis, termasuk yang kebetulan default", () => {
    // Tautan tanpa parameter mendarat di tempat yang sama hari ini, tapi
    // berhenti benar begitu defaultnya diubah — dan gagalnya sunyi.
    for (const b of BAGIAN_RAB) {
      expect(hrefBagian("s", b)).toContain(`bagian=${b}`);
    }
  });

  it("nilai minggu di-ENCODE, bukan ditempel mentah", () => {
    const url = new URL(hrefBagian("s", "rencana", "5&bagian=revisi"), "https://x");
    // Kalau ditempel mentah, `bagian` jadi "revisi" dan tabnya melompat sendiri.
    expect(url.searchParams.get("bagian")).toBe("rencana");
    expect(url.searchParams.get("minggu")).toBe("5&bagian=revisi");
  });

  it("selalu menunjuk halaman RAB lokasi yang diminta", () => {
    const url = new URL(hrefBagian("batah-timur", "revisi"), "https://x");
    expect(url.pathname).toBe("/lokasi/batah-timur/rab");
  });
});
