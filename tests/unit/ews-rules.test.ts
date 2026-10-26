// EWS — rule murni (DECISIONS 426): setiap warning membawa alasan spesifik,
// tindakan, dan deep-link; pagar minggu-0 (DECISIONS 202/340) dihormati.
import { describe, expect, it } from "vitest";
import {
  AMBANG,
  evaluasiEwsKawal,
  evaluasiEwsLokasi,
  evaluasiEwsPaket,
  evaluasiEwsUsulanWa,
  urutkanWarning,
  type EwsKawalFacts,
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
    expect(kritis.find((w) => w.ruleId === "deviasi_kritis")?.alasan).toContain("-10.0 poin persen");
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

/* Selisih MARLIN vs Kawal KNMP (DECISIONS 689, 694). */
describe("EWS selisih_kawal", () => {
  const kawal: EwsKawalFacts = {
    locationName: "Lokasi Uji",
    locationSlug: "lokasi-uji",
    status: "berjalan",
    weekNumber: 8,
    marlinPct: 10,
    kawalPct: 6,
    mingguKawal: 8,
    mingguIsiKawal: 8,
    ambang: { tinggiPp: 5, kritisPp: 10 },
  };
  const ev = (f: Partial<EwsKawalFacts>) => evaluasiEwsKawal({ ...kawal, ...f });

  it("contoh brief 10% vs 6% (+4 pp) → belum menyala", () => {
    expect(ev({})).toEqual([]);
  });

  it("≥ 5 pp tinggi, ≥ 10 pp kritis, ke arah mana pun; arah dan tindakan ikut ditulis", () => {
    const tinggi = ev({ marlinPct: 11 });
    expect(tinggi).toHaveLength(1);
    expect(tinggi[0]).toMatchObject({
      ruleId: "selisih_kawal",
      kategori: "progress",
      severity: "tinggi",
      href: "/lokasi/lokasi-uji/kawal",
      locationSlug: "lokasi-uji",
    });
    expect(tinggi[0].alasan).toContain("+5,00 pp, MARLIN lebih tinggi");
    expect(tinggi[0].tindakan).toContain("pengawas");

    const kritis = ev({ marlinPct: 6, kawalPct: 16 });
    expect(kritis[0].severity).toBe("kritis");
    expect(kritis[0].alasan).toContain("−10,00 pp, Kawal lebih tinggi");
    expect(kritis[0].tindakan).toContain("laporan harian");
  });

  it("minggu terakhir diisi pengawas disebut bila tertinggal dari minggu berjalan", () => {
    expect(ev({ marlinPct: 20, mingguIsiKawal: 5 })[0].alasan).toContain("minggu ke-8, terakhir diisi minggu ke-5");
    expect(ev({ marlinPct: 20 })[0].alasan).not.toContain("terakhir diisi");
  });

  it("ambang yang diatur dipakai", () => {
    expect(ev({ ambang: { tinggiPp: 3, kritisPp: 4 } })[0].severity).toBe("kritis");
  });

  it("PAGAR MINGGU-0 di kedua sisi + hanya lokasi yang sedang dikerjakan", () => {
    expect(ev({ marlinPct: 30, weekNumber: 0 })).toEqual([]);
    expect(ev({ marlinPct: 30, mingguKawal: 0 })).toEqual([]);
    expect(ev({ marlinPct: 30, mingguKawal: null })).toEqual([]);
    expect(ev({ marlinPct: 30, status: "selesai" })).toEqual([]);
    expect(ev({ marlinPct: 30, status: "terhenti" })).toHaveLength(1);
  });

  it("Kawal belum mengisi → tidak dinilai", () => {
    expect(ev({ marlinPct: 30, kawalPct: null })).toEqual([]);
  });

  it("teks layar memakai en-dash, bukan em-dash", () => {
    const w = ev({ marlinPct: 30, mingguIsiKawal: 2 })[0];
    expect(`${w.alasan} ${w.tindakan}`).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("EWS usulan WA yang belum diputus (DECISIONS 707)", () => {
  const ev = (menunggu: number, umurTertuaHari: number) =>
    evaluasiEwsUsulanWa({
      locationName: "Lokasi Uji",
      locationSlug: "lokasi-uji",
      menunggu,
      tanggalTertua: "2026-10-24",
      umurTertuaHari,
    });

  it("tidak ada yang menunggu → diam", () => {
    expect(ev(0, 5)).toEqual([]);
  });

  it("baru hari ini → sedang; menunggu sejak ambang hari → tinggi", () => {
    expect(ev(2, 0)[0].severity).toBe("sedang");
    expect(ev(2, AMBANG.usulanWaTinggiHari - 1)[0].severity).toBe("sedang");
    expect(ev(2, AMBANG.usulanWaTinggiHari)[0].severity).toBe("tinggi");
  });

  it("menunjuk laporan harian TANGGAL usulan tertua, membawa slug, berkategori laporan", () => {
    const [w] = ev(3, 2);
    expect(w.href).toBe("/lokasi/lokasi-uji/harian/2026-10-24");
    expect(w.locationSlug).toBe("lokasi-uji");
    expect(w.kategori).toBe("laporan");
    expect(w.alasan).toContain("3 usulan");
    expect(w.alasan).toContain("2 hari lalu");
    expect(`${w.alasan} ${w.tindakan}`).not.toContain(String.fromCharCode(0x2014));
  });
});
