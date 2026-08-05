import { describe, expect, it } from "vitest";
import {
  AREA_KOREKSI,
  ARTI_AREA_KOREKSI,
  LABEL_AREA_KOREKSI,
} from "@/lib/daily-report/area-koreksi";

/**
 * Area koreksi dibaca MANDOR di lapangan, jadi dua hal harus dijaga: setiap
 * nilai punya label dan keterangan berbahasa Indonesia, dan daftarnya tetap
 * pendek. Daftar panjang tidak membuat reviewer lebih teliti — ia membuat semua
 * orang memilih "Lainnya", dan fitur ini kehilangan seluruh gunanya.
 */
describe("area koreksi laporan harian", () => {
  it("setiap area punya label & keterangan yang tidak kosong", () => {
    for (const a of AREA_KOREKSI) {
      expect(LABEL_AREA_KOREKSI[a]?.trim(), `label kosong: ${a}`).toBeTruthy();
      expect(ARTI_AREA_KOREKSI[a]?.trim(), `keterangan kosong: ${a}`).toBeTruthy();
    }
  });

  it("tidak ada nilai ganda", () => {
    expect(new Set(AREA_KOREKSI).size).toBe(AREA_KOREKSI.length);
  });

  it("daftarnya tetap pendek dan memuat penampung 'lainnya'", () => {
    expect(AREA_KOREKSI.length).toBeLessThanOrEqual(8);
    // Tanpa penampung, reviewer yang masalahnya tidak masuk kategori mana pun
    // terpaksa memilih kategori yang SALAH — lebih buruk daripada tidak memilih.
    expect(AREA_KOREKSI).toContain("lainnya");
  });

  it("label tidak memakai istilah database", () => {
    // "daily_report", "node", "item.volume" dst. tidak berarti apa-apa bagi
    // pembacanya; ini pagar terhadap label yang disalin dari nama kolom.
    for (const a of AREA_KOREKSI) {
      expect(LABEL_AREA_KOREKSI[a]).not.toMatch(/_|daily|report|node|rab_/i);
    }
  });
});
