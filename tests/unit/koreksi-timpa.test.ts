import { describe, expect, it } from "vitest";
import type { FlatNode } from "@/lib/rab/flatten";
import { kalimatPindah, rencanaKoreksiTimpa, type SimpulAktifTimpa } from "@/lib/rab/koreksi-timpa";

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

/*
 * SUB-PEKERJAAN YANG HANYA PINDAH KATEGORI (DECISIONS 790).
 *
 * Kasus nyata BUYAT TENGAH 2026-11-26: sub "III.2 Pekerjaan Pasangan Batu"
 * tertulis di bawah kategori IV (salah tulis, seharusnya IV.2). Parser lama
 * membuka kategori III bayangan untuknya; laporan harian sudah masuk ke item
 * di bawahnya. Koreksi dengan berkas yang benar dulu dibaca "item lama
 * dihapus, item baru ditambah" dan DITOLAK karena itemnya sudah dilaporkan.
 */
describe("rencanaKoreksiTimpa – sub yang hanya pindah kategori", () => {
  const n = (
    lineageKey: string,
    parentLineageKey: string | null,
    kind: string,
    code: string,
    name: string,
    unit: string | null = null,
  ): SimpulAktifTimpa => ({
    id: `id-${lineageKey}`,
    lineageKey,
    parentLineageKey,
    kind,
    code,
    name,
    unit,
    volume: kind === "item" ? 5 : null,
    unitPrice: kind === "item" ? 100 : null,
    amount: 500n,
    sortOrder: 0,
  });
  /** Isi sub Pasangan Batu: dua item + satu grup beranak dua item. */
  const isi = (sub: string): SimpulAktifTimpa[] => [
    n(`${sub}#-.a`, sub, "item", "-.a", "Pekerjaan Galian Tanah keras s.d 1 m", "m3"),
    n(`${sub}#-.b`, sub, "item", "-.b", "Pekerjaan Urugan Pasir urug t = 5 cm", "m3"),
    n(`${sub}#6`, sub, "grup", "6", "Pekerjaan Lantai"),
    n(`${sub}#6#6.a`, `${sub}#6`, "item", "6.a", "Pekerjaan Urugan Tanah Urug", "m3"),
    n(`${sub}#6#6.b`, `${sub}#6`, "item", "6.b", "Pekerjaan Urugan Pasir t = 5 cm", "m3"),
  ];
  const IV = n("IV", null, "kategori", "IV", "PEKERJAAN TAMBATAN PERAHU");
  const IV1 = n("IV#IV.1", "IV", "sub", "IV.1", "Pekerjaan Persiapan");
  const IV1a = n("IV#IV.1#a", "IV#IV.1", "item", "a", "Pembersihan", "m2");
  const hantu = n("III#2", null, "kategori", "III", "PEKERJAAN (kategori III – judul tidak ada di file)");
  const subLama = n("III#2#III.2", "III#2", "sub", "III.2", "Pekerjaan Pasangan Batu");
  const AKTIF = [IV, IV1, IV1a, hantu, subLama, ...isi("III#2#III.2")];
  const keBaru = (s: SimpulAktifTimpa): FlatNode => baru(s);
  const BERKAS = [
    IV,
    IV1,
    IV1a,
    { ...subLama, lineageKey: "IV#IV.2", parentLineageKey: "IV", code: "IV.2" },
    ...isi("IV#IV.2"),
  ].map(keBaru);

  it("sub beserta seluruh isinya dipindah DI TEMPAT (id tetap), bukan dihapus lalu ditambah", () => {
    const r = rencanaKoreksiTimpa(AKTIF, BERKAS);
    expect(r.tambah).toEqual([]);
    // Yang hilang hanya kategori bayangan yang kini kosong.
    expect(r.hapus.map((h) => h.id)).toEqual(["id-III#2"]);
    expect(r.pindah.map((p) => [p.id, p.dari, p.ke])).toEqual([
      ["id-III#2#III.2", "III#2#III.2", "IV#IV.2"],
      ["id-III#2#III.2#-.a", "III#2#III.2#-.a", "IV#IV.2#-.a"],
      ["id-III#2#III.2#-.b", "III#2#III.2#-.b", "IV#IV.2#-.b"],
      ["id-III#2#III.2#6", "III#2#III.2#6", "IV#IV.2#6"],
      ["id-III#2#III.2#6#6.a", "III#2#III.2#6#6.a", "IV#IV.2#6#6.a"],
      ["id-III#2#III.2#6#6.b", "III#2#III.2#6#6.b", "IV#IV.2#6#6.b"],
    ]);
    expect(r.pindahAkar).toEqual([
      {
        label: "III.2 Pekerjaan Pasangan Batu",
        labelBaru: "IV.2 Pekerjaan Pasangan Batu",
        indukDari: "III PEKERJAAN (kategori III – judul tidak ada di file)",
        indukKe: "IV PEKERJAAN TAMBATAN PERAHU",
        baris: 6,
      },
    ]);
    // Akar sub: nomor dan induknya berubah; isinya tidak "pindah kelompok".
    const akar = r.ubah.find((u) => u.id === "id-III#2#III.2")!;
    expect(akar.lineageKey).toBe("IV#IV.2");
    expect(akar.code).toEqual({ dari: "III.2", ke: "IV.2" });
    expect(akar.induk).toEqual({ dari: "III#2", ke: "IV" });
    expect(r.ubah.filter((u) => u.id !== "id-III#2#III.2")).toEqual([]);
  });

  it("nomor item ikut berubah: tetap dipindah – nomor bukan identitas pekerjaan", () => {
    const r = rencanaKoreksiTimpa(
      AKTIF,
      BERKAS.map((x) => (x.lineageKey === "IV#IV.2#-.a" ? { ...x, code: "a" } : x)),
    );
    expect(r.pindah).toHaveLength(6);
    expect(r.ubah.find((u) => u.id === "id-III#2#III.2#-.a")?.code).toEqual({ dari: "-.a", ke: "a" });
  });

  it("volume berubah sambil pindah: dipindah, volumenya ikut dikoreksi", () => {
    const r = rencanaKoreksiTimpa(
      AKTIF,
      BERKAS.map((x) => (x.lineageKey === "IV#IV.2#-.b" ? { ...x, volume: 7, amount: 700n } : x)),
    );
    expect(r.pindah).toHaveLength(6);
    expect(r.ubah.find((u) => u.id === "id-III#2#III.2#-.b")?.volume).toEqual({ dari: 5, ke: 7 });
  });

  it("isi berbeda (nama item lain, item kurang/lebih, satuan lain): sub TIDAK dipindah – hapus + tambah seperti biasa", () => {
    const grupSaja = ["III#2#III.2#6", "III#2#III.2#6#6.a", "III#2#III.2#6#6.b"];
    const varian: [FlatNode[], string[]][] = [
      // Grup "Pekerjaan Lantai" yang isinya utuh tetap dikenali di tempat barunya.
      [BERKAS.map((x) => (x.lineageKey === "IV#IV.2#-.b" ? { ...x, name: "Pekerjaan Beton" } : x)), grupSaja],
      [BERKAS.filter((x) => x.lineageKey !== "IV#IV.2#6#6.b"), []],
      [[...BERKAS, keBaru(n("IV#IV.2#-.c", "IV#IV.2", "item", "-.c", "Pekerjaan Geotextile", "m2"))], grupSaja],
      [BERKAS.map((x) => (x.lineageKey === "IV#IV.2#-.a" ? { ...x, unit: "m2" } : x)), grupSaja],
    ];
    for (const [i, [v, dipindah]] of varian.entries()) {
      const r = rencanaKoreksiTimpa(AKTIF, v);
      expect([i, r.pindah.map((p) => p.dari)]).toEqual([i, dipindah]);
      expect(r.hapus.map((h) => h.id)).toContain("id-III#2#III.2#-.a");
    }
  });

  it("ejaan satuan berbeda (m³ vs m3) tetap satuan yang sama", () => {
    const r = rencanaKoreksiTimpa(
      AKTIF,
      BERKAS.map((x) => (x.lineageKey === "IV#IV.2#-.a" ? { ...x, unit: "M³" } : x)),
    );
    expect(r.pindah).toHaveLength(6);
  });

  it("pasangan tidak tunggal (dua sub bernama & berisi sama di berkas): tidak ditebak", () => {
    const kembar = [
      ...BERKAS,
      keBaru(n("IV#IV.3", "IV", "sub", "IV.3", "Pekerjaan Pasangan Batu")),
      ...isi("IV#IV.3").map(keBaru),
    ];
    const r = rencanaKoreksiTimpa(AKTIF, kembar);
    expect(r.pindah).toEqual([]);
  });

  it("satu item yang berdiri sendiri tidak dipindah lintas kategori – sinyalnya terlalu lemah", () => {
    const II = n("II", null, "kategori", "II", "PEKERJAAN LAIN");
    const lepas = n("II#9", "II", "item", "9", "Pekerjaan Galian Tanah", "m3");
    const r = rencanaKoreksiTimpa([IV, II, lepas], [IV, II, { ...lepas, lineageKey: "IV#9", parentLineageKey: "IV" }].map(keBaru));
    expect(r.pindah).toEqual([]);
    expect(r.hapus.map((h) => h.id)).toEqual(["id-II#9"]);
  });

  it("sub yang tidak hilang dari tempatnya tidak disentuh, walau ada sub baru bernama sama", () => {
    const r = rencanaKoreksiTimpa(AKTIF, [
      ...AKTIF.map(keBaru),
      keBaru(n("IV#IV.2", "IV", "sub", "IV.2", "Pekerjaan Pasangan Batu")),
      ...isi("IV#IV.2").map(keBaru),
    ]);
    expect(r.pindah).toEqual([]);
    expect(r.hapus).toEqual([]);
  });
});

/*
 * Pembulatan simpan bukan perubahan (DECISIONS 790). Pratinjau koreksi BUYAT
 * menyebut "8 volume" berubah, mis. "45,313 → 45,313": berkas 45,3125, RAB
 * aktif menyimpan 45,313 (numeric 3 desimal, setengah dibulatkan ke atas).
 */
describe("rencanaKoreksiTimpa – angka dibandingkan sebagaimana disimpan", () => {
  const I = aktif("I");
  it("berkas 45,3125 vs tersimpan 45,313: sama; harga 1.000,005 vs 1.000,01: sama", () => {
    const a = aktif("I#1", { volume: 45.313, unitPrice: 1000.01 });
    const r = rencanaKoreksiTimpa([I, a], [baru(I), baru(a, { volume: 45.3125, unitPrice: 1000.005 })]);
    expect(r.ubah).toEqual([]);
  });

  it("galat hitung Excel: berkas 113,08849999999998 vs tersimpan 113,089: sama", () => {
    const a = aktif("I#1", { volume: 113.089 });
    const r = rencanaKoreksiTimpa([I, a], [baru(I), baru(a, { volume: 113.08849999999998 })]);
    expect(r.ubah).toEqual([]);
  });

  it("berkas 113,0885 vs tersimpan 113,088: berubah (akan tersimpan 113,089)", () => {
    const a = aktif("I#1", { volume: 113.088 });
    const r = rencanaKoreksiTimpa([I, a], [baru(I), baru(a, { volume: 113.0885 })]);
    expect(r.ubah.map((u) => u.volume)).toEqual([{ dari: 113.088, ke: 113.0885 }]);
  });
});

describe("kalimatPindah", () => {
  const p = {
    label: "III.2 Pekerjaan Pasangan Batu",
    labelBaru: "IV.2 Pekerjaan Pasangan Batu",
    indukDari: "III PEKERJAAN",
    indukKe: "IV PEKERJAAN DINDING PENAHAN TANAH",
    baris: 7,
  };
  it("pindah induk: sebut tujuan, nomor baru, dan asalnya", () => {
    expect(kalimatPindah(p)).toBe(
      "III.2 Pekerjaan Pasangan Batu pindah ke IV PEKERJAAN DINDING PENAHAN TANAH sebagai IV.2 Pekerjaan Pasangan Batu (7 baris) – sebelumnya di III PEKERJAAN",
    );
  });
  it("induk sama (nomor kembar): tidak disebut 'pindah' dari tempat ke tempat yang sama", () => {
    expect(
      kalimatPindah({ label: "6 Pekerjaan Lantai", labelBaru: "6 Pekerjaan Lantai", indukDari: "VII.1 Pekerjaan Struktural", indukKe: "VII.1 Pekerjaan Struktural", baris: 6 }),
    ).toBe("6 Pekerjaan Lantai (6 baris) tetap di VII.1 Pekerjaan Struktural – dikenali dari nama dan isinya");
  });
});
