import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PotongTeks } from "@/lib/daily-report/impor-pelaksana/bentuk";
import { angkaId, hariId, namaHari, rapiSatuan, satuanSesudahAngka, tanggalId } from "@/lib/daily-report/impor-pelaksana/baca-angka";
import { bacaTemplatKkp, kenaliTemplatKkp } from "@/lib/daily-report/impor-pelaksana/templat-kkp";
import {
  bolehDisimpan,
  hitungStatus,
  periksaKonteks,
  petakanBahan,
  petakanTenaga,
  susunUsulan,
  usulkanItem,
  type BarisUsulan,
  type KandidatItem,
} from "@/lib/daily-report/impor-pelaksana/cocok";

/**
 * IMPOR LAPORAN HARIAN PELAKSANA (DECISIONS 733).
 *
 * Fixture = potongan teks halaman 1 tiga laporan PT. Trans Sinergi Indonesia
 * yang diunggah user 2026-11-01 (nama orang diganti). Satu templat, tiga
 * rupa: "VOLUME | SATUAN", "VOL REALISASI | VOL RENCANA" (uraian dua baris),
 * "VOL.REALISASI | VOL.RENCNA" (tanggal tanpa tahun, baris tanpa volume).
 */
const fixture = (nama: string): PotongTeks[] =>
  JSON.parse(readFileSync(`tests/fixtures/laporan-pelaksana/${nama}.json`, "utf8"));

describe("pembaca templat laporan harian", () => {
  it("ketiga contoh dikenali sebagai templat yang sama", () => {
    for (const f of ["modis-1-nov", "botuliodu-12-okt", "minanga-tiga-30-okt"]) expect(kenaliTemplatKkp(fixture(f)), f).toBe(true);
    expect(kenaliTemplatKkp([{ s: "SURAT JALAN", x: 10, y: 10, w: 50 }])).toBe(false);
  });

  it("Modis: kolom VOLUME + SATUAN terpisah; tenaga hanya di kolom siang; alat datang", () => {
    const b = bacaTemplatKkp(fixture("modis-1-nov"));
    expect([b.tanggalTeks, b.hariTeks, b.tahunAnggaran]).toEqual(["01-Nov-26", "Minggu", 2026]);
    expect(b.lokasiTeks).toMatch(/^DESA MODIS/);
    expect(b.pekerjaan.map((p) => [p.no, p.uraian, p.volume, p.satuan, p.catatan])).toEqual([
      ["1", "Pekerjaan Galian Tanah Keras Sedalam 1 M", 46.08, "M3", "Selasai Dikerjakan"],
      ["2", "Pekerjaan Urugan Tanah Mendatangkan", 40.6, "M3", "Sementara Pekerjaan Penghamparan"],
    ]);
    expect(b.tenaga).toEqual([
      { jabatan: "Penanggung Jawab Lap.", pagi: null, siang: 1 },
      { jabatan: "Operator Excavator", pagi: null, siang: 1 },
    ]);
    expect(b.bahan).toEqual([{ nama: "Excavator Pc 200", merk: "Hitachi", teksTerima: "1 Unit", teksTolak: null }]);
  });

  it("Botuliodu: uraian dua baris, satuan menempel di angka, volume rencana, konsultan tidak dihitung", () => {
    const b = bacaTemplatKkp(fixture("botuliodu-12-okt"));
    expect(b.tanggalTeks).toBe("12 Oktober 2026");
    expect(b.pekerjaan.map((p) => [p.uraian, p.volume, p.satuan, p.volumeRencana])).toEqual([
      ["Pekerjaan galian dinding penahan tanah menggunakan alat berat Excavator", 122.51, "m3", 113.07],
      ["Pekerjaan Aanstamping/ batu kosong Dinding Penahan Tanah", 80.6, "m3", null],
      ["Pekerjaan urugan pasir Dinding Penahan Tanah", 0.28, "m3", null],
      ["Pekerjaan pondasi pasangan batu kali 1 : 5 Bangunan Kios Perbekalan", 7.48, "m3", 7.48],
    ]);
    expect(b.tenaga.map((t) => t.jabatan)).toEqual(["Pelaksana Lapangan", "Petugas K3", "Operator", "Mandor", "Kepala Tukang", "Pekerja"]);
    expect(b.tenaga.find((t) => t.jabatan === "Pekerja")).toEqual({ jabatan: "Pekerja", pagi: 15, siang: 15 });
    // "Pengawas Harian 1" milik konsultan – bukan tenaga kerja kontraktor.
    expect(b.tenaga.some((t) => /pengawas/i.test(t.jabatan))).toBe(false);
    expect(b.bahan.map((x) => [x.nama, x.merk, x.teksTerima])).toEqual([
      ["Semen (55 sak/bantal)", "Conch", "✓"],
      ["Pasir", null, "✓"],
    ]);
  });

  it("Minanga Tiga: tanggal tanpa tahun, baris pekerjaan tanpa volume tetap terbaca apa adanya", () => {
    const b = bacaTemplatKkp(fixture("minanga-tiga-30-okt"));
    expect([b.tanggalTeks, b.hariTeks, b.tahunAnggaran]).toEqual(["30 Oktober", "Sabtu", 2026]);
    expect(b.pekerjaan).toEqual([
      { no: "1", uraian: "PEKERJAAN DINDING PENAHAN SEMENTARA", volume: null, satuan: null, volumeRencana: null, catatan: "Perbaikan DPS" },
    ]);
    expect(b.tenaga.find((t) => t.jabatan === "Tukang Kayu")).toEqual({ jabatan: "Tukang Kayu", pagi: 17, siang: 17 });
    expect(b.bahan).toEqual([{ nama: "Dolken", merk: null, teksTerima: "50 Ujg", teksTolak: null }]);
  });
});

describe("angka & tanggal berkas", () => {
  it("koma desimal, titik ribuan, satuan menempel", () => {
    expect([angkaId("122,51 m3"), angkaId("1.234,5"), angkaId("1.500"), angkaId("15"), angkaId("–")]).toEqual([122.51, 1234.5, 1500, 15, null]);
    expect([satuanSesudahAngka("80,6 m3"), satuanSesudahAngka("1 Orang"), satuanSesudahAngka("46,08")]).toEqual(["m3", "Orang", null]);
    expect([rapiSatuan("M3"), rapiSatuan("m³"), rapiSatuan("m^3")]).toEqual(["m3", "m3", "m3"]);
  });

  it("tanggal: nama bulan, singkatan, tanpa tahun (pakai T. A.), angka; tanggal mustahil ditolak", () => {
    expect(tanggalId("12 Oktober 2026", null)).toBe("2026-10-12");
    expect(tanggalId("01-Nov-26", null)).toBe("2026-11-01");
    expect(tanggalId("30 Oktober", 2026)).toBe("2026-10-30");
    expect(tanggalId("30 Oktober", null)).toBeNull();
    expect(tanggalId("12/10/2026", null)).toBe("2026-10-12");
    expect(tanggalId("31 Februari 2026", null)).toBeNull();
  });

  it("nama hari", () => {
    expect([namaHari("2026-10-30"), namaHari("2026-10-31"), hariId(": Senin"), hariId("Jum'at")]).toEqual(["jumat", "sabtu", "senin", "jumat"]);
  });
});

const k = (o: Partial<KandidatItem> & { id: string; nama: string }): KandidatItem => ({
  lineageKey: o.id,
  kode: "1",
  jalur: [],
  satuan: "m³",
  volumeRab: 100,
  sisa: 100,
  basis: "aktif",
  diLaporan: null,
  ...o,
});

describe("pencocokan uraian ke item RAB", () => {
  const galianPabrik = k({ id: "g1", nama: "Pekerjaan Galian Tanah keras sedalam 1 m", jalur: ["PEKERJAAN PONDASI PABRIK ES"] });
  const galianDock = k({ id: "g2", nama: "Pekerjaan Galian Tanah sedalam 1 m", jalur: ["PEKERJAAN DOCKING"] });
  const galianDpt = k({ id: "g3", nama: "Pekerjaan Galian Tanah sampai dengan 1 m", jalur: ["PEKERJAAN DINDING PENAHAN TANAH"] });
  const galianShelter = k({ id: "g4", nama: "Pekerjaan Galian Tanah", jalur: ["PEKERJAAN SHELTER"] });
  const semua = [galianPabrik, galianDock, galianDpt, galianShelter];

  it("nama yang persis sama dan hanya satu → dipilih otomatis", () => {
    expect(usulkanItem("Pekerjaan Galian Tanah Keras Sedalam 1 M", "M3", semua).kandidatId).toBe("g1");
  });

  it("nama berulang di banyak bangunan → TIDAK dipilih otomatis; kategori yang disebut uraian diurutkan pertama", () => {
    const u = usulkanItem("Pekerjaan galian dinding penahan tanah menggunakan alat berat Excavator", "m3", semua);
    expect(u.kandidatId).toBeNull();
    expect(u.saran[0].id).toBe("g3");
  });

  it("item draft adendum tidak pernah dipilih otomatis – hanya orang yang memilihnya", () => {
    const draft = k({ id: "d1", nama: "Pekerjaan Urugan Tanah Mendatangkan", basis: "draft_adendum" });
    expect(usulkanItem("Pekerjaan Urugan Tanah Mendatangkan", "M3", [draft]).kandidatId).toBeNull();
  });
});

describe("status baris: volume di atas sisa RAB DITAHAN (pilihan user: Tahan + peringatan)", () => {
  const urugan = k({ id: "u1", nama: "Urugan Tanah", sisa: 30, satuan: "m3" });
  const pasangan = k({ id: "p1", nama: "Pasangan Batu", sisa: 10, satuan: "m2" });
  const urugDraft = k({ id: "u2", nama: "Urugan Tanah", sisa: 60, satuan: "m3", basis: "draft_adendum" });
  const kandidat = [urugan, pasangan, urugDraft];
  const baris = (o: Partial<BarisUsulan> & { idx: number }): BarisUsulan => ({
    no: null, uraian: "x", satuanBerkas: "m3", catatan: null, volume: 10, kandidatId: "u1", skor: 1, saran: [], lewati: false, ...o,
  });

  it("melebihi sisa → ditahan dengan pesan berisi sisa; tidak boleh disimpan", () => {
    const [s] = hitungStatus([baris({ idx: 0, volume: 40.6 })], kandidat);
    expect(s.status).toBe("melebihi");
    expect(s.pesan).toMatch(/sisa 30/);
    expect(s.pesan).toMatch(/draft adendum/);
    expect(bolehDisimpan(s, true)).toBe(false);
  });

  it("dua baris berkas ke item yang sama dijumlahkan sebelum diadu dengan sisa", () => {
    const st = hitungStatus([baris({ idx: 0, volume: 20 }), baris({ idx: 1, volume: 15 })], kandidat);
    expect(st.map((s) => s.status)).toEqual(["melebihi", "melebihi"]);
    expect(st[0].total).toBe(35);
  });

  it("diarahkan ke item draft adendum yang sisanya cukup → siap", () => {
    const [s] = hitungStatus([baris({ idx: 0, volume: 40.6, kandidatId: "u2" })], kandidat);
    expect(s.status).toBe("siap");
  });

  it("satuan beda ditahan sampai orangnya menyatakan itemnya benar", () => {
    const [s] = hitungStatus([baris({ idx: 0, volume: 5, kandidatId: "p1" })], kandidat);
    expect(s.status).toBe("satuan_beda");
    expect([bolehDisimpan(s, false), bolehDisimpan(s, true)]).toEqual([false, true]);
  });

  it("belum ada item → pilih item; tanpa volume → tidak bisa dimasukkan", () => {
    const st = hitungStatus([baris({ idx: 0, kandidatId: null }), baris({ idx: 1, volume: null, lewati: true })], kandidat);
    expect(st.map((s) => s.status)).toEqual(["pilih_item", "tanpa_volume"]);
  });

  it("susunUsulan: baris tanpa volume dari berkas otomatis dilewati", () => {
    const u = susunUsulan([{ no: "1", uraian: "PEKERJAAN DPS", volume: null, satuan: null, volumeRencana: null, catatan: null }], kandidat);
    expect(u[0].lewati).toBe(true);
  });
});

describe("tenaga kerja & bahan/alat", () => {
  it("jabatan dipetakan ke MARLIN; yang tak berpadanan DISEBUT, tidak dimasukkan diam-diam", () => {
    const t = petakanTenaga([
      { jabatan: "Penanggung Jawab Lap.", pagi: null, siang: 1 },
      { jabatan: "Petugas K3", pagi: 1, siang: 1 },
      { jabatan: "Pekerja", pagi: 15, siang: 12 },
      { jabatan: "Pekerja Terampil", pagi: 2, siang: 2 },
      { jabatan: "Operator Excavator", pagi: null, siang: 1 },
    ]);
    expect(t.workers).toEqual([
      { role: "site_manager", count: 1 },
      { role: "tenaga", count: 17 },
      { role: "operator", count: 1 },
    ]);
    expect(t.tanpaPadanan).toEqual(["Petugas K3 (1)"]);
  });

  it("alat dikenali dari nama/satuan; centang = diterima tanpa jumlah; yang hanya ditolak tidak dipakai", () => {
    const b = petakanBahan([
      { nama: "Excavator Pc 200", merk: "Hitachi", teksTerima: "1 Unit", teksTolak: null },
      { nama: "Semen (55 sak/bantal)", merk: "Conch", teksTerima: "✓", teksTolak: null },
      { nama: "Dolken", merk: null, teksTerima: "50 Ujg", teksTolak: null },
      { nama: "Pasir", merk: null, teksTerima: null, teksTolak: "2 m3" },
    ]);
    expect(b.map((x) => [x.nama, x.jenis, x.qty, x.satuan, x.pakai])).toEqual([
      ["Excavator Pc 200 (Hitachi)", "alat", 1, "Unit", true],
      ["Semen (55 sak/bantal) (Conch)", "bahan", null, null, true],
      ["Dolken", "bahan", 50, "Ujg", true],
      ["Pasir", "bahan", null, null, false],
    ]);
  });
});

describe("kecocokan berkas dengan laporan yang dibuka", () => {
  it("tanggal berkas ≠ tanggal laporan dan hari yang salah DISEBUT (contoh nyata: berkas '31 Oktober' berisi Sabtu 30 Oktober)", () => {
    const r = periksaKonteks(
      { tanggalTeks: "30 Oktober", hariTeks: "Sabtu", lokasiTeks: "DESA MINANGA TIGA, KEC. PUSOMAEN", tahunAnggaran: 2026 },
      { dateKey: "2026-10-31", namaLokasi: "Minanga Tiga", desa: "Minanga Tiga" },
    );
    expect(r.tanggalBerkas).toBe("2026-10-30");
    expect(r.peringatan.join(" | ")).toMatch(/30 Oktober 2026, sedangkan laporan yang dibuka 31 Oktober 2026/);
    expect(r.peringatan.join(" | ")).toMatch(/hari Sabtu, padahal 30 Oktober 2026 jatuh pada hari Jumat/);
  });

  it("lokasi berkas lain disebut; lokasi yang sama tidak", () => {
    const tujuan = { dateKey: "2026-10-12", namaLokasi: "Modis", desa: "Modis" };
    const lain = periksaKonteks({ tanggalTeks: "12 Oktober 2026", hariTeks: "Senin", lokasiTeks: "DESA BOTULIODU", tahunAnggaran: 2026 }, tujuan);
    expect(lain.peringatan.join(" ")).toMatch(/tidak menyebut Modis/);
    const sama = periksaKonteks({ tanggalTeks: "12 Oktober 2026", hariTeks: "Senin", lokasiTeks: "DESA MODIS KEC. X", tahunAnggaran: 2026 }, tujuan);
    expect(sama.peringatan).toEqual([]);
  });
});
