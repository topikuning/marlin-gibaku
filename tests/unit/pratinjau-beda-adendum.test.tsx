import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelBeda } from "@/app/(app)/lokasi/[slug]/rab/import/panel-beda";
import type { BedaPratinjau } from "@/app/(app)/lokasi/[slug]/rab/import/actions";

/**
 * PRATINJAU ADENDUM TIDAK BOLEH MEMOTONG DAFTAR PERBEDAAN.
 *
 * Keluhan user 2026-09-03: *"+31 lainnya, ini kan konyol; tujuan pratinjau itu
 * kan lihat apa-apa yang berbeda, kalau tidak bisa apa gunanya. ini soal
 * adendum, harus jelas semua agar ketahuan."*
 *
 * Panel lama mencetak delapan baris teratas lalu menutupnya dengan "+31
 * lainnya" — kalimat yang menyebut ada sesuatu tapi tidak menyediakan satu pun
 * cara melihatnya. Datanya sendiri sudah lengkap sampai ke klien; hanya
 * penyajiannya yang buntu.
 *
 * Batas uji ini: repo belum punya alat uji DOM, jadi yang diperiksa adalah
 * markup awal — bahwa jalan menuju daftar penuh ADA dan jumlahnya disebut
 * jujur, bukan bahwa ketukannya benar-benar membuka. Yang dulu rusak justru
 * ada di lapisan ini: tidak ada apa pun untuk diketuk.
 */

function hargaBerubah(n: number): BedaPratinjau["hargaBerubah"] {
  return Array.from({ length: n }, (_, i) => ({
    lineageKey: `L${i}`,
    code: `${i + 1}`,
    jalur: `II · ${i + 1}`,
    name: `Pekerjaan ${i + 1}`,
    namaLama: `Pekerjaan ${i + 1}`,
    dari: 100_000,
    ke: 90_000,
    dampakRupiah: "-1000000",
  }));
}

function beda(over: Partial<BedaPratinjau> = {}): BedaPratinjau {
  return {
    totalAktif: "1000000000",
    totalBaru: "900000000",
    jumlahTetap: 10,
    itemBaru: [],
    itemHilang: [],
    volumeBerubah: [],
    hargaBerubah: [],
    nilaiBergeser: [],
    ...over,
  };
}

const render = (b: BedaPratinjau) => renderToStaticMarkup(<PanelBeda beda={b} />);

describe("pratinjau beda impor RAB", () => {
  it("39 harga berubah: menyediakan jalan ke SELURUH daftar, bukan buntu '+31 lainnya'", () => {
    const html = render(beda({ hargaBerubah: hargaBerubah(39) }));
    expect(html).not.toContain("lainnya");
    expect(html).toContain("Lihat semua 39 item");
    // Jumlah yang belum tampil disebut apa adanya, bukan disamarkan.
    expect(html).toContain("31 belum tampil");
  });

  it("daftar pendek tidak diberi tombol buka – tidak ada yang disembunyikan", () => {
    const html = render(beda({ hargaBerubah: hargaBerubah(3) }));
    expect(html).not.toContain("Lihat semua");
    expect(html).toContain("Pekerjaan 3");
  });

  it("item baru, volume berubah, dan item hilang punya rinciannya sendiri – bukan cuma angka", () => {
    const html = render(
      beda({
        itemBaru: [{ code: "9", jalur: "IV · 9", name: "Pekerjaan Tambahan" }],
        itemHilang: [{ code: "4", jalur: "III · 4", name: "Pekerjaan Dihapus", realisasi: 0 }],
        volumeBerubah: [
          {
            code: "2",
            jalur: "II · 2",
            name: "Galian Tanah",
            dari: 100,
            ke: 80,
            realisasi: 0,
            dibawahRealisasi: false,
          },
        ],
      }),
    );
    expect(html).toContain("Pekerjaan Tambahan");
    expect(html).toContain("Pekerjaan Dihapus");
    expect(html).toContain("Galian Tanah");
  });

  /*
   * Keluhan user 2026-09-05: *"2.d, 2.e itu yang mana, ada banyak kategori di
   * sini, seharusnya sekalian sebutkan parentnya, misal II 2.d"*. Panel harus
   * MENCETAK jalur itu; menghitungnya di server tapi membuang di layar sama
   * saja dengan tidak memperbaikinya.
   */
  it("kode item dicetak beserta kategorinya", () => {
    const html = render(
      beda({
        volumeBerubah: [
          { code: "2.d", jalur: "II · 2.d", name: "Pekerjaan beton", dari: 7.84, ke: 9.8, realisasi: 0, dibawahRealisasi: false },
        ],
      }),
    );
    expect(html).toContain("II · 2.d");
  });

  it("volume yang turun di bawah realisasi tetap ditandai bahaya di daftar lengkapnya", () => {
    const html = render(
      beda({
        volumeBerubah: [
          { code: "2", jalur: "II · 2", name: "Galian Tanah", dari: 100, ke: 10, realisasi: 40, dibawahRealisasi: true },
        ],
      }),
    );
    expect(html).toContain("di bawah realisasi");
    expect(html).toContain("sudah dikerjakan 40");
  });
});
