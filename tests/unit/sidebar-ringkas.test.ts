/*
 * SIDEBAR YANG BISA DIRINGKAS — ATURAN MURNI (DECISIONS 413).
 *
 * Permintaan user 2026-08-22: *"sidebar yang bisa di collapsible, jadi bisa
 * memperlebar pandangan di desktop"*, lalu *"tidak perlu ramping, collapsible
 * saja."*
 *
 * Yang diuji di sini bagian yang tidak butuh peramban: pembacaan nilai
 * tersimpan, dan bentuk skrip pra-lukisnya. Perilaku di layar (tombolnya
 * benar-benar menyempitkan sidebar DAN bantalan konten, lalu diingat sesudah
 * muat ulang) diuji di `tests/e2e/sidebar-ringkas.spec.ts` — hanya peramban
 * sungguhan yang bisa membuktikannya.
 */
import { describe, expect, it } from "vitest";
import {
  ATRIBUT_NAV,
  KUNCI_RINGKAS,
  NILAI_RINGKAS,
  SKRIP_PRA_LUKIS,
  keSimpanan,
  ringkasDariSimpanan,
} from "@/lib/shell/sidebar-ringkas";

describe("membaca pilihan tersimpan", () => {
  it("hanya \"1\" yang berarti diringkas", () => {
    expect(ringkasDariSimpanan("1")).toBe(true);
    expect(ringkasDariSimpanan("0")).toBe(false);
  });

  it("nilai aneh mendarat pada TERBENTANG, bukan diringkas", () => {
    /*
     * Penyimpanan bisa berisi sisa versi lama, string kosong, atau nilai yang
     * disunting orang lewat devtools. Yang gagal harus mendarat pada keadaan
     * yang paling tidak mengagetkan — sidebar seperti biasa. Kalau
     * kebalikannya, orang membuka MARLIN dan menunya sudah menyempit tanpa ia
     * pernah menekan apa pun.
     */
    for (const v of [null, undefined, "", "true", "ya", "ringkas", "01", " 1"]) {
      expect(ringkasDariSimpanan(v), JSON.stringify(v)).toBe(false);
    }
  });

  it("yang ditulis bisa dibaca kembali – bolak-balik", () => {
    expect(ringkasDariSimpanan(keSimpanan(true))).toBe(true);
    expect(ringkasDariSimpanan(keSimpanan(false))).toBe(false);
  });
});

describe("skrip pra-lukis", () => {
  it("memakai kunci & atribut yang SAMA dengan komponennya", () => {
    // Kalau keduanya menyimpang, keadaan tersimpan tidak akan pernah terpakai —
    // dan gejalanya cuma "kadang sidebarnya mengembang sendiri".
    expect(SKRIP_PRA_LUKIS).toContain(JSON.stringify(KUNCI_RINGKAS));
    expect(SKRIP_PRA_LUKIS).toContain(JSON.stringify(ATRIBUT_NAV));
    expect(SKRIP_PRA_LUKIS).toContain(JSON.stringify(NILAI_RINGKAS));
  });

  it("dibungkus try/catch – penyimpanan diblokir tidak boleh mematikan halaman", () => {
    /*
     * Skrip ini jalan di `<head>`, sebelum apa pun tergambar. Lemparan di situ
     * menghentikan penguraian dokumen: bukan sidebar yang rusak, melainkan
     * SELURUH halaman jadi kosong. Mode privat sebagian peramban melempar pada
     * `localStorage.getItem`.
     */
    expect(SKRIP_PRA_LUKIS).toContain("try{");
    expect(SKRIP_PRA_LUKIS).toContain("catch");
  });

  it("hanya MEMASANG atribut, tidak pernah melepasnya", () => {
    // Halaman selalu mulai tanpa atribut; skrip cuma perlu memasangnya saat
    // memang diringkas. Melepas atribut di sini berarti menulis ke DOM tanpa
    // sebab pada setiap muat halaman.
    expect(SKRIP_PRA_LUKIS).toContain("setAttribute");
    expect(SKRIP_PRA_LUKIS).not.toContain("removeAttribute");
  });

  it("berupa IIFE – tidak meninggalkan nama apa pun di global", () => {
    expect(SKRIP_PRA_LUKIS.trim().startsWith("(function()")).toBe(true);
    expect(SKRIP_PRA_LUKIS.trim().endsWith("})();")).toBe(true);
  });
});
