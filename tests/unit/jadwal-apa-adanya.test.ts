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
import { cumulativeFromWeeklyRows, validasiKurvaJadwal, validateBaselinePoints } from "@/lib/scurve/generate";

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

describe("penyelarasan ke 100% – seragam, dan dikatakan", () => {
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
  it("bobot pekerjaan yang hasil akhirnya negatif ditolak", () => {
    const negatif = new Map<string, number[]>([
      ["A", [10, 0, 0, 0]],
      ["B", [0, 40, -45, 0]],
      ["C", [0, 0, 60, 35]],
    ]);
    expect(() => susunJadwalApaAdanya(KAT, negatif, 4)).toThrow(/"Struktur".*negatif/);
  });

  it("kumulatif yang lewat 100% di tengah jalan ditolak dengan minggunya", () => {
    const lewat = new Map<string, number[]>([
      ["A", [10, 0, 0, 0]],
      ["B", [0, 90, 10, -10]],
      ["C", [0, 0, 0, 0]],
    ]);
    expect(() => susunJadwalApaAdanya(KAT, lewat, 4)).toThrow(/minggu 3.*110/);
  });

  it("sel yang bukan angka ditolak", () => {
    const rusak = new Map<string, number[]>([["A", [100, Number.NaN, 0, 0]]]);
    expect(() => susunJadwalApaAdanya([KAT[0]], rusak, 4)).toThrow(/"Persiapan" minggu 2/);
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

/*
 * NILAI MINUS SESUDAH CCO (DECISIONS baru 2026-10-07).
 *
 * Keputusan user: *"supaya lebih flexibel mungkin ijinkan saja minus importnya
 * yg penting jumlah totalnya 100%"*. Laporan minggu yang sudah terlapor tidak
 * diubah; perubahan bobot karena CCO diserap minggu-minggu sesudahnya, sehingga
 * satu pekerjaan bisa bernilai minus di minggu tertentu. Angka diambil dari
 * Time Schedule KNMP Sidorejo–Batang minggu ke-10 (Levelling Lahan M12 −0,839,
 * Revetment M10–M11 −0,714).
 */
describe("nilai minus dari penyesuaian CCO", () => {
  const SIDOREJO: KategoriRab[] = [
    { lineageKey: "I", name: "Persiapan", weightRabPct: 15.35 },
    { lineageKey: "II", name: "Revetment", weightRabPct: 9.76 },
    { lineageKey: "XII", name: "Levelling Lahan", weightRabPct: 2.52 },
    { lineageKey: "Z", name: "Sisa pekerjaan", weightRabPct: 72.37 },
  ];
  const w = (pairs: Record<number, number>) => Array.from({ length: 20 }, (_, i) => pairs[i + 1] ?? 0);
  const persiapan = Array.from({ length: 20 }, (_, i) => (i < 9 ? 0.668 : i < 19 ? 0.8499095538309427 : 0.8399095538309465));
  const revetment = w({ 6: 1.299, 7: 3.706, 8: 4.19, 9: 0.38767441664132596, 10: -0.7143255833586739, 11: -0.7143255833586739, 12: 0.560674416641326, 13: 0.21767441664132603, 14: 0.21767441664132603, 15: 0.21767441664132603, 16: 0.21767441664132603, 17: 0.178 });
  const levelling = w({ 6: 1.12, 7: 1.12, 8: 1.12, 12: -0.8390487099370345 });
  const sumOf = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const sisaTotal = 100 - sumOf(persiapan) - sumOf(revetment) - sumOf(levelling);
  // Sisa pekerjaan disebar merata di minggu 9–20 (bentuknya tidak penting di sini).
  const sisa = Array.from({ length: 20 }, (_, i) => (i >= 8 ? sisaTotal / 12 : 0));
  const excel = new Map<string, number[]>([
    ["I", persiapan],
    ["II", revetment],
    ["XII", levelling],
    ["Z", sisa],
  ]);

  it("diterima apa adanya bila totalnya 100%; sel minus tidak diubah", () => {
    const h = susunJadwalApaAdanya(SIDOREJO, excel, 20);
    expect(h.faktorSkala).toBe(1);
    const lev = h.rows.find((r) => r.lineageKey === "XII")!;
    expect(lev.weekly[11]).toBeCloseTo(-0.839049, 6);
    expect(lev.weightPct).toBeCloseTo(2.521, 3);
    expect(h.rows.find((r) => r.lineageKey === "II")!.weekly[9]).toBeCloseTo(-0.714326, 6);
    expect(h.selMinus).toEqual([
      { name: "Revetment", minggu: [10, 11] },
      { name: "Levelling Lahan", minggu: [12] },
    ]);
    const kurva = cumulativeFromWeeklyRows(h.rows.map((r) => r.weekly), 20);
    expect(kurva[19]).toBe(100);
    expect(ringkasApaAdanya(h)).toContain("nilai minus");
  });

  it("pekerjaan yang DICABUT CCO (bobot akhir 0) tetap membawa minggu terlapornya", () => {
    const kat: KategoriRab[] = [
      { lineageKey: "A", name: "Persiapan", weightRabPct: 100 },
      { lineageKey: "D", name: "Dermaga (dicabut)", weightRabPct: 0 },
    ];
    const h = susunJadwalApaAdanya(
      kat,
      new Map([
        ["A", [20, 30, 30, 20]],
        ["D", [5, -5, 0, 0]],
      ]),
      4,
    );
    const d = h.rows.find((r) => r.lineageKey === "D")!;
    expect(d.weekly).toEqual([5, -5, 0, 0]);
    expect(d.weightPct).toBe(0);
    expect(h.tanpaJadwal).not.toContain("Dermaga (dicabut)");
  });

  it("kurva total yang turun di satu minggu diterima dan DISEBUT minggunya", () => {
    const h = susunJadwalApaAdanya(
      KAT,
      new Map([
        ["A", [10, 0, 0, 0]],
        ["B", [0, 50, -8, 28]],
        ["C", [0, 0, 5, 15]],
      ]),
      4,
    );
    expect(h.mingguTurun).toEqual([3]);
    const kurva = cumulativeFromWeeklyRows(h.rows.map((r) => r.weekly), 4);
    expect(kurva).toEqual([10, 60, 57, 100]);
    expect(validasiKurvaJadwal(kurva)).toBeNull();
    expect(validateBaselinePoints(kurva)).toMatch(/turun/); // kurva otomatis/manual tetap wajib naik
    expect(ringkasApaAdanya(h)).toContain("turun di minggu 3");
  });
});
