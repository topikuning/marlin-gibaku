/*
 * Ringkasan kelompok untuk halaman "LAPORAN PROGRES MINGGUAN" per kategori &
 * sub-kategori (format Lampiran Termin, DECISIONS 670).
 */
import { describe, expect, it } from "vitest";
import { ringkasKelompok } from "@/lib/progress-calc";
import { keteranganDeviasi } from "@/lib/plan/rencana-format";

const baris = (o: Partial<Parameters<typeof ringkasKelompok>[0][number]>) => ({
  amount: 0,
  bobot: 0,
  bobotLalu: 0,
  bobotIni: 0,
  bobotSd: 0,
  bobotRencana: 0,
  ...o,
});

describe("ringkasKelompok", () => {
  it("menjumlah bobot item; progres = bobot terealisasi ÷ bobot kelompok", () => {
    const r = ringkasKelompok([
      baris({ amount: 300, bobot: 6, bobotLalu: 3, bobotIni: 1, bobotSd: 4, bobotRencana: 5 }),
      baris({ amount: 200, bobot: 4, bobotLalu: 0, bobotIni: 1, bobotSd: 1, bobotRencana: 2 }),
    ]);
    expect(r).toMatchObject({ nilai: 500, bobot: 10, bobotLalu: 3, bobotIni: 2, bobotSd: 5, bobotRencana: 7 });
    expect(r.progresLalu).toBeCloseTo(30, 10);
    expect(r.progresIni).toBeCloseTo(20, 10);
    expect(r.progresSd).toBeCloseTo(50, 10);
  });

  it("sisa = yang MASIH harus dikerjakan, positif (contoh berkas termin menulisnya minus)", () => {
    const r = ringkasKelompok([baris({ bobot: 10.181, bobotSd: 5.24 })]);
    expect(r.sisaProgres).toBeCloseTo(100 - (5.24 / 10.181) * 100, 10);
    expect(r.sisaBobot).toBeCloseTo(10.181 - 5.24, 10);
    expect(r.sisaProgres).toBeGreaterThan(0);
  });

  it("kelompok kosong / tanpa bobot: semua nol, tidak NaN", () => {
    const r = ringkasKelompok([]);
    expect(Object.values(r).every((v) => v === 0 || v === 100)).toBe(true);
    expect(r.sisaProgres).toBe(100);
    expect(Number.isNaN(ringkasKelompok([baris({ bobotSd: 1 })]).progresSd)).toBe(false);
  });
});

describe("keteranganDeviasi", () => {
  it.each([
    [3.781, "LEBIH CEPAT"],
    [-0.5, "TERLAMBAT"],
    [0.004, "SESUAI RENCANA"],
    [-0.004, "SESUAI RENCANA"],
  ] as const)("%s → %s", (dev, ket) => {
    expect(keteranganDeviasi(dev)).toBe(ket);
  });
});

describe("kop LAPORAN PROGRES MINGGUAN (satu teks untuk web, PDF, Excel – DECISIONS 671)", async () => {
  const { kopProgresMingguan, terbilangHari } = await import("@/lib/laporan/kop-progres");

  it.each([
    [120, "Seratus Dua Puluh"],
    [180, "Seratus Delapan Puluh"],
    [90, "Sembilan Puluh"],
    [215, "Dua Ratus Lima Belas"],
    [11, "Sebelas"],
    [1000, "Seribu"],
  ] as const)("terbilangHari(%s) = %s", (n, kata) => {
    expect(terbilangHari(n)).toBe(kata);
  });

  it("susunan contoh Lampiran Termin: minggu terbilang, periode, identitas, tiga pihak", () => {
    const kop = kopProgresMingguan(
      {
        packageName: "Pembangunan KNMP",
        village: "Sukalela",
        district: "Tambak",
        regency: "Kab. Gresik",
        province: "Jawa Timur",
        contractValue: 7_733_855_000n,
        contractNumber: "B.22007/PPK/2026",
        contractSignedDate: new Date("2026-08-14T00:00:00Z"),
        vendorName: "PT. SANG KARYA CIPTA",
        supervisorFirm: "PT. AGRINAS JALADRI NUSANTARA",
        supervisorName: null,
        masaPelaksanaanHari: 120,
        periodeStart: new Date("2026-09-21T00:00:00Z"),
        periodeEnd: new Date("2026-09-27T00:00:00Z"),
      } as unknown as Parameters<typeof kopProgresMingguan>[0],
      7,
    );
    expect(kop.judul).toBe("LAPORAN PROGRES MINGGUAN");
    expect(kop.minggu).toBe("MINGGU KE-7 (TUJUH)");
    expect(kop.periode).toBe("Periode 21 September s/d 27 September 2026");
    expect(Object.fromEntries(kop.identitas)).toEqual({
      "Paket Pekerjaan": "Pembangunan KNMP",
      Lokasi: "Sukalela, Kec. Tambak, Kab. Gresik, Jawa Timur",
      "Nilai Kontrak Fisik": "Rp 7.733.855.000",
      "No. dan Tanggal Kontrak": "B.22007/PPK/2026. Tgl. 14 Agustus 2026",
      "Kontraktor Pelaksana": "PT. SANG KARYA CIPTA",
      "Konsultan Pengawas": "PT. AGRINAS JALADRI NUSANTARA",
      "Masa Pelaksanaan": "120 (Seratus Dua Puluh) Hari Kalender",
    });
    expect(kop.pihak).toEqual(["PENYEDIA JASA", "KONSULTAN PENGAWAS", "PEMBERI TUGAS"]);
  });

  it("nilai kontrak lokasi ikut disebut di samping nilai kontrak paket (DECISIONS 677)", () => {
    const kop = kopProgresMingguan(
      {
        packageName: "Pembangunan KNMP Lingga",
        village: "Pantai Harapan",
        district: "Selayar",
        regency: "Lingga",
        province: "Kepulauan Riau",
        contractValue: 30_000_752_000n,
        nilaiKontrakLokasi: 7_492_500_000n,
        ppnPercent: 11,
        contractNumber: "B.24716",
        vendorName: "PT Prima Shina Cahaya",
        masaPelaksanaanHari: 135,
        periodeStart: new Date("2026-10-05T00:00:00Z"),
        periodeEnd: new Date("2026-10-11T00:00:00Z"),
      } as unknown as Parameters<typeof kopProgresMingguan>[0],
      6,
    );
    const label = kop.identitas.map(([k]) => k);
    expect(label.slice(1, 4)).toEqual(["Lokasi", "Nilai Kontrak Fisik (Paket)", "Nilai Kontrak Lokasi"]);
    expect(Object.fromEntries(kop.identitas)["Nilai Kontrak Fisik (Paket)"]).toBe("Rp 30.000.752.000");
    expect(Object.fromEntries(kop.identitas)["Nilai Kontrak Lokasi"]).toBe("Rp 7.492.500.000 (termasuk PPN 11%)");
  });
});

describe("realisasi mingguan per kategori (DECISIONS 674)", async () => {
  const { realisasiMingguanKelompok, ringkasRencanaRealisasi } = await import("@/lib/progress-calc");

  it("selisih kumulatif: minggu lalu + minggu ini = s/d, dan dibatasi 100% per item", () => {
    // Item A: bobot 6, volume kontrak 10 → 4 lalu 8 (lewat batas) → maks 6.
    // Item B: bobot 4, volume 5 → 0, 5.
    const w = realisasiMingguanKelompok(
      [
        { volK: 10, bobot: 6, volMingguan: [4, 8, 0] },
        { volK: 5, bobot: 4, volMingguan: [0, 5, 0] },
      ],
      3,
    );
    expect(w[0]).toBeCloseTo(2.4, 10);
    expect(w[1]).toBeCloseTo(3.6 + 4, 10);
    expect(w[2]).toBeCloseTo(0, 10);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
  });

  it("ringkasan s/d minggu acuan: bobot kontrak dan persen terhadap kategori", () => {
    const r = ringkasRencanaRealisasi({ rencana: 8, realisasi: 8 }, [1, 2, 3, 2], [0.5, 1.5, null, null], 2);
    expect(r).toMatchObject({ rencanaSd: 3, realisasiSd: 2 });
    expect(r.rencanaPct).toBeCloseTo(37.5, 10);
    expect(r.realisasiPct).toBeCloseTo(25, 10);
    expect(r.deviasi).toBeCloseTo(-1, 10);
    expect(ringkasRencanaRealisasi({ rencana: 0, realisasi: 0 }, [0], [0], 1).realisasiPct).toBe(0);
    // Jadwal tuntas = 100% terhadap bobot jadwalnya, walau bobot RAB sedikit beda.
    expect(ringkasRencanaRealisasi({ rencana: 5.02, realisasi: 5.0155 }, [5.02], [5], 1).rencanaPct).toBeCloseTo(100, 10);
  });
});
