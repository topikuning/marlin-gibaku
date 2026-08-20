import { describe, expect, it } from "vitest";
import { can } from "@/lib/authz";
import { KAPABILITAS_ADAPTER, rupiahKeAngka } from "@/lib/ai-hub/adapters-pagar";

/**
 * PAGAR KAPABILITAS adapter sumber (DECISIONS 379) — bagian yang MURNI.
 *
 * Yang dijaga di sini bukan implementasinya, melainkan **premisnya**: bahwa
 * peran yang boleh bertanya ke AI tidak otomatis boleh melihat uang. Kalau
 * suatu hari `site_manager` diberi `finance.view`, atau `ai.ask` dicabut dari
 * peran yang tidak punya `finance.view`, seluruh alasan pagar ini berubah — dan
 * uji ini yang memberi tahu, bukan kejadian di lapangan.
 */

describe("premis pagar: bertanya ke AI ≠ boleh melihat uang", () => {
  it("site_manager boleh ai.ask TAPI tidak boleh finance.view", () => {
    /*
     * Inilah lubangnya kalau fakta keuangan disuntikkan ke setiap prompt:
     * Site Manager bisa menanyakan — dan menerima — angka uang yang di layar
     * MARLIN sendiri tidak boleh ia lihat. Tidak ada galat; ia hanya menjawab
     * dengan sopan.
     */
    expect(can("site_manager", "ai.ask")).toBe(true);
    expect(can("site_manager", "finance.view")).toBe(false);
  });

  it("wakil_ppk memang dijauhkan dari uang internal pelaksana", () => {
    // Keputusan bertulis di authz.ts. Pintu AI tidak boleh membatalkannya.
    expect(can("wakil_ppk", "finance.view")).toBe(false);
  });

  it("peran yang berhak tetap menerimanya", () => {
    expect(can("project_manager", "finance.view")).toBe(true);
    expect(can("exec_viewer", "finance.view")).toBe(true);
  });
});

describe("tiap wilayah adapter menyebut kapabilitasnya sendiri", () => {
  it("keuangan dipagari finance.view – bukan sekadar scope lokasi", () => {
    expect(KAPABILITAS_ADAPTER.keuangan).toBe("finance.view");
  });

  it("kontrak, RAB, milestone memakai pagar yang sudah berlaku di layar", () => {
    // Pagarnya sengaja SAMA dengan halaman yang menampilkan angka itu; kalau
    // berbeda, AI jadi jalur akses kedua dengan aturan sendiri.
    expect(KAPABILITAS_ADAPTER.kontrak).toBe("package.view");
    expect(KAPABILITAS_ADAPTER.rab).toBe("rab.view");
    expect(KAPABILITAS_ADAPTER.milestone).toBe("package.view");
  });

  it("setiap wilayah punya pagar – tidak ada yang terbuka", () => {
    for (const [wilayah, cap] of Object.entries(KAPABILITAS_ADAPTER)) {
      expect(cap, wilayah).toBeTruthy();
    }
  });
});


describe("rupiah → angka pembanding klaim", () => {
  it("rupiah biasa dibandingkan EKSAK", () => {
    // Uang tidak punya "kira-kira"; nilai kontrak yang meleset seribu rupiah
    // bukan pembulatan tampilan.
    expect(rupiahKeAngka(5_000_000_000n)).toBe(5_000_000_000);
    expect(rupiahKeAngka(0n)).toBe(0);
    expect(rupiahKeAngka(-1_500n)).toBe(-1_500);
  });

  it("nilai di ATAS batas presisi TIDAK diterbitkan", () => {
    /*
     * `Number` kehilangan presisi di atas 2^53−1. Menerbitkan angka yang sudah
     * dibulatkan diam-diam berarti memvalidasi klaim terhadap nilai yang bukan
     * nilai sebenarnya — pagar yang justru meloloskan angka salah.
     *
     * Rp 9.007.199.254.740.991 jauh di atas nilai kontrak mana pun hari ini,
     * tapi batasnya dijaga di sini supaya tetap benar kalau satuannya berubah
     * (mis. rupiah penuh untuk program nasional).
     */
    const batas = BigInt(Number.MAX_SAFE_INTEGER);
    expect(rupiahKeAngka(batas)).toBe(Number.MAX_SAFE_INTEGER);
    expect(rupiahKeAngka(batas + 1n)).toBeNull();
    expect(rupiahKeAngka(-batas - 1n)).toBeNull();
  });
});
