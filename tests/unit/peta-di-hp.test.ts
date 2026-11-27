// PETA DI LAYAR HP — legenda tidak menutupi, dan halaman peta tidak dua panel.
//
// Teguran user 2026-09-06: *"peta di dashboard di tampilan mobile jadi seperti
// tidak berguna karena tertutup legend. begitu pula halaman peta, memang
// sepertinya tidak cocok di mobile"*.
//
// Dua-duanya cacat rancangan yang sama: tata letak dibuat untuk layar lebar
// lalu diserahkan apa adanya ke layar 390px.
//
//   - Legenda 15rem menumpang peta selebar ±20rem = separuh peta tertutup.
//   - Daftar 300px di samping peta menyisakan ±170px untuk petanya.
//
// Yang dijaga di sini keputusannya, sebab keduanya mudah hilang saat orang
// "merapikan" kelas Tailwind — dan hilangnya tidak kelihatan di layar lebar,
// satu-satunya tempat kebanyakan orang memeriksanya.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baca = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const dasborPeta = baca("src/app/(app)/aktivitas/dashboard-map.tsx");
const petaKlien = baca("src/app/(app)/peta/peta-client.tsx");

describe("legenda peta dasbor", () => {
  /*
   * Sejak DECISIONS 799 legenda TIDAK PERNAH menumpang peta, di ukuran layar
   * mana pun. Teguran user 2026-11-27: *"keterangan itu menutupi informasi
   * utamanya"* – kotak legenda di pojok kiri-bawah layar lebar menutupi titik
   * Jawa–Bali. Dulu (2026-09-06) hanya HP yang dibebaskan.
   */
  it("tidak ada kotak legenda yang menumpang peta", () => {
    expect(dasborPeta).not.toMatch(/absolute[^"]*"[^>]*>\s*<Legenda/);
    expect(dasborPeta.match(/<Legenda \/>/g) ?? []).toHaveLength(1);
  });

  it("legenda berada DI BAWAH kotak peta, untuk semua ukuran layar", () => {
    const kotakPeta = dasborPeta.indexOf('className="relative min-h-[300px] flex-1');
    const tutupKotak = dasborPeta.indexOf("</div>", dasborPeta.indexOf("<PetaMap", kotakPeta));
    const legenda = dasborPeta.indexOf("<Legenda />");
    expect(kotakPeta).toBeGreaterThan(-1);
    expect(legenda, "legenda harus sesudah kotak peta ditutup").toBeGreaterThan(tutupKotak);
    // Tidak ada lagi versi "khusus HP" / "khusus layar lebar".
    expect(dasborPeta).not.toContain("sm:hidden");
  });

  it("peta dasbor tidak lebih pendek dari 300px", () => {
    // Peta setinggi 200px di HP sudah bukan peta, cuma pita bergambar.
    expect(dasborPeta).toContain("min-h-[300px] flex-1");
  });
});

describe("halaman peta di HP", () => {
  it("satu panel dengan tombol pindah, dua panel baru mulai md", () => {
    expect(petaKlien).toContain('className="mb-2 flex gap-1 md:hidden"');
    // Daftar dan peta saling menyembunyikan di bawah md…
    expect(petaKlien).toContain('tampil === "daftar" ? "flex" : "hidden"');
    expect(petaKlien).toContain('tampil === "peta" ? "block" : "hidden"');
    // …dan keduanya tampil bersisian mulai md.
    expect(petaKlien).toContain("md:flex md:w-[300px]");
  });

  it("memilih lokasi dari daftar memindahkan tampilan ke peta", () => {
    // Tanpa ini ketukan di daftar seolah tidak berbuat apa-apa: peta terbang ke
    // lokasi yang sedang tidak terlihat.
    const fn = /async function select\(id: string\) \{([\s\S]*?)\n {2}\}/.exec(petaKlien)?.[1] ?? "";
    expect(fn).toContain('pindah("peta")');
    // …dan pindah() juga menggulir panelnya ke layar: di HP yang berubah ada di
    // bawah banner + judul, jadi tanpa gulir ketukannya terasa mati.
    expect(petaKlien).toContain("panel.current?.scrollIntoView(");
  });

  it("tingginya pecahan layar di HP, bukan rumus sisa layar", () => {
    // `100dvh − sekian rem` mengandaikan tinggi yang di atasnya tetap; di HP
    // banner PWA + judul membungkus dan petanya terpotong bilah menu bawah.
    expect(petaKlien).toContain("h-[65dvh]");
    expect(petaKlien).toContain("md:h-[calc(100dvh-14.5rem)]");
  });
});
