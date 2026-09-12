// BATAS HEAP V8 DIHITUNG DARI UKURAN KONTAINER, BUKAN DIBIARKAN DITEBAK V8.
//
// Pertanyaan user 2026-09-12: *"lalu error server itu karena apa, karena itu
// sering terjadi"* — soal *"An unexpected response was received from the
// server"* yang muncul saat mengimpor RAB.
//
// Sebabnya sudah pernah tercatat dengan log crashnya (DECISIONS 297): prosesnya
// MATI kehabisan heap. Yang belum pernah dikerjakan adalah membereskan sebabnya
// — V8 memilih sendiri batas old-space dari ukuran kontainer dan berhenti di
// ~256 MB pada kontainer 512 MB, menyisakan separuh RAM tidak terpakai.
// Sementara itu satu kali pratinjau impor memakan +44…57 MB heap (diukur atas
// berkas MC-0 2,8 MB). Kadang muat, kadang tidak — itulah kenapa kegagalannya
// terasa acak.
//
// Yang diuji di sini HITUNGANNYA, bukan pemasangannya. Batas yang salah hitung
// lebih buruk daripada tidak ada batas: kebesaran sedikit, yang membunuh bukan
// lagi V8 (yang masih sempat menulis log) melainkan OOM-killer (yang tidak
// menulis apa pun).
import { describe, expect, it } from "vitest";

const { batasKontainerMb, hitungBatasHeapMb } = await import("../../scripts/batas-heap.mjs");

const baca = (isi: Record<string, string>) => (p: string) => {
  if (!(p in isi)) throw new Error("ENOENT");
  return isi[p]!;
};

describe("batas heap mengikuti ukuran kontainer", () => {
  it("kontainer 512 MB → 352 MB, naik dari ~256 MB bawaan V8", () => {
    // 512 × 0,7 = 358,4 → dibulatkan ke bawah kelipatan 16 = 352.
    expect(hitungBatasHeapMb(512)).toBe(352);
  });

  it("menyisakan ruang untuk yang TIDAK dihitung heap", () => {
    // sharp/libvips, buffer soket, dan runtime Node hidup di luar heap. Batas
    // yang memakan seluruh RAM kontainer memindahkan kematian ke OOM-killer.
    for (const mb of [512, 1024, 2048]) {
      expect(hitungBatasHeapMb(mb)!).toBeLessThan(mb * 0.8);
    }
  });

  it("kontainer kecil → null, biar V8 yang memutuskan", () => {
    // Memaksa batas pada kontainer sempit hanya memindahkan masalahnya.
    expect(hitungBatasHeapMb(256)).toBeNull();
    expect(hitungBatasHeapMb(null)).toBeNull();
  });

  it("cgroup v2 dibaca; \"max\" berarti tanpa batas, bukan nol", () => {
    expect(batasKontainerMb(baca({ "/sys/fs/cgroup/memory.max": "536870912" }))).toBe(512);
    expect(batasKontainerMb(baca({ "/sys/fs/cgroup/memory.max": "max" }))).toBeNull();
  });

  it("cgroup v1 dipakai bila v2 tidak ada", () => {
    expect(
      batasKontainerMb(baca({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "1073741824" })),
    ).toBe(1024);
  });

  it("angka raksasa cgroup v1 = TANPA batas, bukan kontainer sebesar petabyte", () => {
    // Mesin tanpa batas menulis 9223372036854771712 di berkas itu. Dibaca apa
    // adanya, hitungannya menghasilkan batas heap yang mustahil.
    expect(
      batasKontainerMb(baca({ "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712" })),
    ).toBeNull();
  });

  it("berkas tidak ada sama sekali → null, tanpa melempar", () => {
    expect(batasKontainerMb(baca({}))).toBeNull();
  });
});
