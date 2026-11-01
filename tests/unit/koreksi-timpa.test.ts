import { describe, expect, it } from "vitest";
import type { FlatNode } from "@/lib/rab/flatten";
import { rencanaKoreksiTimpa, type SimpulAktifTimpa } from "@/lib/rab/koreksi-timpa";

/** Perencana koreksi di tempat (DECISIONS 728). */
const aktif = (lineageKey: string, o: Partial<SimpulAktifTimpa> = {}): SimpulAktifTimpa => ({
  id: `id-${lineageKey}`,
  lineageKey,
  parentLineageKey: lineageKey.includes("#") ? lineageKey.slice(0, lineageKey.lastIndexOf("#")) : null,
  kind: lineageKey.includes("#") ? "item" : "kategori",
  code: lineageKey.split("#").at(-1)!,
  name: `Nama ${lineageKey}`,
  unit: lineageKey.includes("#") ? "m3" : null,
  volume: lineageKey.includes("#") ? 10 : null,
  unitPrice: lineageKey.includes("#") ? 1000 : null,
  amount: 10_000n,
  sortOrder: 0,
  ...o,
});
const baru = (a: SimpulAktifTimpa, o: Partial<FlatNode> = {}): FlatNode => ({
  kind: a.kind as FlatNode["kind"],
  code: a.code,
  name: a.name,
  volume: a.volume,
  unit: a.unit,
  unitPrice: a.unitPrice,
  amount: a.amount,
  lineageKey: a.lineageKey,
  parentLineageKey: a.parentLineageKey,
  sortOrder: a.sortOrder,
  excelRow: null,
  ...o,
});

describe("rencanaKoreksiTimpa", () => {
  const I = aktif("I");
  const a = aktif("I#1");
  const b = aktif("I#2");
  const c = aktif("I#3");

  it("isi sama: tidak ada yang diubah", () => {
    const r = rencanaKoreksiTimpa([I, a, b], [baru(I), baru(a), baru(b)]);
    expect(r.ubah).toEqual([]);
    expect(r.tambah).toEqual([]);
    expect(r.hapus).toEqual([]);
  });

  it("volume, harga, jumlah berubah di node yang SAMA (id tetap); baris baru & hilang terpisah", () => {
    const r = rencanaKoreksiTimpa(
      [I, a, b, c],
      [
        baru(I),
        baru(a, { volume: 12, amount: 12_000n }),
        baru(b, { unitPrice: 1500, amount: 15_000n }),
        { ...baru(c), lineageKey: "I#4", code: "4" },
      ],
    );
    expect(r.ubah.map((u) => [u.id, Boolean(u.volume), Boolean(u.unitPrice), Boolean(u.amount)])).toEqual([
      ["id-I#1", true, false, true],
      ["id-I#2", false, true, true],
    ]);
    expect(r.tambah.map((n) => n.lineageKey)).toEqual(["I#4"]);
    expect(r.hapus.map((h) => h.id)).toEqual(["id-I#3"]);
    expect(r.ringkas).toEqual({ volume: 1, harga: 1, jumlah: 0, pindah: 0, lain: 0, tambah: 1, hapus: 1 });
  });

  it("selisih di bawah presisi simpan bukan perubahan", () => {
    const r = rencanaKoreksiTimpa([I, a], [baru(I), baru(a, { volume: 10.0004, unitPrice: 1000.004 })]);
    expect(r.ubah).toEqual([]);
  });

  it("item yang jadi judul ditandai – laporan harian tidak boleh menempel di judul", () => {
    const r = rencanaKoreksiTimpa([I, a], [baru(I), baru(a, { kind: "grup" })]);
    expect(r.jadiJudul).toEqual([{ id: "id-I#1", label: "1 Nama I#1" }]);
  });

  it("pindah kelompok dan nomor/nama dihitung terpisah dari angka", () => {
    const II = aktif("II");
    const r = rencanaKoreksiTimpa([I, II, a, b], [baru(I), baru(II), baru(a, { parentLineageKey: "II" }), baru(b, { name: "Baru" })]);
    expect(r.ringkas).toMatchObject({ pindah: 1, lain: 1 });
  });
});
