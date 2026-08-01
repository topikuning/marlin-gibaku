// Impor jadwal Excel dipakai APA ADANYA (DECISIONS 203).
//
// Permintaan user 2026-08-01: "ini upload manual kamu harus mengikuti, kecuali
// orang tersebut meminta agar disesuaikan dengan sistem dari inputan dia. jadi
// kalau user tidak minta, maka manual yang jadi baselinenya".
import { describe, expect, it } from "vitest";
import {
  TOLERANSI_TOTAL_PP,
  ringkasApaAdanya,
  susunJadwalApaAdanya,
  type KategoriRab,
} from "@/lib/scurve/jadwal-verbatim";
import { cumulativeFromWeeklyRows, validateBaselinePoints } from "@/lib/scurve/generate";

const KAT: KategoriRab[] = [
  { lineageKey: "A", name: "Persiapan", weightRabPct: 5 },
  { lineageKey: "B", name: "Struktur", weightRabPct: 70 },
  { lineageKey: "C", name: "Finishing", weightRabPct: 25 },
];

/** Excel yang totalnya tepat 100 dan tidak sepakat dengan bobot RAB. */
const excelPas = () =>
  new Map<string, number[]>([
    ["A", [10, 0, 0, 0]], // user memberi 10%, RAB bilang 5%
    ["B", [0, 30, 30, 0]], // 60% vs RAB 70%
    ["C", [0, 0, 10, 20]], // 30% vs RAB 25%
  ]);

describe("angka Excel dipakai apa adanya", () => {
  it("bobot tiap pekerjaan = angka Excel, BUKAN bobot RAB", () => {
    const h = susunJadwalApaAdanya(KAT, excelPas(), 4);
    expect(h.rows.map((r) => r.weightPct)).toEqual([10, 60, 30]);
    expect(h.faktorSkala).toBe(1);
    expect(h.cocok).toBe(3);
  });

  it("sel per minggu diteruskan persis, termasuk jeda 0", () => {
    const h = susunJadwalApaAdanya(KAT, excelPas(), 4);
    expect(h.rows[1].weekly).toEqual([0, 30, 30, 0]);
  });

  it("kurva kumulatifnya sah: monoton naik dan tuntas 100%", () => {
    const h = susunJadwalApaAdanya(KAT, excelPas(), 4);
    const kurva = cumulativeFromWeeklyRows(
      h.rows.map((r) => r.weekly),
      4,
    );
    expect(kurva).toEqual([10, 40, 80, 100]);
    expect(validateBaselinePoints(kurva)).toBeNull();
  });

  it("selisih terhadap RAB DILAPORKAN, bukan disembunyikan", () => {
    const h = susunJadwalApaAdanya(KAT, excelPas(), 4);
    expect(h.selisihBobot).toEqual([
      { name: "Persiapan", excel: 10, rab: 5 },
      { name: "Struktur", excel: 60, rab: 70 },
      { name: "Finishing", excel: 30, rab: 25 },
    ]);
    expect(ringkasApaAdanya(h)).toContain("Persiapan 10,00% (RAB 5,00%)");
  });

  it("bobot yang sudah sama dengan RAB tidak dilaporkan sebagai selisih", () => {
    const sama = new Map<string, number[]>([
      ["A", [5, 0, 0, 0]],
      ["B", [0, 35, 35, 0]],
      ["C", [0, 0, 5, 20]],
    ]);
    expect(susunJadwalApaAdanya(KAT, sama, 4).selisihBobot).toEqual([]);
  });
});

describe("penyelarasan ke 100% — seragam, dan dikatakan", () => {
  it("total 99% diskalakan SATU faktor; perbandingan antar-pekerjaan tetap", () => {
    const kurang = new Map<string, number[]>([
      ["A", [9.9, 0, 0, 0]],
      ["B", [0, 29.7, 29.7, 0]],
      ["C", [0, 0, 9.9, 19.8]],
    ]);
    const h = susunJadwalApaAdanya(KAT, kurang, 4);
    expect(h.totalExcel).toBeCloseTo(99, 6);
    expect(h.faktorSkala).toBeCloseTo(100 / 99, 9);
    // Rasio 10 : 60 : 30 dari file dipertahankan persis.
    expect(h.rows.map((r) => r.weightPct)).toEqual([10, 60, 30]);
    expect(ringkasApaAdanya(h)).toContain("diskalakan seragam ke 100%");
  });

  it("jeda tetap jeda setelah diskalakan", () => {
    const kurang = new Map<string, number[]>([
      ["A", [9.9, 0, 0, 0]],
      ["B", [0, 29.7, 0, 29.7]],
      ["C", [0, 0, 0, 29.7]],
    ]);
    const h = susunJadwalApaAdanya(KAT, kurang, 4);
    expect(h.rows[1].weekly[0]).toBe(0);
    expect(h.rows[1].weekly[2]).toBe(0);
  });

  it("selisih di atas toleransi DITOLAK, bukan diperbaiki diam-diam", () => {
    const jauh = new Map<string, number[]>([
      ["A", [10, 0, 0, 0]],
      ["B", [0, 30, 30, 0]],
      // Finishing tidak dijadwalkan → total 70%.
    ]);
    expect(() => susunJadwalApaAdanya(KAT, jauh, 4)).toThrow(/70,00%/);
    expect(() => susunJadwalApaAdanya(KAT, jauh, 4)).toThrow(/Finishing/);
    expect(() => susunJadwalApaAdanya(KAT, jauh, 4)).toThrow(/Sesuaikan bobot ke RAB/);
  });

  it("batas toleransi memang 2 poin persen", () => {
    const na = (t: number) =>
      new Map<string, number[]>([["A", [t, 0, 0, 0]]]);
    expect(TOLERANSI_TOTAL_PP).toBe(2);
    expect(() => susunJadwalApaAdanya([KAT[0]], na(98.1), 4)).not.toThrow();
    expect(() => susunJadwalApaAdanya([KAT[0]], na(97.9), 4)).toThrow();
  });
});

describe("yang tidak bisa diikuti ditolak dengan sebutan barisnya", () => {
  it("nilai negatif ditolak — kurva kumulatif tidak boleh turun", () => {
    const negatif = new Map<string, number[]>([
      ["A", [10, 0, 0, 0]],
      ["B", [0, 40, -5, 25]],
      ["C", [0, 0, 10, 20]],
    ]);
    expect(() => susunJadwalApaAdanya(KAT, negatif, 4)).toThrow(/"Struktur" minggu 3/);
  });

  it("file kosong ditolak dengan alasan yang bisa ditindaklanjuti", () => {
    const kosong = new Map<string, number[]>([["A", [0, 0, 0, 0]]]);
    expect(() => susunJadwalApaAdanya(KAT, kosong, 4)).toThrow(/kosong atau 0/);
  });
});

describe("pekerjaan yang tidak dijadwalkan di Excel", () => {
  it("dibiarkan kosong (tidak diisi otomatis) dan jumlahnya disebut", () => {
    const kat: KategoriRab[] = [
      ...KAT,
      { lineageKey: "D", name: "Lain-lain", weightRabPct: 0.5 },
    ];
    const h = susunJadwalApaAdanya(kat, excelPas(), 4);
    expect(h.tanpaJadwal).toEqual(["Lain-lain"]);
    expect(h.rows[3].weekly).toEqual([0, 0, 0, 0]);
    expect(h.rows[3].weightPct).toBe(0);
    expect(h.cocok).toBe(3);
    expect(ringkasApaAdanya(h)).toContain("1 pekerjaan tanpa jadwal di Excel dibiarkan kosong");
  });

  it("jumlah minggu yang tidak cocok = tidak dianggap terjadwal", () => {
    const kat: KategoriRab[] = [
      ...KAT,
      { lineageKey: "D", name: "Lain-lain", weightRabPct: 0.5 },
    ];
    const pendek = new Map(excelPas());
    pendek.set("D", [0, 0, 1]); // 3 minggu, padahal kontrak 4
    const h = susunJadwalApaAdanya(kat, pendek, 4);
    expect(h.tanpaJadwal).toEqual(["Lain-lain"]);
    expect(h.rows[3].weekly).toEqual([0, 0, 0, 0]);
  });
});
