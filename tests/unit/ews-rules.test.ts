// EWS — rule murni (DECISIONS 426): setiap warning membawa alasan spesifik,
// tindakan, dan deep-link; pagar minggu-0 (DECISIONS 202/340) dihormati.
import { describe, expect, it } from "vitest";
import {
  AMBANG,
  evaluasiEwsLokasi,
  evaluasiEwsPaket,
  urutkanWarning,
  type EwsLocationFacts,
} from "@/lib/ews/rules";

const dasar: EwsLocationFacts = {
  locationName: "Lokasi Uji",
  locationSlug: "lokasi-uji",
  status: "berjalan",
  weekNumber: 10,
  totalWeeks: 22,
  deviationPct: 0,
  realizedPct: 50,
  hariTanpaLaporan: 1,
  laporanPerluKoreksi: 0,
  sisaHariKontrak: 90,
  waktuTerpakaiPct: 45,
  temuanKritisTerbuka: 0,
  temuanLewatTenggat: 0,
  temuanDibukaKembali: 0,
  kendalaLewatTenggat: 0,
};

const ids = (f: Partial<EwsLocationFacts>) => evaluasiEwsLokasi({ ...dasar, ...f }).map((w) => w.ruleId);

describe("EWS rule lokasi", () => {
  it("keadaan sehat → nol warning", () => {
    expect(evaluasiEwsLokasi(dasar)).toEqual([]);
  });

  it("deviasi -5 pp → tinggi; -10 pp → kritis (sejalan ambang existing)", () => {
    expect(ids({ deviationPct: -5 })).toContain("deviasi_tinggi");
    const kritis = evaluasiEwsLokasi({ ...dasar, deviationPct: -10 });
    expect(kritis.map((w) => w.ruleId)).toContain("deviasi_kritis");
    expect(kritis.find((w) => w.ruleId === "deviasi_kritis")?.severity).toBe("kritis");
    // Alasan menyebut angka, bukan sekadar "deviasi".
    expect(kritis.find((w) => w.ruleId === "deviasi_kritis")?.alasan).toContain("-10.0 pp");
  });

  it("PAGAR MINGGU-0: SPMK belum tiba → rule progres/laporan TIDAK menyala", () => {
    expect(
      ids({ weekNumber: 0, deviationPct: -50, hariTanpaLaporan: null }),
    ).toEqual([]);
  });

  it("tanpa laporan 7 hari → tinggi; 14 hari → kritis; belum pernah → tinggi", () => {
    expect(ids({ hariTanpaLaporan: AMBANG.tanpaLaporanTinggiHari })).toContain("tanpa_laporan_tinggi");
    expect(ids({ hariTanpaLaporan: AMBANG.tanpaLaporanKritisHari })).toContain("tanpa_laporan_kritis");
    expect(ids({ hariTanpaLaporan: null })).toContain("belum_pernah_lapor");
  });

  it("lokasi terhenti → warning tersendiri", () => {
    expect(ids({ status: "terhenti" })).toContain("lokasi_terhenti");
  });

  it("kontrak: sisa <14 hari & progress <90% → kritis; lewat masa → kritis", () => {
    expect(ids({ sisaHariKontrak: 10, realizedPct: 70 })).toContain("sisa_kontrak_kritis");
    expect(ids({ sisaHariKontrak: 20, realizedPct: 70 })).toContain("sisa_kontrak_tinggi");
    expect(ids({ sisaHariKontrak: -3 })).toContain("kontrak_lewat");
    // Progress hampir tuntas → sisa waktu pendek itu wajar, bukan warning.
    expect(ids({ sisaHariKontrak: 10, realizedPct: 95 })).toEqual([]);
  });

  it("konsumsi waktu tak proporsional (>20 pp di atas progress) → sedang", () => {
    expect(ids({ waktuTerpakaiPct: 75, realizedPct: 50 })).toContain("konsumsi_waktu");
    expect(ids({ waktuTerpakaiPct: 65, realizedPct: 50 })).toEqual([]);
  });

  it("temuan: kritis terbuka → kritis; lewat tenggat & dibuka kembali → tinggi", () => {
    expect(ids({ temuanKritisTerbuka: 2 })).toContain("temuan_kritis");
    expect(ids({ temuanLewatTenggat: 1 })).toContain("temuan_lewat_tenggat");
    expect(ids({ temuanDibukaKembali: 1 })).toContain("temuan_dibuka_kembali");
  });

  it("setiap warning membawa alasan + tindakan + deep-link", () => {
    const semua = evaluasiEwsLokasi({
      ...dasar,
      status: "terhenti",
      deviationPct: -15,
      hariTanpaLaporan: 20,
      temuanKritisTerbuka: 1,
      kendalaLewatTenggat: 2,
      laporanPerluKoreksi: 5,
    });
    expect(semua.length).toBeGreaterThanOrEqual(5);
    for (const w of semua) {
      expect(w.alasan.length).toBeGreaterThan(10);
      expect(w.tindakan.length).toBeGreaterThan(10);
      expect(w.href.startsWith("/")).toBe(true);
    }
  });
});

describe("EWS rule paket (dokumen & administrasi)", () => {
  it("dokumen lewat masa berlaku → tinggi; segera kadaluarsa → sedang", () => {
    const w = evaluasiEwsPaket({
      packageId: "p1",
      packageName: "Paket Uji",
      dokSudahKadaluarsa: [{ title: "Jaminan Pelaksanaan" }],
      dokSegeraKadaluarsa: [{ title: "Jaminan Uang Muka", hariLagi: 12 }],
      milestoneTerlambat: 3,
    });
    expect(w.map((x) => x.ruleId).sort()).toEqual(["dok_kadaluarsa", "dok_segera_kadaluarsa", "milestone_terlambat"]);
    expect(w.find((x) => x.ruleId === "dok_kadaluarsa")?.alasan).toContain("Jaminan Pelaksanaan");
  });
});

describe("urutan", () => {
  it("kritis sebelum tinggi sebelum sedang", () => {
    const acak = [
      ...evaluasiEwsLokasi({ ...dasar, kendalaLewatTenggat: 1 }), // sedang
      ...evaluasiEwsLokasi({ ...dasar, deviationPct: -12 }), // kritis
      ...evaluasiEwsLokasi({ ...dasar, deviationPct: -6 }), // tinggi
    ];
    const urut = urutkanWarning(acak);
    expect(urut[0].severity).toBe("kritis");
    expect(urut[urut.length - 1].severity).toBe("sedang");
  });
});

describe("identitas objek ikut di tiap warning (review 2026-08-28)", () => {
  /*
   * Sebelum ini satu-satunya petunjuk objek adalah `objek` (nama untuk dibaca)
   * dan `href`. Pemakai di luar layar — adapter AI — terpaksa menebak dari teks
   * href, dan tebakan itu gagal dua arah: peringatan tingkat PAKET & SURAT
   * tidak pernah terpetakan sama sekali, sementara pencocokan substring bisa
   * menyamakan slug yang saling berawalan.
   */
  it("warning LOKASI membawa slug-nya, termasuk yang href-nya ke /temuan & /kendala", () => {
    const w = evaluasiEwsLokasi({
      ...dasar,
      status: "terhenti",
      temuanKritisTerbuka: 2,
      kendalaLewatTenggat: 1,
    });
    expect(w.length).toBeGreaterThan(2);
    for (const x of w) expect(x.locationSlug).toBe("lokasi-uji");
    // Justru dua ini yang dulu hilang: href-nya tidak memuat "/lokasi/<slug>".
    const luarLokasi = w.filter((x) => !x.href.startsWith("/lokasi/"));
    expect(luarLokasi.length).toBeGreaterThan(0);
    for (const x of luarLokasi) expect(x.locationSlug).toBe("lokasi-uji");
  });

  it("warning PAKET membawa packageId, bukan cuma nama paket", () => {
    const w = evaluasiEwsPaket({
      packageId: "pkg-1",
      packageName: "Paket Uji",
      dokSudahKadaluarsa: [{ title: "Jaminan pelaksanaan" }],
      dokSegeraKadaluarsa: [],
      milestoneTerlambat: 2,
    });
    expect(w.length).toBe(2);
    for (const x of w) {
      expect(x.packageId).toBe("pkg-1");
      // Bukan warning lokasi – jangan sampai tertempel ke satu titik proyek.
      expect(x.locationSlug).toBeUndefined();
    }
  });

  it("warning SURAT membawa letterId & packageId-nya", async () => {
    const { evaluasiEwsSurat } = await import("@/lib/ews/rules");
    const w = evaluasiEwsSurat({
      letterId: "surat-1",
      packageId: "pkg-1",
      agenda: "12/2026",
      subject: "Klarifikasi volume",
      pihak: "PPK",
      telatHari: 5,
    });
    expect(w).toHaveLength(1);
    expect(w[0].letterId).toBe("surat-1");
    expect(w[0].packageId).toBe("pkg-1");
  });

  it("surat tanpa paket TIDAK mengarang packageId", () => {
    // Surat tingkat organisasi memang tidak punya paket. Mengisinya dengan
    // tebakan akan melekatkan peringatan itu ke paket yang salah.
    return import("@/lib/ews/rules").then(({ evaluasiEwsSurat }) => {
      const w = evaluasiEwsSurat({
        letterId: "surat-2",
        packageId: null,
        agenda: "13/2026",
        subject: "Edaran",
        pihak: "Dinas",
        telatHari: 3,
      });
      expect(w[0].packageId).toBeUndefined();
    });
  });
});
