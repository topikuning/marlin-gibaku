// PENCARIAN LOKASI DI PENUGASAN PENGGUNA (permintaan user 2026-09-06):
// *"searchnya juga harusnya bisa kabupaten atau perusahaan, jangan saklek nama
// desa/lokasi."*
//
// Yang dijaga: kotak cari menerima kata yang MEMANG diingat orang — kabupaten,
// provinsi, perusahaan, paket — bukan hanya nama desa. Dan mengetik lebih
// banyak kata selalu MENYEMPITKAN hasil; kalau tidak, "centang semua" pada
// hasil saringan jadi berbahaya.
import { describe, expect, it } from "vitest";
import { cocokLokasi } from "@/lib/master/cari-lokasi";

const BAJO = {
  name: "Bajo Pulau",
  company: "CV. Kalembo Ade Nautama",
  area: "Bajo Pulau, Sape, Bima, Nusa Tenggara Barat",
  extra: "Paket KNMP NTB 2",
};
const BANGGI = {
  name: "Pasar Banggi",
  company: "PT. Sendang Dakara Nusantara",
  area: "Pasar Banggi, Rembang, Rembang, Jawa Tengah",
  extra: "Paket KNMP Jateng 1",
};

describe("kata yang diterima", () => {
  it("nama lokasi", () => {
    expect(cocokLokasi(BANGGI, "banggi")).toBe(true);
    expect(cocokLokasi(BAJO, "banggi")).toBe(false);
  });

  it("kabupaten dan provinsi – bukan hanya nama desa", () => {
    expect(cocokLokasi(BANGGI, "rembang")).toBe(true);
    expect(cocokLokasi(BANGGI, "jawa tengah")).toBe(true);
    expect(cocokLokasi(BAJO, "rembang")).toBe(false);
    expect(cocokLokasi(BAJO, "bima")).toBe(true);
  });

  it("nama perusahaan", () => {
    expect(cocokLokasi(BAJO, "kalembo")).toBe(true);
    expect(cocokLokasi(BANGGI, "kalembo")).toBe(false);
  });

  it("nama paket, walau tidak ditampilkan", () => {
    expect(cocokLokasi(BAJO, "ntb")).toBe(true);
  });

  it("tanpa peduli huruf besar-kecil", () => {
    expect(cocokLokasi(BANGGI, "REMBANG")).toBe(true);
  });
});

describe("banyak kata", () => {
  it("MENYEMPITKAN, bukan melebarkan – dasar keamanan 'centang semua'", () => {
    expect(cocokLokasi(BANGGI, "rembang sendang")).toBe(true);
    // "rembang" cocok, "kalembo" tidak → barisnya TIDAK boleh ikut tersaring
    // masuk, karena tombol centang semua bekerja tepat pada hasil ini.
    expect(cocokLokasi(BANGGI, "rembang kalembo")).toBe(false);
  });

  it("kueri kosong = semua lokasi", () => {
    expect(cocokLokasi(BANGGI, "")).toBe(true);
    expect(cocokLokasi(BANGGI, "   ")).toBe(true);
  });

  it("lokasi tanpa keterangan tambahan tidak membuatnya jatuh", () => {
    expect(cocokLokasi({ name: "Lokasi Sepi" }, "sepi")).toBe(true);
    expect(cocokLokasi({ name: "Lokasi Sepi" }, "rembang")).toBe(false);
  });
});
