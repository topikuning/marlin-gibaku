import { describe, expect, it } from "vitest";
import { ALL_ROLES, CAPABILITIES, ROLE_CAPABILITIES } from "@/lib/authz";
import {
  KELOMPOK_KEMAMPUAN,
  KEMAMPUAN_LABEL,
  kemampuanTanpaKelompok,
  selKemampuan,
} from "@/lib/authz-ringkas";

/**
 * Ringkasan peran yang KETINGGALAN lebih berbahaya daripada tidak ada
 * ringkasan: halaman Administrasi tetap terbaca lengkap sementara satu
 * kemampuan diam-diam tidak pernah disebut. Uji ini yang menjaga agar
 * capability baru di `authz.ts` tidak bisa lolos tanpa tempat.
 */
describe("ringkasan kemampuan peran", () => {
  it("setiap capability masuk tepat satu kelompok", () => {
    expect(kemampuanTanpaKelompok(), "capability tanpa kelompok").toEqual([]);

    const semua = KELOMPOK_KEMAMPUAN.flatMap((k) => k.kemampuan);
    const ganda = semua.filter((c, i) => semua.indexOf(c) !== i);
    expect(ganda, "capability muncul di lebih dari satu kelompok").toEqual([]);
    expect(semua).toHaveLength(CAPABILITIES.length);
  });

  it("setiap capability punya label berbahasa Indonesia yang tidak kosong", () => {
    for (const cap of CAPABILITIES) {
      expect(KEMAMPUAN_LABEL[cap]?.trim(), `label kosong untuk ${cap}`).toBeTruthy();
    }
  });

  it("kunci & nama kelompok unik", () => {
    const keys = KELOMPOK_KEMAMPUAN.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    const nama = KELOMPOK_KEMAMPUAN.map((k) => k.nama);
    expect(new Set(nama).size).toBe(nama.length);
  });

  it("tingkat sel konsisten dengan ROLE_CAPABILITIES", () => {
    for (const role of ALL_ROLES) {
      for (const kelompok of KELOMPOK_KEMAMPUAN) {
        const sel = selKemampuan(role, kelompok);
        const nyata = kelompok.kemampuan.filter((c) => ROLE_CAPABILITIES[role].has(c));
        expect(sel.dimiliki).toEqual(nyata);
        expect(sel.total).toBe(kelompok.kemampuan.length);
        const diharapkan =
          nyata.length === 0 ? "tidak" : nyata.length === kelompok.kemampuan.length ? "penuh" : "sebagian";
        expect(sel.tingkat, `${role} × ${kelompok.key}`).toBe(diharapkan);
      }
    }
  });

  it("super_admin penuh di semua kelompok", () => {
    for (const kelompok of KELOMPOK_KEMAMPUAN) {
      expect(selKemampuan("super_admin", kelompok).tingkat, kelompok.key).toBe("penuh");
    }
  });

  it("wakil_ppk tidak punya satu pun kemampuan yang mengubah data", () => {
    // DECISIONS 199: pemberi kerja membaca, tidak menulis. Kelompok yang
    // seluruhnya berupa aksi tulis harus kosong untuknya.
    for (const key of ["paket", "rencana", "harian", "foto", "keuangan", "ai", "administrasi"]) {
      const kelompok = KELOMPOK_KEMAMPUAN.find((k) => k.key === key)!;
      expect(selKemampuan("wakil_ppk", kelompok).tingkat, key).toBe("tidak");
    }
  });
});
