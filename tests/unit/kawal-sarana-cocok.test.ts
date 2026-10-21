import { describe, expect, it } from "vitest";
import {
  kataSarana,
  kemiripanNama,
  pasangkanSarana,
  type KelompokMarlin,
  type SaranaKawalTampil,
} from "@/lib/kawal/sarana-cocok";

/**
 * PER SARANA Kawal ↔ kelompok RAB MARLIN (DECISIONS 694). Nama sintetis.
 * Usulan dari nama hanya bila tunggal; keputusan orang selalu menang.
 */
const sarana = (kawalItemId: number, nama: string, progresPct: number | null = 40): SaranaKawalTampil => ({
  kawalItemId,
  nama,
  jenis: null,
  bobot: 10,
  progresPct,
});
const kelompok = (kunci: string, name: string, progresPct = 50): KelompokMarlin => ({
  kunci,
  code: kunci,
  name,
  progresPct,
});

describe("kata bermakna nama sarana", () => {
  it("tanpa nomor, romawi, tanda baca, dan kata umum", () => {
    expect([...kataSarana("II. PEKERJAAN PABRIK ES (2 unit)")]).toEqual(["pabrik", "es"]);
    expect([...kataSarana("Pembangunan Balai Pertemuan & Kios")]).toEqual(["balai", "pertemuan", "kios"]);
  });

  it("kemiripan = irisan ÷ gabungan", () => {
    expect(kemiripanNama("Pabrik Es", "PEKERJAAN PABRIK ES")).toBe(1);
    expect(kemiripanNama("Balai Pertemuan", "Balai Nelayan")).toBeCloseTo(1 / 3);
    expect(kemiripanNama("Pabrik Es", "Persiapan")).toBe(0);
    expect(kemiripanNama("", "Pabrik Es")).toBe(0);
  });
});

describe("pasangkan sarana", () => {
  const kel = [kelompok("I", "Pekerjaan Persiapan", 100), kelompok("II", "Pabrik Es", 55), kelompok("III", "Kios Perbekalan", 20)];

  it("usulan dari nama + selisih MARLIN − Kawal; kelompok tanpa padanan disebut", () => {
    const h = pasangkanSarana([sarana(1, "Pabrik Es", 40), sarana(2, "Kios Perbekalan Nelayan", 30)], kel, []);
    expect(h.baris.map((b) => [b.sarana.kawalItemId, b.kelompok?.kunci, b.asal, b.selisihPp])).toEqual([
      [1, "II", "usulan", 15],
      [2, "III", "usulan", -10],
    ]);
    expect(h.kelompokTanpaPasangan.map((k) => k.kunci)).toEqual(["I"]);
  });

  it("nama yang terlalu jauh tidak diusulkan", () => {
    const h = pasangkanSarana([sarana(1, "Cold Storage")], kel, []);
    expect(h.baris[0]).toMatchObject({ kelompok: null, asal: "belum", selisihPp: null });
  });

  it("usulan yang tidak tunggal (seri) tidak dibuat", () => {
    const dua = [kelompok("A", "Gudang Beku"), kelompok("B", "Gudang Beku")];
    expect(pasangkanSarana([sarana(1, "Gudang Beku")], dua, []).baris[0].asal).toBe("belum");
    // Dua sarana berebut satu kelompok dengan skor sama → tidak diusulkan ke mana pun.
    const rebut = pasangkanSarana([sarana(1, "Gudang Beku"), sarana(2, "Gudang Beku")], [kelompok("A", "Gudang Beku")], []);
    expect(rebut.baris.map((b) => b.asal)).toEqual(["belum", "belum"]);
  });

  it("satu kelompok satu usulan: yang paling mirip menang", () => {
    const h = pasangkanSarana(
      [sarana(1, "Kios"), sarana(2, "Kios Perbekalan")],
      [kelompok("III", "Kios Perbekalan")],
      [],
    );
    expect(h.baris.map((b) => [b.sarana.kawalItemId, b.kelompok?.kunci ?? null])).toEqual([
      [1, null],
      [2, "III"],
    ]);
  });

  it("keputusan orang menang atas usulan, dan kelompoknya tidak diusulkan ke sarana lain", () => {
    const h = pasangkanSarana(
      [sarana(1, "Pabrik Es"), sarana(2, "Bangunan Utama")],
      kel,
      [{ kawalItemId: 2, status: "dikonfirmasi", lineageKey: "II" }],
    );
    expect(h.baris.map((b) => [b.sarana.kawalItemId, b.kelompok?.kunci ?? null, b.asal])).toEqual([
      [1, null, "belum"],
      [2, "II", "dikonfirmasi"],
    ]);
  });

  it("orang boleh memasangkan dua sarana Kawal ke satu kelompok", () => {
    const h = pasangkanSarana([sarana(1, "Kios A"), sarana(2, "Kios B")], kel, [
      { kawalItemId: 1, status: "dikonfirmasi", lineageKey: "III" },
      { kawalItemId: 2, status: "dikonfirmasi", lineageKey: "III" },
    ]);
    expect(h.baris.every((b) => b.kelompok?.kunci === "III" && b.asal === "dikonfirmasi")).toBe(true);
  });

  it("tidak ada padanan = tanpa kelompok, tanpa selisih, tanpa usulan", () => {
    const h = pasangkanSarana([sarana(1, "Pabrik Es")], kel, [{ kawalItemId: 1, status: "tidak_ada", lineageKey: null }]);
    expect(h.baris[0]).toMatchObject({ kelompok: null, asal: "tidak_ada", selisihPp: null });
  });

  it("keputusan ke kelompok yang hilang dari RAB aktif disebut, bukan diam-diam diusulkan ulang", () => {
    const h = pasangkanSarana([sarana(1, "Pabrik Es")], kel, [
      { kawalItemId: 1, status: "dikonfirmasi", lineageKey: "IX" },
    ]);
    expect(h.baris[0]).toMatchObject({ kelompok: null, asal: "belum", kelompokHilang: true });
  });

  it("progres Kawal kosong → selisih tidak dihitung", () => {
    expect(pasangkanSarana([sarana(1, "Pabrik Es", null)], kel, []).baris[0].selisihPp).toBeNull();
  });
});
