// SARINGAN PAPAN STATUS HARIAN — permintaan user 2026-08-06:
//
//   *"dimana filter kalau aku ingin langsung ke lokasi tertentu, aku ingin
//   tahu mana yang belum upload ke drive, mana yang sudah laporan wa."*
//
// Saringan adalah logika yang gagal DIAM-DIAM: yang salah tidak menerbitkan
// galat apa pun, ia hanya menyembunyikan lokasi yang seharusnya ditindak. Di
// papan pengawasan, itu kegagalan yang paling mahal — orang justru menyimpulkan
// "semua sudah beres" dari layar yang menyembunyikan yang belum.
import { describe, expect, it } from "vitest";
import {
  adaFilterAktif,
  bacaFilter,
  FILTER_KOSONG,
  saringBaris,
  tautFilter,
  type BarisTersaring,
} from "@/lib/daily-report/status-harian-filter";

const baris = (
  slug: string,
  drive: "sukses" | "gagal" | null,
  wa: Date | null,
  status: BarisTersaring["status"] = "final",
): BarisTersaring => ({ slug, status, drive: { status: drive }, waSentAt: wa });

const KIRIM = new Date("2026-08-06T09:00:00.000Z");

const ISI: BarisTersaring[] = [
  baris("pasir", "sukses", KIRIM, "final"), // sudah semua
  baris("kedungmutih", null, KIRIM, "draft"), // drive belum, wa sudah
  baris("batah-timur", "gagal", null, "perlu_koreksi"), // drive gagal, wa belum
  baris("tengket", null, null, null), // belum lapor sama sekali
];

describe("bacaFilter", () => {
  it("query kosong → tanpa saringan", () => {
    expect(bacaFilter({})).toEqual(FILTER_KOSONG);
  });

  it("nilai tak dikenal jatuh ke 'semua', bukan galat", () => {
    // Alamat yang diketik ulang atau dipotong saat dibagikan lewat WA tidak
    // boleh membuat halaman gagal — ia cuma kehilangan saringannya.
    expect(bacaFilter({ drive: "ngawur", wa: "xyz" })).toEqual(FILTER_KOSONG);
  });

  it("spasi di slug lokasi dibuang", () => {
    expect(bacaFilter({ lokasi: "  pasir  " }).lokasi).toBe("pasir");
  });
});

describe("saringBaris", () => {
  it("tanpa saringan → semua baris utuh", () => {
    expect(saringBaris(ISI, FILTER_KOSONG)).toHaveLength(4);
  });

  it("lokasi tertentu → hanya lokasi itu", () => {
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, lokasi: "kedungmutih" });
    expect(hasil.map((r) => r.slug)).toEqual(["kedungmutih"]);
  });

  it("'belum naik' mencakup yang BELUM DICOBA dan yang GAGAL", () => {
    // Keduanya sama-sama berarti berkasnya TIDAK ADA di Drive — itulah yang
    // ditanyakan. Kalau yang gagal dikeluarkan dari daftar ini, ia lenyap dari
    // pandangan justru karena bermasalah.
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, drive: "belum" });
    expect(hasil.map((r) => r.slug).sort()).toEqual(["batah-timur", "kedungmutih", "tengket"]);
  });

  it("'gagal' memisahkan yang perlu dilihat sebabnya", () => {
    // Tindak lanjutnya berbeda: yang belum dicoba tinggal diunggah, yang gagal
    // perlu diperiksa dulu.
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, drive: "gagal" });
    expect(hasil.map((r) => r.slug)).toEqual(["batah-timur"]);
  });

  it("'sudah naik' hanya yang benar-benar sukses", () => {
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, drive: "sudah" });
    expect(hasil.map((r) => r.slug)).toEqual(["pasir"]);
  });

  it("WA sudah / belum dikirim", () => {
    expect(saringBaris(ISI, { ...FILTER_KOSONG, wa: "sudah" }).map((r) => r.slug).sort()).toEqual([
      "kedungmutih",
      "pasir",
    ]);
    expect(saringBaris(ISI, { ...FILTER_KOSONG, wa: "belum" }).map((r) => r.slug).sort()).toEqual([
      "batah-timur",
      "tengket",
    ]);
  });

  it("laporan: 'belum lapor' hanya yang TIDAK punya laporan sama sekali", () => {
    // Teguran user 2026-08-06: *"filter laporan belum dan sudah/final saja
    // kenapa harus ketik2 manual"*. Ini isi jawabannya — dan yang dijaga di
    // sini adalah bedanya "belum ada laporannya" dengan "ada tapi belum
    // tuntas": yang pertama perlu ditagih ke lapangan, yang kedua perlu
    // diperiksa & difinalkan. Meleburnya menghapus bedanya.
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, laporan: "belum" });
    expect(hasil.map((r) => r.slug)).toEqual(["tengket"]);
  });

  it("laporan: 'belum final' = SEMUA status antara, bukan cuma draft", () => {
    // draft, dikirim, perlu_koreksi, disetujui — bagi yang mengawasi semuanya
    // sama: sudah ada laporannya, belum tuntas.
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, laporan: "proses" });
    expect(hasil.map((r) => r.slug).sort()).toEqual(["batah-timur", "kedungmutih"]);
  });

  it("laporan: 'final' tidak ikut menyeret yang 'disetujui'", () => {
    // "Disetujui" belum terkunci; menyebutnya final di papan pengawasan
    // membuat pekerjaan yang belum selesai terbaca selesai.
    const isi = [...ISI, baris("sungai-nipah", null, null, "disetujui")];
    const hasil = saringBaris(isi, { ...FILTER_KOSONG, laporan: "final" });
    expect(hasil.map((r) => r.slug)).toEqual(["pasir"]);
  });

  it("dua saringan berlaku BERSAMAAN, bukan saling menggantikan", () => {
    // Pertanyaan nyata di lapangan: "yang sudah dilaporkan ke grup tapi
    // berkasnya belum naik ke Drive" — itu justru yang paling perlu dikejar.
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, drive: "belum", wa: "sudah" });
    expect(hasil.map((r) => r.slug)).toEqual(["kedungmutih"]);
  });

  it("tidak ada yang cocok → daftar kosong, bukan daftar penuh", () => {
    // Saringan yang "gagal terbuka" (mengembalikan semuanya saat tak ada yang
    // cocok) jauh lebih berbahaya daripada daftar kosong: ia terbaca seolah
    // semua lokasi memenuhi kriteria.
    const hasil = saringBaris(ISI, { ...FILTER_KOSONG, lokasi: "tidak-ada" });
    expect(hasil).toEqual([]);
  });
});

describe("adaFilterAktif", () => {
  it("membedakan tanpa-saringan dari bersaringan", () => {
    expect(adaFilterAktif(FILTER_KOSONG)).toBe(false);
    expect(adaFilterAktif({ ...FILTER_KOSONG, wa: "belum" })).toBe(true);
    expect(adaFilterAktif({ ...FILTER_KOSONG, lokasi: "pasir" })).toBe(true);
  });
});

describe("tautFilter", () => {
  it("tanggal SELALU ikut — berpindah saringan tidak boleh melompat ke hari ini", () => {
    const t = tautFilter("2026-08-06", FILTER_KOSONG, { drive: "belum" });
    expect(t).toContain("tanggal=2026-08-06");
    expect(t).toContain("drive=belum");
  });

  it("saringan lain dipertahankan saat satu diubah", () => {
    const t = tautFilter(
      "2026-08-06",
      { lokasi: "pasir", laporan: "proses", drive: "belum", wa: "semua" },
      { wa: "sudah" },
    );
    expect(t).toContain("lokasi=pasir");
    expect(t).toContain("laporan=proses");
    expect(t).toContain("drive=belum");
    expect(t).toContain("wa=sudah");
  });

  it("nilai 'semua' TIDAK ikut ditulis — alamatnya tetap pendek & terbaca", () => {
    const t = tautFilter("2026-08-06", FILTER_KOSONG, {});
    expect(t).toBe("/laporan/status-harian?tanggal=2026-08-06");
  });
});
