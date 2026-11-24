// EDITOR %-MINGGUAN IKUT ADENDUM WAKTU (DECISIONS 775).
//
// Keluhan user 2026-11-24 (tangkapan "Penyesuaian halus %-mingguan"): *"cco
// waktu sudah aktif, kenapa ini tidak menyesuaikan, … waktu di adendum sudah
// 23 minggu, tapi inputan ini cuma 20 minggu"*. Editor membuka sebanyak titik
// baseline aktif (20), jadi tempelan 23 nilai terpotong "3 nilai terakhir
// dibuang". Barisnya kini mengikuti jumlah minggu kontrak yang BERLAKU.
import { describe, expect, it } from "vitest";
import { titikUntukEditor } from "@/lib/scurve/titik-editor";

describe("titikUntukEditor", () => {
  it("kasus user: baseline 20 titik, kontrak 23 minggu → 23 baris, 3 ditambahkan dengan nilai terakhir", () => {
    const lama = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
    const h = titikUntukEditor(lama, 23);
    expect(h.titik).toHaveLength(23);
    expect(h.titik.slice(0, 20)).toEqual(lama);
    expect(h.titik.slice(20)).toEqual([100, 100, 100]);
    expect(h.tambahan).toBe(3);
  });

  it("jumlah sama → tidak berubah", () => {
    expect(titikUntukEditor([0, 50, 100], 3)).toEqual({ titik: [0, 50, 100], tambahan: 0 });
  });

  it("kontrak lebih pendek dari baseline → titik TIDAK dibuang (diputuskan orang, bukan editor)", () => {
    expect(titikUntukEditor([0, 40, 80, 100], 3)).toEqual({ titik: [0, 40, 80, 100], tambahan: 0 });
  });

  it("baseline kosong → tidak menambah apa pun", () => {
    expect(titikUntukEditor([], 5)).toEqual({ titik: [], tambahan: 0 });
  });
});
