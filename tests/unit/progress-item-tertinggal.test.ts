import { describe, expect, it } from "vitest";
import { itemPlanFracDariJadwal, laggingItems } from "@/lib/progress-calc";

/**
 * ITEM TERTINGGAL DIBANDINGKAN TERHADAP JADWALNYA SENDIRI (DECISIONS 391).
 *
 * Dilaporkan user 2026-08-20 dari layar produksi:
 *
 * > *"tertinggal / kendala, kenapa ada item penarikan kabel yang mana
 * > pekerjaan ME, padahal ini baru minggu ketiga."*
 *
 * Angkanya membuktikan sendiri rumus lamanya: volume RAB 747,6 m' × rencana
 * kurva-S global 6,4% = 47,8464 – dan itu persis "TARGET S/D MGG INI 47,846"
 * yang tampil di layar. Jadi setiap item dianggap berjalan serentak sejak
 * minggu 1 dengan laju yang sama dengan proyek.
 *
 * Di konstruksi itu tidak pernah benar. Penarikan kabel ME dijadwalkan di
 * ujung pekerjaan; menyebutnya "tertinggal Rp 6,6 jt" pada minggu ke-3
 * menuntut orang mengejar pekerjaan yang justru belum boleh dikerjakan – dan
 * mendorong item yang BENAR-BENAR terlambat turun dari 10 besar.
 */

describe("itemPlanFracDariJadwal", () => {
  // Item ME: baru mulai minggu 8, selesai minggu 10.
  const kabel = [0, 0, 0, 0, 0, 0, 0, 40, 40, 20];
  // Item persiapan: minggu 1–3.
  const pagar = [50, 30, 20, 0, 0, 0, 0, 0, 0, 0];

  it("item yang BELUM dijadwalkan berfraksi 0 pada minggu itu", () => {
    expect(itemPlanFracDariJadwal(kabel, 3)).toBe(0);
  });

  it("item yang sedang berjalan berfraksi kumulatif jadwalnya", () => {
    // s/d minggu 3 = 50+30+20 = 100 dari total 100.
    expect(itemPlanFracDariJadwal(pagar, 3)).toBe(1);
    // s/d minggu 2 = 80 dari 100.
    expect(itemPlanFracDariJadwal(pagar, 2)).toBeCloseTo(0.8, 9);
  });

  it("sesudah item selesai tetap 1, tidak lebih", () => {
    expect(itemPlanFracDariJadwal(kabel, 99)).toBe(1);
  });

  it("jadwal kosong / nol → null, supaya pemanggil yang memutuskan cadangannya", () => {
    // Diam-diam jatuh ke 1 atau ke fraksi global menghasilkan angka yang
    // terlihat sah padahal tidak berdasar.
    expect(itemPlanFracDariJadwal([], 3)).toBeNull();
    expect(itemPlanFracDariJadwal([0, 0, 0], 3)).toBeNull();
  });
});

describe("laggingItems", () => {
  /** Angka asli dari layar produksi yang dilaporkan user. */
  const kabelNyy = {
    lineageKey: "4",
    volK: 747.6,
    amount: 103_000_000,
    volSd: 0,
  };

  it("REGRESI: item ME belum terjadwal TIDAK muncul sebagai tertinggal", () => {
    const hasil = laggingItems([{ ...kabelNyy, planFrac: 0 }]);
    expect(hasil).toEqual([]);
  });

  /*
   * Catatan uji gigi, supaya pembaca berikutnya tidak salah menyimpulkan:
   *
   * Perilaku di atas dijaga DUA mekanisme yang saling menutupi – saringan
   * `planFrac > 0` dan rumus `expected = volK × planFrac` (yang menghasilkan
   * 0, sehingga saringan kekurangan membuangnya juga). Melepas salah satunya
   * saja TIDAK memerahkan uji ini; yang memerah saat rumusnya dirusak adalah
   * uji "rumus LAMA" di bawah.
   *
   * Ditulis apa adanya karena mengaku "uji gigi lolos" untuk keduanya akan
   * berlebihan – yang terbukti load-bearing sendirian baru rumusnya.
   */

  it("rumus LAMA memang menghasilkan 47,846 – bukti diagnosisnya benar", () => {
    /*
     * Bukan menguji perilaku yang diinginkan, melainkan MEREKAM sebabnya:
     * 747,6 × 6,4% = 47,8464, persis angka yang tampil di layar user. Kalau
     * suatu saat ada yang mengembalikan fraksi global ke sini, angka ini yang
     * akan muncul lagi.
     */
    const [it0] = laggingItems([{ ...kabelNyy, planFrac: 0.064 }]);
    expect(it0.expected).toBeCloseTo(47.8464, 4);
  });

  it("item yang SUDAH terjadwal dan memang kurang tetap muncul", () => {
    // Pagar sementara: jadwalnya minggu 1–3, s/d minggu 3 seharusnya 100%.
    const [it0] = laggingItems([
      { lineageKey: "5", volK: 100, amount: 42_000_000, volSd: 25, planFrac: 1 },
    ]);
    expect(it0.expected).toBe(100);
    expect(it0.realized).toBe(25);
    // Kekurangan 75 dari 100 → 75% × nilai item.
    expect(it0.gapValue).toBeCloseTo(31_500_000, 0);
  });

  it("diurut berdasar NILAI kekurangan, bukan volume", () => {
    /*
     * Volume tidak sebanding antar satuan: 50 m' kabel dan 50 m³ beton bukan
     * dua kekurangan yang sama besar. Yang menentukan prioritas nilainya.
     */
    const hasil = laggingItems([
      { lineageKey: "besar-volume", volK: 1000, amount: 1_000_000, volSd: 0, planFrac: 1 },
      { lineageKey: "besar-nilai", volK: 10, amount: 900_000_000, volSd: 0, planFrac: 1 },
    ]);
    expect(hasil.map((h) => h.lineageKey)).toEqual(["besar-nilai", "besar-volume"]);
  });

  it("item yang sudah memenuhi targetnya tidak ikut", () => {
    expect(
      laggingItems([{ lineageKey: "x", volK: 100, amount: 1_000, volSd: 100, planFrac: 1 }]),
    ).toEqual([]);
  });

  it("volume RAB nol tidak pernah ikut – tidak ada yang bisa dibagi", () => {
    expect(
      laggingItems([{ lineageKey: "x", volK: 0, amount: 1_000, volSd: 0, planFrac: 1 }]),
    ).toEqual([]);
  });

  it("dibatasi 10 besar", () => {
    const banyak = Array.from({ length: 25 }, (_, i) => ({
      lineageKey: `k${i}`,
      volK: 100,
      amount: (i + 1) * 1_000_000,
      volSd: 0,
      planFrac: 1,
    }));
    expect(laggingItems(banyak)).toHaveLength(10);
    // Yang tersisa yang nilainya terbesar.
    expect(laggingItems(banyak)[0].lineageKey).toBe("k24");
  });
});
