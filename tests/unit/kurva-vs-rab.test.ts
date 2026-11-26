import { describe, expect, it } from "vitest";
import { cocokkanKurvaDenganRab, type BarisKurva, type KategoriRab } from "@/lib/scurve/kurva-vs-rab";

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
