/*
 * DATA DEMO MENGIKUTI HARI SEED (DECISIONS 639).
 *
 * User 2026-10-01: server dev baru tidak boleh menampilkan SEMUA proyek
 * terlambat. Tanggal seed digeser relatif ke hari seed dijalankan, dan
 * realisasi tiap lokasi diberi deviasi sasaran yang beragam.
 */
import { describe, expect, it } from "vitest";
import {
  ACUAN_TANGGAL_SEED,
  DEVIASI_SASARAN_PP,
  geserTanggalIso,
  hariGeserSeed,
  realisasiSasaranPct,
  volumeUntukSasaran,
} from "@/lib/seed/tanggal-demo";

describe("tanggal data demo", () => {
  it("seed pada tanggal acuan tidak menggeser apa pun", () => {
    expect(hariGeserSeed(new Date(`${ACUAN_TANGGAL_SEED}T10:00:00Z`))).toBe(0);
  });

  it("seed 108 hari sesudah acuan menggeser SPMK & tanggal selesai sejauh itu", () => {
    const geser = hariGeserSeed(new Date("2026-10-01T03:00:00Z"));
    expect(geser).toBe(108);
    expect(geserTanggalIso("2026-04-06", geser)).toBe("2026-07-23");
    expect(geserTanggalIso("2026-09-28", geser)).toBe("2027-01-14");
  });

  it("semua lokasi demo sedang berjalan pada tanggal acuan (mulai lewat, selesai belum)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const berkas = readdirSync("seed-data").filter((f) => f.endsWith(".json") && !f.startsWith("ahsp") && f !== "manifest.json");
    expect(berkas.length).toBeGreaterThan(10);
    for (const f of berkas) {
      const meta = JSON.parse(readFileSync(`seed-data/${f}`, "utf8")).meta as { start_date: string; end_date: string };
      expect(meta.start_date < ACUAN_TANGGAL_SEED, f).toBe(true);
      expect(meta.end_date > ACUAN_TANGGAL_SEED, f).toBe(true);
    }
  });
});

describe("realisasi data demo", () => {
  it("TIDAK semua lokasi terlambat: mayoritas sasaran deviasi ≥ 0, dan ada yang kritis", () => {
    const aman = DEVIASI_SASARAN_PP.filter((d) => d >= 0).length;
    expect(aman).toBeGreaterThan(DEVIASI_SASARAN_PP.length / 2);
    expect(DEVIASI_SASARAN_PP.some((d) => d < -10)).toBe(true);
    expect(DEVIASI_SASARAN_PP.some((d) => d < 0 && d >= -10)).toBe(true);
  });

  it("realisasi sasaran dibatasi 0–100", () => {
    expect(realisasiSasaranPct(5, 5)).toBe(0); // 5 − 13 → 0, bukan negatif
    expect(realisasiSasaranPct(99, 8)).toBe(100);
    expect(realisasiSasaranPct(40, 0)).toBe(41.5);
  });

  it("volume diisi penuh berurutan, item terakhir sebagian, tanpa melampaui sasaran", () => {
    const items = [
      { id: "a", volume: 10, amount: 1_000n },
      { id: "b", volume: 4, amount: 2_000n },
      { id: "c", volume: 5, amount: 5_000n },
    ];
    expect(volumeUntukSasaran(items, 2_000n)).toEqual([
      { id: "a", volume: 10 },
      { id: "b", volume: 2 },
    ]);
    expect(volumeUntukSasaran(items, 0n)).toEqual([]);
  });
});
