// AMBANG DEVIASI HANYA BOLEH ADA DI SATU TEMPAT.
//
// Sebelum ini ambangnya hidup di tiga tempat yang tidak saling tahu:
//   · `DEVIATION_THRESHOLDS` di components/ui/stat-delta.tsx (−1 / −10),
//   · konstanta lokal `KRITIS_THRESHOLD = -10` di lib/dashboard.ts,
//   · literal "< -10 ? danger : < -1 ? warning" yang diketik ulang di
//     halaman progress dan di titik warna dashboard eksekutif — dan yang di
//     dashboard eksekutif memakai `< 0`, bukan `< -1`.
//
// Akibatnya satu lokasi dengan deviasi −0,4 pp tampil HIJAU di tabel progress
// dan AMBER di peta pada layar yang sama. Angka yang saling bertentangan di
// satu produk membuat keduanya berhenti dipercaya.
//
// Uji ini mengunci partisinya, termasuk batas tepatnya — karena yang paling
// mudah bergeser diam-diam saat orang menyalin ulang aturan ini adalah apakah
// perbandingannya `<` atau `<=`.
import { describe, expect, it } from "vitest";
import { AMBANG_DEVIASI, DEVIATION_THRESHOLDS, tingkatDeviasi } from "@/lib/deviasi";
import { deviationTone } from "@/components/ui/stat-delta";

describe("tingkatDeviasi", () => {
  it("menyebut deviasi di bawah -10 pp sebagai kritis", () => {
    expect(tingkatDeviasi(-10.1)).toBe("kritis");
    expect(tingkatDeviasi(-13.8)).toBe("kritis");
  });

  it("tepat di -10 pp BELUM kritis — batasnya eksklusif", () => {
    expect(tingkatDeviasi(-10)).toBe("perhatian");
  });

  it("menyebut -1 s.d. -10 pp sebagai perlu perhatian", () => {
    expect(tingkatDeviasi(-1.1)).toBe("perhatian");
    expect(tingkatDeviasi(-9.9)).toBe("perhatian");
  });

  it("tepat di -1 pp masih aman — zona mati 1 pp disengaja", () => {
    expect(tingkatDeviasi(-1)).toBe("aman");
  });

  it("meleset sedikit (mis. -0,3 pp) TIDAK dianggap perlu perhatian", () => {
    // Ini perubahan yang disengaja dari perilaku lama `< 0`: selisih
    // pembulatan tidak boleh mendapat bobot visual yang sama dengan lokasi
    // yang benar-benar tertinggal 9 pp.
    expect(tingkatDeviasi(-0.3)).toBe("aman");
  });

  it("deviasi positif dan nol aman", () => {
    expect(tingkatDeviasi(0)).toBe("aman");
    expect(tingkatDeviasi(4.2)).toBe("aman");
  });
});

describe("sumber ambang tunggal", () => {
  it("alias lama DEVIATION_THRESHOLDS memakai angka yang sama persis", () => {
    expect(DEVIATION_THRESHOLDS.onTrack).toBe(AMBANG_DEVIASI.perhatian);
    expect(DEVIATION_THRESHOLDS.warning).toBe(AMBANG_DEVIASI.kritis);
  });

  it("deviationTone (UI) sepakat dengan tingkatDeviasi (domain) di seluruh partisi", () => {
    const peta = { aman: "success", perhatian: "warning", kritis: "danger" } as const;
    for (const nilai of [5, 0, -0.9, -1, -1.1, -5, -9.9, -10, -10.1, -40]) {
      expect(deviationTone(nilai)).toBe(peta[tingkatDeviasi(nilai)]);
    }
  });
});
