/*
 * PROFIL KURVA-S — bentuk bawaan "awal lambat" dan pewarpan jadwal kategori.
 *
 * Permintaan user 2026-09-19: kurva bawaan saat RAB diimpor harus mengikuti
 * rasio 1 → 3 → 6 → 11 → 18 → 28 → 40 → 54 → 68 → 80 → 89 → 94 → 97 → 99 → 100,
 * *"karena dalam 3 minggu, bahkan kalau bisa 4 minggu pertama, itu banyak tidak
 * ada kegiatan karena persiapan dan bisa jadi di lapangan lahan bermasalah"*.
 *
 * Yang diuji di sini justru bagian yang paling mudah salah: penskalaan rasio 15
 * titik ke jumlah minggu BERAPA PUN, dan penjaminan bahwa mewarp jadwal tidak
 * merusak satu pun invarian kurva (monoton, tuntas 100, bobot kategori utuh).
 */
import { describe, expect, it } from "vitest";
import {
  ANCHOR_LAMBAT,
  kurvaProfilLambat,
  warpKeProfil,
  type ProfilKurva,
} from "@/lib/scurve/profil";
import { validateBaselinePoints } from "@/lib/scurve/generate";

const jumlah = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const kumulatif = (xs: number[]) => xs.map(((s) => (v: number) => (s += v))(0));

describe("profil lambat: rasio user diikuti apa adanya pada 15 minggu", () => {
  it("15 minggu = persis daftar yang diminta", () => {
    expect(kurvaProfilLambat(15)).toEqual([...ANCHOR_LAMBAT]);
  });

  it("selalu lolos penjaga baseline: monoton, 0–100, tuntas 100", () => {
    for (const n of [1, 2, 3, 4, 7, 12, 15, 18, 22, 30, 52]) {
      expect(validateBaselinePoints(kurvaProfilLambat(n))).toBeNull();
    }
  });

  it("minggu terakhir TEPAT 100, bukan 99,98 yang lolos toleransi", () => {
    for (const n of [8, 15, 18, 26]) {
      const k = kurvaProfilLambat(n);
      expect(k[k.length - 1]).toBe(100);
    }
  });
});

describe("awal yang lambat – itu seluruh alasan profil ini ada", () => {
  /*
   * Angka pembanding diambil dari maksud user: sepertiga pertama masa kontrak
   * masih di bawah 20%, dan empat minggu pertama kontrak 18 minggu masih di
   * bawah 10%. Kalau suatu saat rasionya diubah, uji ini yang pertama merah —
   * dan memang harus, karena yang berubah bukan detail teknis melainkan janji
   * ke lapangan.
   */
  it("18 minggu: empat minggu pertama di bawah 10%", () => {
    const k = kurvaProfilLambat(18);
    expect(k[3]).toBeLessThan(10);
    expect(k[0]).toBeLessThan(2);
  });

  it("sepertiga pertama masa kontrak masih di bawah 20%", () => {
    for (const n of [12, 18, 24, 30]) {
      const k = kurvaProfilLambat(n);
      expect(k[Math.ceil(n / 3) - 1]).toBeLessThan(20);
    }
  });

  it("naik paling curam di tengah, bukan di awal – bentuk S, bukan garis lurus", () => {
    const k = kurvaProfilLambat(18);
    const inc = k.map((v, i) => v - (k[i - 1] ?? 0));
    const awal = jumlah(inc.slice(0, 6));
    const tengah = jumlah(inc.slice(6, 12));
    const akhir = jumlah(inc.slice(12));
    expect(tengah).toBeGreaterThan(awal);
    expect(tengah).toBeGreaterThan(akhir);
  });

  it("lebih lambat daripada garis lurus di SELURUH paruh pertama", () => {
    const n = 18;
    const k = kurvaProfilLambat(n);
    for (let i = 0; i < Math.floor(n / 2); i++) {
      expect(k[i]).toBeLessThan(((i + 1) / n) * 100);
    }
  });
});

describe("grid minggu tak seragam (M1 pendek, DECISIONS 427b) dihormati", () => {
  it("M1 dua hari menanggung porsi lebih kecil daripada M1 tujuh hari", () => {
    // Kontrak 18 minggu; M1 hanya 2 dari 7 hari → fraksi hari yang lebih kecil.
    const seragam = kurvaProfilLambat(18);
    const fr: number[] = [];
    const totalHari = 2 + 17 * 7;
    let hari = 2;
    for (let i = 0; i < 18; i++) {
      fr.push(hari / totalHari);
      hari += 7;
    }
    const pendek = kurvaProfilLambat(18, fr);
    expect(pendek[0]).toBeLessThan(seragam[0]);
    expect(validateBaselinePoints(pendek)).toBeNull();
  });
});

describe("warpKeProfil: jadwal kategori mengikuti profil TANPA kehilangan apa pun", () => {
  /** Tiga kategori dengan bobot berbeda jauh, urutan lapangan berbeda. */
  const rows = () => [
    // Persiapan 10% – selesai awal.
    [4, 4, 2, 0, 0, 0, 0, 0],
    // Struktur 60% – tengah.
    [0, 5, 10, 15, 15, 10, 5, 0],
    // Finishing 30% – akhir.
    [0, 0, 0, 2, 5, 8, 10, 5],
  ];

  it("agregatnya menjadi PERSIS profil yang diminta", () => {
    const target = kurvaProfilLambat(8);
    const warp = warpKeProfil(rows(), target);
    const agg = kumulatif(warp[0].map((_, i) => jumlah(warp.map((r) => r[i]))));
    agg.forEach((v, i) => expect(v).toBeCloseTo(target[i], 6));
  });

  it("bobot tiap kategori tidak berubah sepeser pun", () => {
    const warp = warpKeProfil(rows(), kurvaProfilLambat(8));
    rows().forEach((asli, i) => expect(jumlah(warp[i])).toBeCloseTo(jumlah(asli), 6));
  });

  it("tidak ada kategori yang mundur (increment negatif)", () => {
    const warp = warpKeProfil(rows(), kurvaProfilLambat(8));
    for (const r of warp) for (const v of r) expect(v).toBeGreaterThanOrEqual(-1e-9);
  });

  it("urutan lapangan tetap: yang selesai duluan tetap selesai duluan", () => {
    const warp = warpKeProfil(rows(), kurvaProfilLambat(8));
    const selesai = (r: number[]) => {
      const kum = kumulatif(r);
      const total = kum[kum.length - 1];
      return kum.findIndex((v) => v >= total - 1e-9);
    };
    expect(selesai(warp[0])).toBeLessThanOrEqual(selesai(warp[1]));
    expect(selesai(warp[1])).toBeLessThanOrEqual(selesai(warp[2]));
  });

  it("jadwal yang SUDAH lambat pun tetap tuntas 100 sesudah diwarp", () => {
    const target = kurvaProfilLambat(6);
    const warp = warpKeProfil([[0, 0, 0, 10, 40, 50]], target);
    expect(jumlah(warp[0])).toBeCloseTo(100, 6);
    expect(validateBaselinePoints(kumulatif(warp[0]))).toBeNull();
  });

  it("daftar kosong dan kategori nol tidak melempar", () => {
    expect(warpKeProfil([], kurvaProfilLambat(5))).toEqual([]);
    const warp = warpKeProfil([[0, 0, 0]], [10, 50, 100]);
    expect(warp[0]).toHaveLength(3);
    expect(jumlah(warp[0])).toBeCloseTo(0, 9);
  });
});

describe("registri profil", () => {
  it("tiga profil dengan label Indonesia, bawaan = lambat", async () => {
    const { PROFIL_KURVA_LABEL, PROFIL_KURVA_DEFAULT, PROFIL_KURVA } = await import(
      "@/lib/scurve/profil"
    );
    expect(PROFIL_KURVA_DEFAULT).toBe<ProfilKurva>("lambat");
    expect([...PROFIL_KURVA].sort()).toEqual(["lambat", "manual", "optimal"]);
    for (const p of PROFIL_KURVA) {
      expect(PROFIL_KURVA_LABEL[p].length).toBeGreaterThan(3);
    }
  });
});
