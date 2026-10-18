import { describe, expect, it } from "vitest";
import { letakKotakPenunjuk } from "@/components/knmp/scurve-chart-interaktif";

/**
 * KOTAK ANGKA KURVA-S TIDAK BOLEH KELUAR DARI LAYAR YANG TERLIHAT.
 *
 * Keluhan user 2026-10-18 (tangkapan layar HP, Ringkasan lokasi): kotak "Minggu
 * ke-13" keluar dari tepi kanan layar dan menggeser seluruh halaman ke kiri.
 * Sisinya dulu dipilih dengan ambang tetap 290 px; di HP grafiknya ±330 px, jadi
 * minggu di tengah selalu ditaruh di kanan walau ruang kanannya tinggal ±110 px.
 *
 * Disusul *"melebihi layar aktif, peletakan kanan kiri layar yang pas perlu kamu
 * pertimbangkan"*: batasnya adalah LAYAR yang terlihat, bukan hanya kotak
 * grafik. Grafik bisa sebagian di luar layar (halaman tergeser, layar di-zoom),
 * dan kotaknya tetap harus jatuh di bagian yang terlihat.
 *
 * Semua angka dalam px relatif tepi kiri grafik; batas = irisan grafik dengan
 * layar terlihat (dikurangi jarak dari tepi layar).
 */

const JARAK = 8;
const LEBAR_HP = [300, 330, 360];
const LEBAR_KOTAK = [176, 200, 256];

function diDalam(kiri: number, kotak: number, batasKiri: number, batasKanan: number) {
  return kiri >= batasKiri - 0.001 && kiri + kotak <= batasKanan + 0.001;
}

describe("letak kotak angka penunjuk kurva-S", () => {
  it("di lebar HP, kotak selalu di dalam grafik – di minggu mana pun", () => {
    for (const wadah of LEBAR_HP) {
      for (const kotak of LEBAR_KOTAK) {
        for (let x = 0; x <= wadah; x += 5) {
          const kiri = letakKotakPenunjuk(x, kotak, 0, wadah, JARAK);
          expect(diDalam(kiri, kotak, 0, wadah), `wadah ${wadah}, kotak ${kotak}, x ${x}`).toBe(true);
        }
      }
    }
  });

  it("kasus di tangkapan layar: minggu 13/20 di grafik 330 px tidak lagi meluber", () => {
    const x = (13 / 20) * 330;
    const kiri = letakKotakPenunjuk(x, 200, 0, 330, JARAK);
    expect(kiri + 200).toBeLessThanOrEqual(330);
  });

  it("grafik sebagian terpotong di KIRI layar: kotak tetap di bagian yang terlihat", () => {
    // Grafik 330 px, 60 px pertamanya di luar layar kiri (+ jarak 8 px dari tepi).
    const batasKiri = 68;
    for (let x = 0; x <= 330; x += 5) {
      const kiri = letakKotakPenunjuk(x, 200, batasKiri, 330, JARAK);
      expect(diDalam(kiri, 200, batasKiri, 330), `x ${x}`).toBe(true);
    }
  });

  it("grafik sebagian terpotong di KANAN layar: kotak tetap di bagian yang terlihat", () => {
    const batasKanan = 260;
    for (let x = 0; x <= 330; x += 5) {
      const kiri = letakKotakPenunjuk(x, 200, 0, batasKanan, JARAK);
      expect(diDalam(kiri, 200, 0, batasKanan), `x ${x}`).toBe(true);
    }
  });

  it("di kiri garis bila muat – bagian kiri-atas kurva-S hampir selalu kosong", () => {
    expect(letakKotakPenunjuk(600, 200, 0, 800, JARAK)).toBe(600 - JARAK - 200);
  });

  it("di kanan garis bila kiri tidak muat (minggu-minggu awal)", () => {
    expect(letakKotakPenunjuk(60, 200, 0, 800, JARAK)).toBe(60 + JARAK);
  });

  it("bila salah satu sisi muat, kotak tidak menutupi garis penunjuk", () => {
    for (let x = 0; x <= 800; x += 10) {
      const kiri = letakKotakPenunjuk(x, 200, 0, 800, JARAK);
      const menutupi = kiri < x && x < kiri + 200;
      expect(menutupi, `x ${x}`).toBe(false);
    }
  });
});
