// ANGKA GABUNGAN SELURUH PAKET di laporan mingguan WA (DECISIONS 311).
//
// Permintaan user 2026-08-12: *"perlu info global juga. jadi dari semua lokasi
// atas paket itu berapa persen progress dan deviasinya"*.
//
// Ini bagian paling mudah salah dari seluruh fitur, dan salahnya tidak
// kelihatan: rata-rata BIASA dan rata-rata TERTIMBANG sama-sama menghasilkan
// angka yang masuk akal. Bedanya baru terasa ketika lokasi-lokasinya berbeda
// nilai kontrak — dan di KNMP itu lumrah. Angka yang salah di sini masuk ke
// grup PPK sebagai posisi resmi paket.
import { describe, expect, it, vi } from "vitest";

// `kirim.ts` menarik `db` → `env.ts`, yang menolak jalan tanpa konfigurasi.
// Uji ini tidak menyentuh database sama sekali; env-nya cuma syarat impor.
process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_test";

vi.mock("server-only", () => ({}));

const { rekapPaket } = await import("@/lib/mingguan/kirim");

type P = Parameters<typeof rekapPaket>[0][number];

/** Lokasi secukupnya — hanya field yang dipakai rekap yang berarti. */
function lokasi(grandTotal: bigint, realizedValue: bigint, planPct: number): P {
  return {
    locationId: `l${grandTotal}`,
    grandTotal,
    realizedValue,
    realizedPct: grandTotal > 0n ? (Number(realizedValue) / Number(grandTotal)) * 100 : 0,
    planPct,
    deviationPct: 0,
    weekNumber: 3,
    totalWeeks: 20,
    activeRevisionId: null,
    activeBaselineId: null,
  };
}

describe("rata-rata TERTIMBANG nilai kontrak, bukan rata-rata biasa", () => {
  // Besar: Rp 9 M, rencana 10%, terpasang Rp 0,9 M (10%).
  // Kecil: Rp 1 M, rencana 50%, terpasang Rp 0,5 M (50%).
  const besar = lokasi(9_000_000_000n, 900_000_000n, 10);
  const kecil = lokasi(1_000_000_000n, 500_000_000n, 50);

  it("target paket condong ke lokasi yang nilainya besar", () => {
    // Rata-rata biasa: (10 + 50) / 2 = 30% — jauh dari kenyataan.
    // Tertimbang: (10×9 + 50×1) / 10 = 14%.
    const r = rekapPaket([besar, kecil], 0)!;
    expect(r.targetPct).toBeCloseTo(14, 6);
    expect(r.targetPct).not.toBeCloseTo(30, 1);
  });

  it("realisasi paket = total terpasang ÷ total nilai kontrak", () => {
    // (0,9 M + 0,5 M) / 10 M = 14%. Rata-rata biasa juga 30% di sini.
    const r = rekapPaket([besar, kecil], 0)!;
    expect(r.realisasiPct).toBeCloseTo(14, 6);
  });

  it("deviasi paket = selisih dua angka tertimbang, BUKAN rata-rata deviasi", () => {
    // Keduanya angka yang berbeda. Di contoh ini deviasi per lokasi 0 dan 0,
    // jadi rata-rata deviasi = 0 — kebetulan sama. Yang diuji: rumusnya memang
    // realisasi−target, sehingga tetap benar saat keduanya TIDAK sama.
    const timpang = rekapPaket([besar, lokasi(1_000_000_000n, 0n, 50)], 0)!;
    expect(timpang.deviasiPct).toBeCloseTo(timpang.realisasiPct - timpang.targetPct, 9);
    expect(timpang.deviasiPct).toBeCloseTo(9 - 14, 6);
  });
});

describe("lokasi tanpa kurva-S", () => {
  it("jumlahnya dibawa, supaya cakupannya bisa disebut di pesan", () => {
    const r = rekapPaket([lokasi(1_000_000_000n, 100_000_000n, 10)], 2)!;
    expect(r.lokasiDihitung).toBe(1);
    expect(r.lokasiTanpaKurva).toBe(2);
  });

  it("paket yang SEMUA lokasinya belum berkurva tidak menghasilkan rekap", () => {
    // Nol dari nol bukan 0% — ia tidak diketahui. Mencetaknya sebagai 0%
    // membuat paket terbaca "belum jalan sama sekali" padahal yang belum ada
    // justru rencananya.
    expect(rekapPaket([], 3)).toBeNull();
  });
});

describe("pembagian nol", () => {
  it("nilai kontrak nol tidak meledak jadi NaN di pesan WA", () => {
    const r = rekapPaket([lokasi(0n, 0n, 0)], 0)!;
    expect(Number.isFinite(r.targetPct)).toBe(true);
    expect(Number.isFinite(r.realisasiPct)).toBe(true);
    expect(Number.isFinite(r.deviasiPct)).toBe(true);
  });
});
