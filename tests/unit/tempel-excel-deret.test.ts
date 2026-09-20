/*
 * TEMPEL BEBERAPA BARIS DARI EXCEL KE DERET %-KUMULATIF.
 *
 * **Permintaan user 2026-09-20**: *"untuk bagian ini kalau bisa grid saja, jadi
 * aku bisa kopas atas bawah dari excel lalu bisa langsung ditangkap … kebutuhanku
 * aku bisa kopas dari excel beberapa baris langsung diakomodir di situ."*
 *
 * Grid TIDAK dipakai, dan itu bukan penolakan melainkan jawaban atas
 * kebutuhannya: tempel-rentang di AG Grid adalah fitur ENTERPRISE, sedangkan
 * repo ini memakai Community dan Enterprise dilarang (PROJECT.md/stack). Jadi
 * mengganti tabel ini dengan grid justru memberi LEBIH SEDIKIT — kehilangan
 * input yang ada sekarang, tanpa mendapat tempel. Yang memenuhi kebutuhannya
 * adalah menangkap `paste` pada kolomnya sendiri.
 *
 * Parser inilah bagian yang bisa salah diam-diam, jadi ia dipisah dan diuji:
 * papan klip dari spreadsheet tidak pernah sesederhana "satu angka per baris".
 */
import { describe, expect, it } from "vitest";

const { parseTempelanDeret } = await import("@/lib/scurve/tempel");

describe("parseTempelanDeret – papan klip spreadsheet, bukan angka bersih", () => {
  it("satu kolom Excel (dipisah baris baru)", () => {
    expect(parseTempelanDeret("0\n0\n4.2\n8\n13.7")).toEqual([0, 0, 4.2, 8, 13.7]);
  });

  it("satu baris Excel (dipisah tab)", () => {
    expect(parseTempelanDeret("0\t3\t6\t11")).toEqual([0, 3, 6, 11]);
  });

  it("blok beberapa kolom dibaca urut kiri-ke-kanan lalu turun", () => {
    expect(parseTempelanDeret("1\t2\n3\t4")).toEqual([1, 2, 3, 4]);
  });

  it("koma desimal gaya Indonesia", () => {
    expect(parseTempelanDeret("22,8\n33,4")).toEqual([22.8, 33.4]);
  });

  it("pemisah ribuan dibuang, desimal terakhir yang menentukan", () => {
    expect(parseTempelanDeret("1.234,5")).toEqual([1234.5]);
  });

  it("tanda persen, spasi, dan spasi-tak-putus ikut dibersihkan", () => {
    expect(parseTempelanDeret("12,5 %\n 13.0%\n 14 ")).toEqual([12.5, 13, 14]);
  });

  it("CRLF dari Windows tidak menghasilkan sel kosong palsu", () => {
    expect(parseTempelanDeret("5\r\n6\r\n7")).toEqual([5, 6, 7]);
  });

  it("baris kosong di ujung diabaikan – Excel hampir selalu menambahkannya", () => {
    expect(parseTempelanDeret("5\n6\n\n")).toEqual([5, 6]);
  });

  it("sel yang bukan angka membatalkan seluruh tempelan, bukan diam-diam jadi 0", () => {
    // Menelan sel berisi teks sebagai 0 akan menulis rencana 0% pada minggu yang
    // sebenarnya tidak diketahui – persis jenis kebohongan yang dilarang
    // DECISIONS 203. Lebih baik tempelannya ditolak dan orangnya diberi tahu.
    expect(parseTempelanDeret("5\nenam\n7")).toBeNull();
  });

  it("tempelan kosong bukan deret kosong, melainkan bukan tempelan", () => {
    expect(parseTempelanDeret("   \n  ")).toBeNull();
    expect(parseTempelanDeret("")).toBeNull();
  });

  it("satu angka tunggal tetap sah – menempel satu sel itu wajar", () => {
    expect(parseTempelanDeret("42,5")).toEqual([42.5]);
  });
});
