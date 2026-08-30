// Layout kolom yang DISIMPAN peramban tidak boleh menyembunyikan kolom yang
// BARU ditambahkan kodenya.
//
// `MarlinGrid` menyimpan `getColumnState()` ke localStorage per `persistKey`,
// lalu memulihkannya dengan `applyColumnState({ applyOrder: true })`. Di dalam
// AG Grid (`orderLiveColsLikeState`), kolom yang TIDAK ada di state tersimpan
// didorong ke UJUNG KANAN daftar — bukan ke posisi yang ditulis kodenya.
//
// Akibatnya nyata dan sudah terjadi: siapa pun yang pernah membuka
// "Kebutuhan & harga" SEBELUM kolom Usulan AI ada membawa layout 8 kolom
// selamanya; ketiga kolom usulan AI mendarat di belakang kolom terakhir, di
// luar tepi gulir. Drafnya masuk tabel, orangnya tidak pernah melihatnya, dan
// tidak ada satu tombol pun yang bisa mengembalikannya.
//
// Sepuluh grid memakai `persistKey`, jadi cacatnya bukan milik RAPL saja.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bacaSimpananKolom, tulisSimpananKolom } from "@/components/grid/column-state";

const s = (colId: string, extra: Record<string, unknown> = {}) => ({ colId, ...extra });

describe("bacaSimpananKolom", () => {
  it("tidak memakai apa pun bila belum pernah disimpan", () => {
    expect(bacaSimpananKolom(null, ["a", "b"])).toBeNull();
  });

  it("tidak memakai simpanan yang rusak", () => {
    expect(bacaSimpananKolom("{bukan json", ["a"])).toBeNull();
    expect(bacaSimpananKolom('{"a":1}', ["a"])).toBeNull();
  });

  it("memakai urutan tersimpan saat kolomnya masih sama persis", () => {
    const raw = JSON.stringify([s("b", { width: 300 }), s("a")]);
    const hasil = bacaSimpananKolom(raw, ["a", "b"]);
    expect(hasil?.applyOrder).toBe(true);
    expect(hasil?.state.map((k) => k.colId)).toEqual(["b", "a"]);
  });

  it("MENOLAK urutan tersimpan begitu kode menambah kolom baru", () => {
    // Persis kasus Usulan AI: simpanan lama tidak mengenal "usulanAiNum".
    const raw = JSON.stringify([s("nama"), s("hargaNum"), s("biayaNum")]);
    const hasil = bacaSimpananKolom(raw, ["nama", "hargaNum", "usulanAiNum", "biayaNum"]);
    expect(hasil).not.toBeNull();
    // Lebar/sortir pengguna tetap dipakai — yang dilepas hanya urutannya,
    // supaya kolom baru mendarat di tempat yang ditulis kodenya.
    expect(hasil?.applyOrder).toBe(false);
    expect(hasil?.state.map((k) => k.colId)).toContain("hargaNum");
  });

  it("tetap memakai urutan tersimpan saat kode MENGHAPUS kolom", () => {
    // Sisa state untuk kolom yang tidak ada lagi diabaikan AG Grid sendiri;
    // tidak ada kolom yang bisa tersembunyi karenanya.
    const raw = JSON.stringify([s("nama"), s("kolomUsang"), s("hargaNum")]);
    const hasil = bacaSimpananKolom(raw, ["nama", "hargaNum"]);
    expect(hasil?.applyOrder).toBe(true);
  });

  it("membuang `pinned` dari simpanan – kunci kolom milik kode", () => {
    const raw = JSON.stringify([s("a", { pinned: null }), s("b", { pinned: "left" })]);
    const hasil = bacaSimpananKolom(raw, ["a", "b"]);
    for (const k of hasil?.state ?? []) expect(k).not.toHaveProperty("pinned");
  });

  it("yang ditulis bisa dibaca kembali", () => {
    const hasil = bacaSimpananKolom(tulisSimpananKolom([s("a", { width: 120 })]), ["a"]);
    expect(hasil?.state[0]?.width).toBe(120);
  });
});

describe("MarlinGrid memakai pendamai itu", () => {
  const sumber = readFileSync("src/components/grid/marlin-grid.tsx", "utf8");

  it("tidak lagi menerapkan urutan tersimpan tanpa syarat", () => {
    expect(sumber).not.toMatch(/applyOrder:\s*true/);
    expect(sumber).toContain("bacaSimpananKolom");
  });

  it("menyediakan jalan pulang bila layoutnya terlanjur kacau", () => {
    expect(sumber).toContain("resetColumnState");
  });
});
