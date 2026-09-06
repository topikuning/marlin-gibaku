// KURVA-S PAKET: GABUNGAN LOKASI, DITIMBANG NILAI RAB.
//
// Keluhan user 2026-09-05 di halaman paket: *"tidak ada informasi kurva S sama
// sekali yang bisa menjelaskan progress keseluruhan lokasi"*. Yang ada cuma
// satu persen agregat — angka itu tidak bisa menjawab "telat atau tidak",
// karena rencananya tidak ada di sebelahnya.
//
// Yang diuji di sini bukan "ada garisnya", melainkan empat keputusan yang
// menentukan apakah kurvanya boleh dipercaya: bobot, lokasi berjadwal pendek,
// realisasi yang tidak boleh turun, dan lokasi yang TIDAK boleh dipaksa masuk.
import { describe, expect, it } from "vitest";
import { gabungKurvaS, type KurvaLokasi } from "@/lib/progress-calc";

const lokasi = (o: Partial<KurvaLokasi> & Pick<KurvaLokasi, "planPct" | "grandTotal">): KurvaLokasi => ({
  totalWeeks: o.planPct.length,
  currentWeek: o.currentWeek ?? o.planPct.length,
  actualPct: o.actualPct ?? o.planPct.map(() => null),
  ...o,
});

describe("bobot mengikuti nilai RAB, bukan jumlah lokasi", () => {
  it("lokasi Rp 900 juta menentukan 90% bentuk kurva, bukan 50%", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [50, 100], actualPct: [50, null], grandTotal: 900_000_000n }),
      lokasi({ planPct: [0, 100], actualPct: [0, null], grandTotal: 100_000_000n }),
    ]);
    expect(k.planPct[0]).toBeCloseTo(45, 6); // 0,9×50 + 0,1×0
    expect(k.actualPct[0]).toBeCloseTo(45, 6);
    expect(k.grandTotal).toBe(1_000_000_000n);
    expect(k.dihitung).toBe(2);
  });
});

describe("lokasi berjadwal lebih pendek", () => {
  it("rencananya diteruskan 100% – itu yang dikatakan jadwalnya", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [100], actualPct: [100], grandTotal: 500_000_000n }), // selesai minggu 1
      lokasi({ planPct: [25, 60, 100], actualPct: [20, null, null], grandTotal: 500_000_000n }),
    ]);
    expect(k.totalWeeks).toBe(3);
    // Minggu 3: 0,5×100 (lokasi pendek, sudah tuntas) + 0,5×100 = 100.
    expect(k.planPct[2]).toBeCloseTo(100, 6);
    // Minggu 2: 0,5×100 + 0,5×60 = 80.
    expect(k.planPct[1]).toBeCloseTo(80, 6);
  });

  it("realisasinya diteruskan mendatar, tidak jatuh ke nol", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [100], actualPct: [80], grandTotal: 500_000_000n }),
      lokasi({ planPct: [25, 60, 100], actualPct: [20, 40, null], grandTotal: 500_000_000n }),
    ]);
    // Minggu 2: lokasi pendek tidak punya angka lagi → 80 diteruskan.
    expect(k.actualPct[1]).toBeCloseTo(0.5 * 80 + 0.5 * 40, 6);
    // Realisasi kumulatif tidak pernah turun.
    const ada = k.actualPct.filter((v): v is number => v != null);
    for (let i = 1; i < ada.length; i++) expect(ada[i]).toBeGreaterThanOrEqual(ada[i - 1]);
  });
});

describe("minggu yang belum punya angka di lokasi mana pun", () => {
  it("garis realisasi BERHENTI, bukan dijatuhkan ke nol", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [30, 70, 100], actualPct: [25, null, null], currentWeek: 1, grandTotal: 1_000_000_000n }),
    ]);
    expect(k.actualPct[0]).toBeCloseTo(25, 6);
    expect(k.actualPct[1]).toBeNull();
    expect(k.actualPct[2]).toBeNull();
  });
});

describe("lokasi yang TIDAK boleh dipaksa masuk", () => {
  it("tanpa baseline: tidak ikut dihitung, dan jumlahnya bisa disebut di layar", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [50, 100], actualPct: [50, null], grandTotal: 1_000_000_000n }),
      { totalWeeks: 0, currentWeek: 1, planPct: [], actualPct: [], grandTotal: 400_000_000n },
    ]);
    expect(k.dihitung).toBe(1);
    // Kalau lokasi tanpa baseline ikut sebagai nol, angka ini akan 35,71 –
    // menuduh pekerjaan yang rencananya belum ada sebagai tertinggal.
    expect(k.planPct[0]).toBeCloseTo(50, 6);
    expect(k.grandTotal).toBe(1_000_000_000n);
  });

  it("tanpa nilai RAB: bobotnya tidak diketahui, jadi tidak ikut", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [50, 100], grandTotal: 1_000_000_000n }),
      lokasi({ planPct: [10, 20], grandTotal: 0n }),
    ]);
    expect(k.dihitung).toBe(1);
    expect(k.planPct[0]).toBeCloseTo(50, 6);
  });

  it("tidak ada satu pun lokasi yang layak → kurva kosong, bukan kurva nol", () => {
    const k = gabungKurvaS([{ totalWeeks: 0, currentWeek: 1, planPct: [], actualPct: [], grandTotal: 0n }]);
    expect(k).toEqual({
      totalWeeks: 0,
      currentWeek: 1,
      planPct: [],
      actualPct: [],
      grandTotal: 0n,
      dihitung: 0,
    });
  });
});

describe("minggu berjalan", () => {
  it("diambil yang terjauh di antara lokasi, dibatasi panjang kurva", () => {
    const k = gabungKurvaS([
      lokasi({ planPct: [50, 100], currentWeek: 2, actualPct: [50, 60], grandTotal: 1_000_000n }),
      lokasi({ planPct: [30, 60, 100], currentWeek: 3, actualPct: [30, 40, 50], grandTotal: 1_000_000n }),
    ]);
    expect(k.currentWeek).toBe(3);
    expect(k.totalWeeks).toBe(3);
  });
});
