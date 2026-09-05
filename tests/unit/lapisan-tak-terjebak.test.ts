import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SETIAP LAPISAN LAYAR PENUH LEWAT SATU PINTU.
 *
 * Keluhan user 2026-09-05: *"tumpang tindih semua"*. Sebabnya bukan satu
 * layar yang salah, melainkan tujuh lapisan `fixed inset-0` yang masing-masing
 * memilih angka z sendiri (40, 50, 60, 1200, 2000) dan tak satu pun keluar
 * dari kurungan leluhurnya. Selama tiap lapisan menetapkan aturannya sendiri,
 * yang berikutnya akan salah lagi dengan cara yang sama.
 *
 * Uji ini menutup jalan itu: lapisan baru harus lewat `Lapisan`. Yang TIDAK
 * bisa — karena isinya ikut terkirim sebagai bagian sebuah `<form>`, dan
 * portal akan memutus keterikatan itu — disebutkan di sini beserta alasannya,
 * supaya menjadi keputusan yang tercatat, bukan kelalaian yang lolos.
 */

const AKAR = "src";

/** Lapisan yang SENGAJA tidak di-portal, beserta alasannya. */
const DIKECUALIKAN: Record<string, string> = {
  "src/components/ui/confirm-dialog.tsx":
    "tombolnya memakai e.currentTarget.form?.requestSubmit(); portal memutus ikatan ke form-nya",
  "src/components/ui/drawer.tsx": "isinya bisa memuat kendali milik form di layar pemanggil",
  "src/components/knmp/photo-source-input.tsx": "lembar pilihan foto berada DI DALAM form laporan",
  "src/app/(app)/lokasi/[slug]/harian/[date]/report-editor.tsx":
    "lembar foto/kantong berada DI DALAM form laporan harian",
};

function berkasTsx(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const jalur = join(dir, nama);
    if (statSync(jalur).isDirectory()) {
      if (nama === "generated") continue;
      berkasTsx(jalur, keluar);
    } else if (nama.endsWith(".tsx")) {
      keluar.push(jalur);
    }
  }
  return keluar;
}

/** Komentar dibuang: yang dilarang MERENDER-nya, bukan menyebutnya. */
function tanpaKomentar(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("lapisan layar penuh", () => {
  it("tidak ada `fixed inset-0` baru di luar `Lapisan` dan daftar pengecualian", () => {
    const pelanggar: string[] = [];
    for (const berkas of berkasTsx(AKAR)) {
      const jalur = berkas.split("\\").join("/");
      if (jalur === "src/components/ui/lapisan.tsx" || jalur in DIKECUALIKAN) continue;
      if (/fixed\s+inset-0/.test(tanpaKomentar(readFileSync(berkas, "utf8")))) pelanggar.push(jalur);
    }
    expect(pelanggar).toEqual([]);
  });

  it("setiap pengecualian benar-benar masih ada – daftarnya tidak boleh jadi fosil", () => {
    for (const jalur of Object.keys(DIKECUALIKAN)) {
      expect(/fixed\s+inset-0/.test(readFileSync(jalur, "utf8")), jalur).toBe(true);
    }
  });
});
