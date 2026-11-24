// PERUBAHAN WAKTU CCO: JUMLAH HARI ATAU TANGGAL AKHIR (DECISIONS 771).
//
// Permintaan user 2026-11-23: *"bisa jadi aku hanya tahu informasi tanggal
// perubahan atau tanggal akhir dari perpanjangannya, seharusnya sistem bisa
// memberikan inputan itu, jadi antara isi perubahan jumlah hari atau input
// tanggal akhir selesainya"*.
//
// Yang disimpan tetap jumlah hari (`endDateDelta`). Tanggal akhir yang diketik
// diubah jadi hari terhadap akhir kontrak TEPAT SEBELUM CCO itu: akhir awal +
// hari CCO yang dicatat lebih dulu.
import { describe, expect, it } from "vitest";
import { akhirSebelumAdendum, selisihHari, tambahHari } from "@/lib/progress-calc";

const t = (k: string) => new Date(`${k}T00:00:00.000Z`);

describe("tambahHari & selisihHari: hari kalender, saling membalik", () => {
  it("perpanjangan 30 hari dari 31 Desember jatuh 30 Januari", () => {
    expect(tambahHari(t("2026-12-31"), 30)).toEqual(t("2027-01-30"));
    expect(selisihHari(t("2026-12-31"), t("2027-01-30"))).toBe(30);
  });

  it("pengurangan waktu = hari negatif", () => {
    expect(selisihHari(t("2026-12-31"), t("2026-12-21"))).toBe(-10);
    expect(tambahHari(t("2026-12-31"), -10)).toEqual(t("2026-12-21"));
  });

  it("melewati 29 Februari tetap hari kalender", () => {
    expect(selisihHari(t("2028-02-27"), t("2028-03-01"))).toBe(3);
  });
});

describe("akhirSebelumAdendum: akhir kontrak tepat sebelum sebuah CCO", () => {
  const akhirAwal = t("2026-12-31");
  const cco = [
    { endDateDelta: 30, createdAt: new Date("2026-11-01T03:00:00Z") },
    { endDateDelta: 15, createdAt: new Date("2026-11-10T03:00:00Z") },
  ];

  it("CCO baru: semua CCO yang sudah tercatat ikut dihitung", () => {
    expect(akhirSebelumAdendum(akhirAwal, cco, null)).toEqual(t("2027-02-14"));
  });

  it("koreksi CCO kedua: hanya CCO yang dicatat lebih dulu", () => {
    expect(akhirSebelumAdendum(akhirAwal, cco, cco[1]!.createdAt)).toEqual(t("2027-01-30"));
  });

  it("koreksi CCO pertama: dihitung dari akhir kontrak awal", () => {
    expect(akhirSebelumAdendum(akhirAwal, cco, cco[0]!.createdAt)).toEqual(akhirAwal);
  });

  it("tanggal akhir yang diketik → hari terhadap akhir sebelum CCO itu", () => {
    // CCO kedua di dokumennya: "selesai 20 Februari 2027".
    const sebelum = akhirSebelumAdendum(akhirAwal, cco, cco[1]!.createdAt);
    expect(selisihHari(sebelum, t("2027-02-20"))).toBe(21);
  });
});
