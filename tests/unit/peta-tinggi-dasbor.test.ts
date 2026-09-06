// TINGGI PETA DASBOR = SETINGGI KARTU DI SEBELAHNYA.
//
// Ketetapan user 2026-09-06: *"tampilan kembali seimbangkan dengan card
// sampingnya, meskipun memanjang"*.
//
// Ini pembalikan percobaan sebelumnya di hari yang sama. Memotong tinggi peta
// (`h-[340px]` + `items-start`) memang memendekkan halaman, tapi menyisakan
// kartu "Status Submit" menjulang sendirian di sebelahnya — dan yang dipilih
// user keseimbangan barisnya, bukan panjangnya. Dijaga di sini supaya
// "perapian" berikutnya tidak diam-diam memotongnya lagi.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dasbor = readFileSync(
  new URL("../../src/app/(app)/aktivitas/executive-dashboard.tsx", import.meta.url),
  "utf8",
);

describe("kotak peta di dasbor", () => {
  it("baris PETA meregangkan kedua kartu – tanpa items-start", () => {
    // Diperiksa pada baris petanya saja, bukan seluruh berkas: baris lain
    // (Activity Centre) memang memakai `items-start` dan tidak ada urusannya
    // dengan keluhan ini.
    const baris = /<div className="(grid[^"]*lg:grid-cols-3)">\s*<Card className="flex flex-col lg:col-span-2">/.exec(
      dasbor,
    );
    expect(baris, "baris kartu peta tidak ketemu").not.toBeNull();
    expect(baris?.[1]).not.toContain("items-start");
  });

  it("kotak petanya mengisi sisa tinggi kartu, bukan tinggi pasti", () => {
    const kotak = /<div className="([^"]+)">\s*<DashboardMap/.exec(dasbor);
    expect(kotak, "kotak <DashboardMap> tidak ketemu").not.toBeNull();
    expect(kotak?.[1]).toContain("flex-1");
    expect(kotak?.[1]).not.toMatch(/(^|\s)h-\[/);
  });
});
