import { describe, expect, it } from "vitest";
import { pisahVolumeNol } from "@/lib/daily-report/volume-nol";
import { barisRealisasiKkp, barisRencanaRealisasi, itemDicetak, type KkpDailyData, type KkpDailyItem } from "@/components/knmp/kkp-daily-report";

/**
 * Baris bervolume 0 (DECISIONS 787). User 2026-11-26: *"ketika volume 0, laporan
 * harian yang dicetak muncul atau tidak? kalau muncul itu berantakan ... bedakan
 * saja yang 0 dengan collapse"*.
 */
const item = (name: string, volumeToday: number, kategori = "PEKERJAAN PERSIAPAN"): KkpDailyItem => ({
  code: "1",
  name,
  unit: "m3",
  categoryCode: "I",
  categoryName: kategori,
  volumeContract: 100,
  volumeBefore: 10,
  volumeToday,
  volumeCumulative: 10 + volumeToday,
  pctCumulative: 10,
});

describe("blanko cetak tidak memuat baris 0", () => {
  it("baris realisasi hanya pekerjaan bervolume; nomornya tidak berlubang", () => {
    const b = barisRealisasiKkp([item("Galian", 5), item("Bedeng", 0), item("Pagar", 2), item("Gudang", 0, "PEKERJAAN LAIN")]);
    expect(b.filter((x) => !x.kategori).map((x) => [x.no, x.text.split(" – ")[0]])).toEqual([
      ["1", "Galian"],
      ["2", "Pagar"],
    ]);
    // Kategori yang isinya hanya baris 0 tidak diberi judul kosong.
    expect(b.some((x) => x.kategori && x.text.includes("PEKERJAAN LAIN"))).toBe(false);
    expect(itemDicetak([item("a", 0.0004), item("b", 0.001)]).map((x) => x.name)).toEqual(["b"]);
  });

  it("baris kosong untuk tulisan tangan melanjutkan nomor pekerjaan yang DICETAK, bukan seluruh baris", () => {
    const d = { items: [item("Galian", 5), item("Bedeng", 0), item("Pagar", 2)], rencana: [] } as unknown as KkpDailyData;
    const rr = barisRencanaRealisasi(d);
    const no = rr.filter((x) => !x.realisasiKategori).map((x) => x.realisasiNo);
    expect(no.slice(0, 4)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("layar: baris 0 dipisah untuk dilipat", () => {
  it("urutan tetap, baris 0 terpisah", () => {
    const { ada, nol } = pisahVolumeNol([{ id: "a", volumeDone: 1 }, { id: "b", volumeDone: 0 }, { id: "c", volumeDone: 0.5 }]);
    expect(ada.map((x) => x.id)).toEqual(["a", "c"]);
    expect(nol.map((x) => x.id)).toEqual(["b"]);
  });
});
