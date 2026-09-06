// TINGGI PETA DI DASBOR DIPATOK, TIDAK IKUT TETANGGA.
//
// Teguran user 2026-09-06: *"lalu ini terlalu memanjang ke bawah mapnya"*.
//
// Sebabnya bukan peta itu sendiri, melainkan barisnya: kartu "Status Submit
// Lokasi Hari Ini" di sebelahnya tumbuh mengikuti jumlah lokasi (83 sekarang,
// arsitektur menargetkan 200+), dan selama baris grid meregangkan kedua kartu
// setinggi yang tertinggi, peta ikut molor sampai jauh melewati layar.
//
// Dua hal yang menahannya, dan keduanya mudah hilang tanpa sengaja saat orang
// merapikan kelas Tailwind:
//   1. `items-start` pada barisnya — kartu tidak lagi saling menyamakan tinggi.
//   2. tinggi PASTI pada kotak peta — bukan `flex-1` yang berarti "ambil sisa".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dasbor = readFileSync(
  new URL("../../src/app/(app)/aktivitas/executive-dashboard.tsx", import.meta.url),
  "utf8",
);

describe("kotak peta di dasbor", () => {
  it("barisnya tidak meregangkan kartu – items-start", () => {
    expect(dasbor).toContain('className="grid items-start gap-4 lg:grid-cols-3"');
  });

  it("kotak petanya bertinggi pasti, bukan sisa ruang", () => {
    const kotak = /<div className="(h-\[\d+px\][^"]*)">\s*<DashboardMap/.exec(dasbor);
    expect(kotak, "kotak <DashboardMap> harus memakai tinggi h-[..px]").not.toBeNull();
    expect(kotak?.[1]).not.toContain("flex-1");
  });
});
