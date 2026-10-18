import { describe, expect, it } from "vitest";
import { letakKotakPenunjuk } from "@/components/knmp/scurve-chart-interaktif";

/**
 * KOTAK ANGKA KURVA-S TIDAK BOLEH KELUAR DARI GRAFIK.
 *
 * Keluhan user 2026-10-18 (tangkapan layar HP, Ringkasan lokasi): kotak "Minggu
 * ke-13" keluar dari tepi kanan layar dan menggeser seluruh halaman ke kiri.
 * Sisinya dulu dipilih dengan ambang tetap 290 px; di HP grafiknya ±330 px, jadi
 * minggu di tengah selalu ditaruh di kanan walau ruang kanannya tinggal ±110 px.
 */

const JARAK = 8;
const LEBAR_HP = [300, 330, 360];
const LEBAR_KOTAK = [176, 200, 256];

describe("letak kotak angka penunjuk kurva-S", () => {
  it("di lebar HP, kotak selalu di dalam grafik – di minggu mana pun", () => {
    for (const wadah of LEBAR_HP) {
      for (const kotak of LEBAR_KOTAK) {
        for (let x = 0; x <= wadah; x += 5) {
          const kiri = letakKotakPenunjuk(x, wadah, kotak, JARAK);
          expect(kiri, `wadah ${wadah}, kotak ${kotak}, x ${x}`).toBeGreaterThanOrEqual(0);
          expect(kiri + kotak, `wadah ${wadah}, kotak ${kotak}, x ${x}`).toBeLessThanOrEqual(wadah);
        }
      }
    }
  });

  it("kasus di tangkapan layar: minggu 13/20 di grafik 330 px tidak lagi meluber", () => {
    const x = (13 / 20) * 330;
    const kiri = letakKotakPenunjuk(x, 330, 200, JARAK);
    expect(kiri + 200).toBeLessThanOrEqual(330);
  });

  it("di kiri garis bila muat – bagian kiri-atas kurva-S hampir selalu kosong", () => {
    expect(letakKotakPenunjuk(600, 800, 200, JARAK)).toBe(600 - JARAK - 200);
  });

  it("di kanan garis bila kiri tidak muat (minggu-minggu awal)", () => {
    expect(letakKotakPenunjuk(60, 800, 200, JARAK)).toBe(60 + JARAK);
  });

  it("bila salah satu sisi muat, kotak tidak menutupi garis penunjuk", () => {
    for (let x = 0; x <= 800; x += 10) {
      const kiri = letakKotakPenunjuk(x, 800, 200, JARAK);
      const menutupi = kiri < x && x < kiri + 200;
      expect(menutupi, `x ${x}`).toBe(false);
    }
  });
});
