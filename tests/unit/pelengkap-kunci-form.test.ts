/*
 * ISIAN YANG BELUM DISIMPAN TIDAK BOLEH HILANG KARENA CUACA DIMUAT ULANG.
 *
 * Laporan user 2026-10-10: *"inputan laporan harian, tenaga kerja yang sudah
 * terisi, ketika diklik muat ulang cuaca semua isian tenaga sebelumnya
 * hilang."*
 *
 * Sebabnya: badan form Pelengkap dipasang ulang setiap kali `key`-nya berubah,
 * dan kategori cuaca ikut di dalam key itu. Tombol cuaca mengubah kategori
 * cuaca → form dipasang ulang → kolom tenaga, jam kerja, catatan yang belum
 * disimpan kembali ke isi basis data. Dibuktikan di peramban: 3,4,5,6 → 0,0,1,0
 * hanya bila kategori cuacanya berubah; bila sama, isian utuh.
 */
import { describe, expect, it } from "vitest";
import { kunciBadanPelengkap } from "@/lib/daily-report/kunci-pelengkap";

type Laporan = Parameters<typeof kunciBadanPelengkap>[0] & { weather: string | null };
const dasar: Laporan = {
  weather: "cerah",
  workStart: "07:30",
  workEnd: "16:30",
  materials: [{ id: "m1" }],
  equipment: [{ id: "a1" }],
};
const ubah = (o: Partial<Laporan>): Laporan => ({ ...dasar, ...o });

describe("kunci pemasangan ulang badan form Pelengkap", () => {
  it("cuaca berubah → kunci TETAP, isian yang belum disimpan tidak hilang", () => {
    expect(kunciBadanPelengkap(ubah({ weather: "hujan_deras" }))).toBe(kunciBadanPelengkap(dasar));
    expect(kunciBadanPelengkap(ubah({ weather: null }))).toBe(kunciBadanPelengkap(dasar));
  });

  it("baris material/alat baru dari server tetap memasang ulang (id baris masuk input tersembunyi, DECISIONS 304)", () => {
    expect(kunciBadanPelengkap(ubah({ materials: [{ id: "m1" }, { id: "m2" }] }))).not.toBe(kunciBadanPelengkap(dasar));
    expect(kunciBadanPelengkap(ubah({ equipment: [] }))).not.toBe(kunciBadanPelengkap(dasar));
  });
});

describe("form Pelengkap memakai kunci ini", () => {
  it("badan form dikunci dengan kunciBadanPelengkap, bukan susunan sendiri yang memuat cuaca", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../src/app/(app)/lokasi/[slug]/harian/[date]/enrichment-form.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain("key={kunciBadanPelengkap(report)}");
    expect(src).not.toMatch(/tandaTangan\s*=\s*\[\s*report\.weather/);
  });
});
