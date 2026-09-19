/*
 * SATU LAYAR, DUA ANGKA UNTUK HAL YANG SAMA (produksi 2026-09-19).
 *
 * Header lokasi Tengket menulis "MINGGU BERJALAN 22/22" sementara laporan
 * lengkap di layar yang sama menulis "minggu ke-23, lewat 1 minggu". Keduanya
 * benar menurut fungsinya masing-masing — dan justru itu masalahnya:
 *
 *   `currentWeekNumber` (lib/progress.ts) MENG-CLAMP ke totalWeeks, karena ia
 *     dipakai mencari rencana% pada deret baseline dan indeks tidak boleh
 *     melewati titik terakhir kurva. Clamp itu BENAR di tempatnya.
 *
 *   `mingguKontrak` (lib/mingguan/kirim.ts) tidak meng-clamp, karena ia
 *     menjawab "sudah minggu keberapa sejak SPMK" — pertanyaan yang jawabannya
 *     memang boleh melewati panjang kontrak.
 *
 * Yang salah adalah memakai angka PENCARI RENCANA sebagai angka yang DIBACA
 * orang. Akibatnya header memberi kabar "22/22" — terbaca seperti minggu
 * terakhir yang masih on-schedule — padahal kontraknya sudah habis dan
 * realisasinya 0%. Melewati masa kontrak justru keadaan yang paling perlu
 * terbaca (DECISIONS 592).
 *
 * `weekNumberElapsed` menambahkan angka terbaca itu ke calculation layer tanpa
 * menyentuh `weekNumber`: tidak satu pun rencana%, deviasi, atau baseline yang
 * berubah nilainya — hanya ada satu angka baru yang boleh ditampilkan.
 */
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const { currentWeekNumber, elapsedWeekNumber } = await import("@/lib/progress");
const { mingguKontrak } = await import("@/lib/mingguan/kirim");

const MULAI = new Date("2026-04-15T00:00:00.000Z");
const LEWAT = new Date("2026-09-19T00:00:00.000Z"); // 22 minggu kontrak sudah habis

describe("minggu yang DIBACA orang tidak di-clamp", () => {
  it("melewati akhir kontrak: terbaca 23, bukan 22", () => {
    expect(currentWeekNumber(MULAI, 22, LEWAT)).toBe(22); // pencari rencana, tetap
    expect(elapsedWeekNumber(MULAI, LEWAT)).toBeGreaterThan(22);
  });

  it("angkanya sama persis dengan yang dipakai laporan lengkap", () => {
    // Laporan lengkap memakai `mingguKontrak`. Kalau keduanya berbeda, layar
    // yang sama kembali memuat dua angka — persis cacat yang ditutup di sini.
    for (const mode of ["tujuh_hari", "senin_minggu"] as const) {
      for (const hari of [0, 1, 40, 154, 200]) {
        const kini = new Date(MULAI.getTime() + hari * 24 * 3600 * 1000);
        expect(elapsedWeekNumber(MULAI, kini, mode)).toBe(mingguKontrak(MULAI, kini, mode));
      }
    }
  });

  it("belum mulai tetap 0 – bukan dibulatkan jadi minggu 1 (DECISIONS 202)", () => {
    const sebelum = new Date(MULAI.getTime() - 3 * 24 * 3600 * 1000);
    expect(elapsedWeekNumber(MULAI, sebelum)).toBe(0);
  });

  it("di dalam masa kontrak keduanya sepakat", () => {
    const tengah = new Date(MULAI.getTime() + 40 * 24 * 3600 * 1000);
    expect(elapsedWeekNumber(MULAI, tengah)).toBe(currentWeekNumber(MULAI, 22, tengah));
  });
});
