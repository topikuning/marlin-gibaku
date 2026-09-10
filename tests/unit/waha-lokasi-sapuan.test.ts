// NAMA LOKASI YANG JELAS TERTULIS TIDAK BOLEH LENYAP.
//
// Dilaporkan user 2026-09-10 dengan tangkapan layar WhatsApp. Tiga pertanyaan
// berturut-turut — *"bagaimana muarareja?"*, *"Muarareja aja kamu gak paham"*,
// *"lokasi muarareja"* — dijawab kalimat yang sama persis:
//
//   "Scope 77 lokasi melebihi batas 75 lokasi per analisis.
//    Persempit scope, atau naikkan batasnya di Sistem → AI."
//
// Dua hal salah sekaligus, dan yang kedua lebih buruk:
//
// 1. Pembaca niat tidak memasukkan "muarareja" ke `lokasiDisebut`, jadi
//    lingkupnya jatuh ke SELURUH katalog — 77 lokasi.
// 2. Balasannya lalu menyuruh penanya "persempit scope", padahal ia SUDAH
//    menyebut satu lokasi. Perintah yang tidak mungkin dituruti, tiga kali.
//
// Perbaikannya tidak boleh bergantung pada pembaca niat jadi lebih pintar:
// sebelum melebar ke seluruh katalog, teks aslinya disapu sekali lagi dengan
// pencocok yang SAMA — deterministik, tanpa AI.
import { describe, expect, it } from "vitest";
import { lokasiDariNiatAtauTeks } from "@/lib/waha/parser-niat";
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

function lokasi(nama: string, desa = nama, kabupaten = "Tegal"): LokasiKatalog {
  return { id: `id-${nama.toLowerCase().replace(/\s/g, "-")}`, nama, desa, kecamatan: null, kabupaten, provinsi: "Jawa Tengah" };
}

const KATALOG: LokasiKatalog[] = [
  lokasi("Muarareja"),
  lokasi("Randuputih", "Randuputih", "Probolinggo"),
  lokasi("Kedung Mutih", "Kedung Mutih", "Demak"),
];

describe("nama lokasi disapu dari teks saat pembaca niat melewatkannya", () => {
  it("'bagaimana muarareja?' menyempit ke satu lokasi, bukan seluruh katalog", () => {
    const h = lokasiDariNiatAtauTeks([], "bagaimana muarareja?", KATALOG);
    expect(h.cocok.map((l) => l.nama)).toEqual(["Muarareja"]);
  });

  it("'lokasi muarareja' juga – kata 'lokasi' tidak mengacaukan sapuan", () => {
    const h = lokasiDariNiatAtauTeks([], "lokasi muarareja", KATALOG);
    expect(h.cocok.map((l) => l.nama)).toEqual(["Muarareja"]);
  });

  it("ejaan berspasi tetap kena – 'muara reja' sama dengan 'Muarareja'", () => {
    const h = lokasiDariNiatAtauTeks([], "muara reja ada kendala?", KATALOG);
    expect(h.cocok.map((l) => l.nama)).toEqual(["Muarareja"]);
  });

  it("yang dibaca pembaca niat TETAP menang – sapuan hanya cadangan", () => {
    const h = lokasiDariNiatAtauTeks(["Randuputih"], "bagaimana muarareja?", KATALOG);
    expect(h.cocok.map((l) => l.nama)).toEqual(["Randuputih"]);
  });

  it("nama disebut tapi tidak dikenal tetap dilaporkan, bukan ditelan sapuan", () => {
    // Kalau penanya menulis nama yang salah, ia harus diberi tahu — bukan
    // diam-diam dijawab untuk lokasi lain yang kebetulan tersapu.
    const h = lokasiDariNiatAtauTeks(["Muarareya"], "bagaimana muarareya?", KATALOG);
    expect(h.cocok).toEqual([]);
    expect(h.tidakDikenal).toEqual(["Muarareya"]);
  });

  it("pertanyaan tanpa nama lokasi tetap berlingkup seluruh katalog", () => {
    const h = lokasiDariNiatAtauTeks([], "progress hari ini bagaimana", KATALOG);
    expect(h.cocok).toEqual([]);
  });

  it("sapuan tidak mengarang 'tidak dikenal' dari kata biasa", () => {
    // `frasaSisa` mengembalikan potongan kalimat, bukan nama yang diketik
    // penanya. Melaporkannya sebagai lokasi tak dikenal berarti mengeluh soal
    // kata yang tidak pernah dimaksudkan sebagai lokasi.
    const h = lokasiDariNiatAtauTeks([], "kenapa lambat sekali ya", KATALOG);
    expect(h.tidakDikenal).toEqual([]);
  });
});
