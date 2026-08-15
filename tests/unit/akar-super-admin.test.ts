import { describe, expect, it } from "vitest";
import { adalahAkar, parseAkar } from "@/lib/akar";

/**
 * SUPER ADMIN UTAMA dari variabel lingkungan (DECISIONS 315).
 *
 * Yang paling berharga diuji di sini: mencantumkan username SEMBARANG di env
 * tidak mengangkat siapa pun. Env menunjuk siapa DI ANTARA para super admin
 * yang jadi akar — ia bukan alat pengangkatan. Tanpa syarat itu, satu salah
 * ketik di dashboard Railway berubah jadi eskalasi wewenang diam-diam.
 */

describe("parseAkar", () => {
  it("membaca daftar dipisah koma, rapi dari spasi", () => {
    expect(parseAkar("hery, admin ,  owner")).toEqual(["hery", "admin", "owner"]);
  });

  it("huruf besar di env tetap cocok dengan username huruf kecil di database", () => {
    // Username dipaksa huruf kecil saat dibuat (/^[a-z0-9._-]+$/). Tanpa
    // normalisasi, "Admin" di Railway diam-diam tidak cocok dengan "admin".
    expect(parseAkar("Admin,HERY")).toEqual(["admin", "hery"]);
  });

  it("kosong / tidak diisi = tidak ada akar sama sekali", () => {
    expect(parseAkar(undefined)).toEqual([]);
    expect(parseAkar(null)).toEqual([]);
    expect(parseAkar("")).toEqual([]);
    expect(parseAkar("   ")).toEqual([]);
    expect(parseAkar(",,")).toEqual([]);
  });

  it("koma berlebih tidak menghasilkan entri kosong yang cocok dengan apa pun", () => {
    // Entri kosong yang lolos akan cocok dengan username kosong/null.
    expect(parseAkar("hery,,")).toEqual(["hery"]);
  });
});

describe("adalahAkar", () => {
  const daftar = parseAkar("hery,admin");

  it("super admin yang namanya tercantum = akar", () => {
    expect(adalahAkar({ username: "hery", role: "super_admin" }, daftar)).toBe(true);
  });

  it("PERAN wajib super_admin — env tidak mengangkat siapa pun", () => {
    // Salah ketik di Railway yang kebetulan cocok dengan username mandor tidak
    // boleh memberi mandor itu kewenangan apa pun.
    expect(adalahAkar({ username: "hery", role: "field_supervisor" }, daftar)).toBe(false);
    expect(adalahAkar({ username: "hery", role: "program_director" }, daftar)).toBe(false);
  });

  it("super admin yang TIDAK tercantum bukan akar", () => {
    expect(adalahAkar({ username: "orang-lain", role: "super_admin" }, daftar)).toBe(false);
  });

  it("akun tanpa username bukan akar", () => {
    expect(adalahAkar({ username: null, role: "super_admin" }, daftar)).toBe(false);
    expect(adalahAkar({ username: "", role: "super_admin" }, daftar)).toBe(false);
  });

  it("daftar kosong = tidak ada yang jadi akar", () => {
    expect(adalahAkar({ username: "hery", role: "super_admin" }, [])).toBe(false);
  });

  it("perbandingan tidak peka huruf besar-kecil di kedua sisi", () => {
    expect(adalahAkar({ username: "HERY", role: "super_admin" }, daftar)).toBe(true);
  });
});
