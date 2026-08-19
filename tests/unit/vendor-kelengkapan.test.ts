// KELENGKAPAN PROFIL PERUSAHAAN (DECISIONS 359).
//
// Angka persentase di daftar master data hanya berguna kalau APA yang dihitung
// bisa disebut. Karena itu yang diuji di sini bukan cuma angkanya, melainkan
// bahwa angka dan daftar "apa yang kurang" tidak pernah bisa berbeda.
import { describe, expect, it } from "vitest";
import { kelengkapanVendor, ringkasKurang, type ProfilVendor } from "@/lib/vendor/kelengkapan";

const KOSONG: ProfilVendor = {
  npwp: null,
  contact: null,
  address: null,
  phone: null,
  email: null,
  logoUrl: null,
  kopUrl: null,
  stempelUrl: null,
};

const PENUH: ProfilVendor = {
  npwp: "01.234.567.8-901.000",
  contact: "Budi",
  address: "Jl. Merdeka 1",
  phone: "0812",
  email: "a@b.id",
  logoUrl: "https://r2/logo.png",
  kopUrl: "https://r2/kop.png",
  stempelUrl: "https://r2/stempel.png",
};

describe("kelengkapanVendor", () => {
  it("kosong = 0% dan seluruh isian disebut", () => {
    const r = kelengkapanVendor(KOSONG);
    expect(r.persen).toBe(0);
    expect(r.lengkap).toBe(false);
    expect(r.kurang).toEqual(["NPWP", "PIC", "telepon", "email", "alamat", "logo", "stempel", "kop surat"]);
  });

  it("penuh = 100% dan tidak ada yang kurang", () => {
    const r = kelengkapanVendor(PENUH);
    expect(r.persen).toBe(100);
    expect(r.lengkap).toBe(true);
    expect(r.kurang).toEqual([]);
  });

  it("persen SELALU turunan dari daftar kurang — keduanya tidak bisa berbeda", () => {
    /*
     * Invarian yang paling penting di sini. Kalau persentase dihitung terpisah,
     * suatu saat ia akan menulis "100%" di samping daftar yang masih berisi —
     * dan yang dipercaya orang adalah angkanya.
     */
    const kasus: ProfilVendor[] = [
      KOSONG,
      PENUH,
      { ...KOSONG, npwp: "1" },
      { ...PENUH, logoUrl: null },
      { ...PENUH, npwp: null, email: null },
    ];
    for (const v of kasus) {
      const r = kelengkapanVendor(v);
      const total = r.kurang.length + Math.round((r.persen / 100) * 8);
      expect(total, JSON.stringify(v)).toBe(8);
      expect(r.lengkap).toBe(r.kurang.length === 0);
    }
  });

  it("SPASI saja bukan isi", () => {
    // Kolom yang berisi " " lolos dari cek `!= null` dan membuat profil tampak
    // lengkap padahal tidak ada isinya.
    const r = kelengkapanVendor({ ...KOSONG, npwp: "   ", contact: "\t" });
    expect(r.persen).toBe(0);
    expect(r.kurang).toContain("NPWP");
    expect(r.kurang).toContain("PIC");
  });

  it("nama perusahaan TIDAK ikut dihitung", () => {
    // Ia wajib ada untuk membuat barisnya; memasukkannya hanya menaikkan setiap
    // persentase dengan angka yang sama tanpa membedakan apa pun.
    expect(kelengkapanVendor(KOSONG).kurang).not.toContain("nama");
  });
});

describe("ringkasKurang", () => {
  it("tidak ada yang kurang → null, bukan kalimat kosong", () => {
    expect(ringkasKurang([])).toBeNull();
  });

  it("sampai batas disebut semua", () => {
    expect(ringkasKurang(["NPWP", "PIC"])).toBe("Belum ada: NPWP, PIC");
  });

  it("lebih dari batas dipotong dan SISANYA DIHITUNG", () => {
    // "+N lagi" menjaga barisnya pendek tanpa menyembunyikan bahwa masih ada.
    expect(ringkasKurang(["a", "b", "c", "d", "e"])).toBe("Belum ada: a, b, c +2 lagi");
  });
});
