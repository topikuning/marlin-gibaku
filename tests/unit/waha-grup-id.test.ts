import { describe, expect, it } from "vitest";
import { GrupIdTidakValid, kanonikGrupId, wajibKanonikGrupId } from "@/lib/waha/grup-id";

/**
 * SATU bentuk kanonik ID grup, dipakai saat menulis DAN membaca (DECISIONS 370).
 *
 * Sebelumnya ada dua normalisasi yang tidak setuju: jalur TULIS meloloskan teks
 * apa adanya begitu berakhiran `@g.us` (sufiks perangkat dan domain berhuruf
 * besar ikut tersimpan), sementara jalur BACA mengkanonikkan. Akibatnya satu
 * grup bisa tersimpan dalam bentuk yang tidak pernah sama persis dengan bentuk
 * yang datang dari webhook — dan itu memaksa pembacaan memakai `findFirst()`
 * atas daftar varian, yang membuat paket mana yang menjawab bergantung pada
 * urutan baris.
 */

describe("kanonikGrupId", () => {
  it("bentuk yang sudah rapi tidak berubah", () => {
    expect(kanonikGrupId("120363000000000001@g.us")).toBe("120363000000000001@g.us");
  });

  it("spasi tepi, domain berhuruf besar, dan sufiks perangkat disatukan", () => {
    // Ketiganya bentuk NYATA yang bisa tersimpan lewat jalur tulis lama.
    for (const v of [
      "  120363000000000001@g.us  ",
      "120363000000000001@G.US",
      "120363000000000001:12@g.us",
      "120363000000000001_1@g.us",
    ]) {
      expect(kanonikGrupId(v), v).toBe("120363000000000001@g.us");
    }
  });

  it("tanpa domain dianggap grup", () => {
    expect(kanonikGrupId("120363000000000001")).toBe("120363000000000001@g.us");
  });

  it("kontak s.whatsapp.net dan c.us adalah chat yang sama", () => {
    expect(kanonikGrupId("6285700000001@s.whatsapp.net")).toBe("6285700000001@c.us");
    expect(kanonikGrupId("6285700000001@c.us")).toBe("6285700000001@c.us");
  });

  it("kosong/null → null, bukan string kosong", () => {
    // String kosong sebagai kunci pencarian akan mencocoki baris yang salah.
    for (const v of [null, undefined, "", "   "]) expect(kanonikGrupId(v)).toBeNull();
  });

  it("dua varian yang berbeda tulisan menghasilkan kunci yang SAMA", () => {
    // Inti seluruh perbaikan: inilah yang membuat indeks unik bisa menangkap
    // dua paket yang sebenarnya menunjuk grup yang sama.
    const a = kanonikGrupId("120363000000000009@g.us");
    const b = kanonikGrupId("120363000000000009:5@G.US");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });
});

describe("wajibKanonikGrupId – jalur tulis", () => {
  it("kosong dan salah-format dibedakan pesannya", () => {
    // Admin yang lupa mengisi butuh kalimat lain daripada admin yang menempel
    // teks yang salah; satu pesan untuk dua sebab membuat keduanya menebak.
    expect(() => wajibKanonikGrupId("")).toThrow(/kosong/i);
    expect(() => wajibKanonikGrupId("grup proyek jepara")).toThrow(/tidak dikenal/i);
  });

  it("melempar GrupIdTidakValid, bukan Error umum", () => {
    expect(() => wajibKanonikGrupId("")).toThrow(GrupIdTidakValid);
  });

  it("menerima @g.us dan @c.us, keduanya dikanonikkan", () => {
    expect(wajibKanonikGrupId("120363000000000001:9@G.US")).toBe("120363000000000001@g.us");
    expect(wajibKanonikGrupId("6285700000001@s.whatsapp.net")).toBe("6285700000001@c.us");
  });
});
