import { describe, expect, it } from "vitest";
import { cocokkanKurvaDenganRab, jadwalAcuanIkutRab, type BarisKurva, type KategoriRab } from "@/lib/scurve/kurva-vs-rab";

/*
 * BARIS KURVA-S vs RAB AKTIF (DECISIONS 794). Kasus BUYAT TENGAH, Kurva S
 * minggu ke-10: Tambatan Perahu 0 di RAB aktif (dinolkan CCO) tetapi 29,83% di
 * jadwal; kategori bayangan parser lama ("judul tidak ada di file") tercetak
 * berbobot 0; Genset & Revetment di RAB aktif tetapi tanpa jadwal.
 */
const b = (lineageKey: string, name: string, weekly: number[]): BarisKurva => ({ lineageKey, code: lineageKey, name, weekly });
const k = (lineageKey: string, name: string, amount: bigint): KategoriRab => ({ lineageKey, code: lineageKey, name, amount });

const RAB = [
  k("I", "PEKERJAAN PERSIAPAN", 276n),
  k("III", "PEKERJAAN TAMBATAN PERAHU", 0n),
  k("IV", "PEKERJAAN DINDING PENAHAN TANAH", 1005n),
  k("XII#2", "PEKERJAAN BANGUNAN GENSET", 265n),
];
const JADWAL = [
  b("I", "PEKERJAAN PERSIAPAN", [3, 3.39]),
  b("III", "PEKERJAAN TAMBATAN PERAHU", [10, 19.83]),
  b("IV", "PEKERJAAN DINDING PENAHAN TANAH", [30, 33.78]),
  b("XII#2", "PEKERJAAN BANGUNAN GENSET", [0, 0]),
  b("III#2", "PEKERJAAN (kategori III – judul tidak ada di file)", [0, 0]),
];

describe("cocokkanKurvaDenganRab", () => {
  it("baris bayangan berbobot 0 yang tidak ada di RAB aktif tidak ditampilkan", () => {
    const r = cocokkanKurvaDenganRab(JADWAL, RAB);
    expect(r.tampil.map((x) => x.lineageKey)).toEqual(["I", "III", "IV", "XII#2"]);
  });

  it("pekerjaan bernilai 0 di RAB yang masih berbobot tetap tampil – dan dilaporkan", () => {
    const r = cocokkanKurvaDenganRab(JADWAL, RAB);
    expect(r.takSesuai?.tanpaRab).toEqual([{ name: "PEKERJAAN TAMBATAN PERAHU", bobot: 29.83 }]);
  });

  it("pekerjaan RAB aktif tanpa jadwal tetap tampil (0,00) – dan dilaporkan dengan bobot RAB-nya", () => {
    const r = cocokkanKurvaDenganRab(JADWAL, RAB);
    expect(r.takSesuai?.tanpaJadwal).toEqual([{ code: "XII#2", name: "PEKERJAAN BANGUNAN GENSET", bobotRab: 17.14 }]);
  });

  it("sesudah jadwal CCO dipakai (Tambatan 0): Tambatan ikut hilang, tidak ada yang dilaporkan", () => {
    const cco = [
      b("I", "PEKERJAAN PERSIAPAN", [3, 3.39]),
      b("III", "PEKERJAAN TAMBATAN PERAHU", [0, 0]),
      b("IV", "PEKERJAAN DINDING PENAHAN TANAH", [40, 40]),
      b("XII#2", "PEKERJAAN BANGUNAN GENSET", [6, 7.61]),
    ];
    const r = cocokkanKurvaDenganRab(cco, RAB);
    expect(r.tampil.map((x) => x.lineageKey)).toEqual(["I", "IV", "XII#2"]);
    expect(r.takSesuai).toBeNull();
  });
});

/*
 * "Simpan kurva manual" sesudah CCO (DECISIONS 795). Keluhan user 2026-11-26:
 * penyesuaian halus %-mingguan tidak mengubah kategori/item ke RAB baru – baru
 * berubah sesudah "Hitung ulang" lalu disimpan manual lagi.
 */
describe("jadwalAcuanIkutRab", () => {
  const LAMA = [
    { lineageKey: "I", name: "PEKERJAAN PERSIAPAN", weekly: [5, 5, 0, 0] },
    { lineageKey: "III", name: "PEKERJAAN TAMBATAN PERAHU", weekly: [0, 15, 15, 0] },
    { lineageKey: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", weekly: [0, 10, 20, 30] },
    { lineageKey: "III#2", name: "PEKERJAAN (kategori III – judul tidak ada di file)", weekly: [0, 0, 0, 0] },
  ];
  const RAB_CCO = [
    { lineageKey: "I", name: "PEKERJAAN PERSIAPAN", amount: 20n },
    { lineageKey: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", amount: 60n },
    { lineageKey: "XII#2", name: "PEKERJAAN BANGUNAN GENSET", amount: 20n },
  ];

  it("baris = kategori RAB aktif bernilai, bobot = porsi RAB; yang hilang keluar, yang baru masuk", () => {
    const r = jadwalAcuanIkutRab(LAMA, RAB_CCO, 4);
    expect(r.rows.map((x) => [x.lineageKey, Math.round(x.weekly.reduce((s, v) => s + v, 0) * 1000) / 1000])).toEqual([
      ["I", 20],
      ["IV", 60],
      ["XII#2", 20],
    ]);
    expect(r.keluar).toEqual(["PEKERJAAN TAMBATAN PERAHU"]);
    expect(r.masuk).toEqual(["PEKERJAAN BANGUNAN GENSET"]);
  });

  it("pekerjaan lama tetap memakai BENTUK waktunya (diskalakan ke bobot RAB)", () => {
    const r = jadwalAcuanIkutRab(LAMA, RAB_CCO, 4);
    const iv = r.rows.find((x) => x.lineageKey === "IV")!.weekly;
    expect(iv.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 10, 20, 30]);
    const i = r.rows.find((x) => x.lineageKey === "I")!.weekly;
    expect(i.map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 10, 0, 0]);
  });

  it("pekerjaan baru mendapat jendela otomatis yang berbobot", () => {
    const r = jadwalAcuanIkutRab(LAMA, RAB_CCO, 4);
    const g = r.rows.find((x) => x.lineageKey === "XII#2")!.weekly;
    expect(g).toHaveLength(4);
    expect(g.some((v) => v > 0)).toBe(true);
  });
});
