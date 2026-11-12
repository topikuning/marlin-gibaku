// TANDA TANGAN & STEMPEL DI EXCEL (DECISIONS 757).
//
// Keluhan user 2026-11-11: *"kenapa tanda tangan dan stempel di excel untuk
// laporan mingguan tidak ada, cuma ada di versi pdf, ini mengganggu dan bikin
// orang kerja ganda"*. DECISIONS 328 menempelkannya ke halaman cetak dan PDF;
// Excel tertinggal dengan ruang kosong untuk pena.
//
// Yang dikunci:
//  1. tiap lembar ber-blok tanda tangan memuat gambar tiap pihak yang punya
//     berkasnya – stempel lebih dulu, coretan sesudahnya (urutan PDF);
//  2. gambar tetap DI DALAM blok tanda tangan: tidak naik menembus tabel di
//     atasnya (DECISIONS 333) dan coretan berpijak di baris nama;
//  3. rasio gambar dijaga, tidak diregangkan;
//  4. tanpa berkas, Excel tetap seperti dulu: ruang kosong untuk pena.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { buildJadwalXlsx, buildKurvaPaketXlsx, buildPeriodReportXlsx, buildRencanaRealisasiXlsx } from "@/lib/export/xlsx";
import { buildDailyReportXlsx } from "@/lib/export/daily-xlsx";
import type { GambarTtdXlsx } from "@/lib/export/xlsx-gaya";
import type { PeriodItemRow, PeriodReport } from "@/lib/periodic-report";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { ringkasKelompok } from "@/lib/progress-calc";
import { ringkasCetak } from "./cetak-a4-bantu";


const item = (over: Partial<PeriodItemRow> & { no: number; name: string }): PeriodItemRow => ({
  code: "",
  volK: 100,
  unit: "m3",
  unitPrice: 250_000,
  amount: 25_000_000,
  bobot: 10,
  volLalu: 10,
  prestasiLalu: 10,
  bobotLalu: 1,
  volIni: 15,
  prestasiIni: 15,
  bobotIni: 1.5,
  volSd: 25,
  prestasiSd: 25,
  bobotSd: 2.5,
  bobotRencana: 3,
  sisaVol: 75,
  sisaPrestasi: 75,
  ...over,
});

function fixture(over?: Partial<PeriodReport>): PeriodReport {
  const start = new Date(Date.UTC(2026, 6, 22));
  const rows = [
    item({ no: 1, name: "Pembersihan lahan", volK: 120, unitPrice: 250_000, amount: 30_000_000 }),
    item({ no: 2, name: "Pengukuran & bouwplank", volK: 80, unitPrice: 250_000, amount: 20_000_000 }),
  ];
  return {
    kind: "mingguan",
    n: 2,
    maxN: 20,
    totalWeeks: 20,
    totalMonths: 5,
    header: {
      locationName: "Pasar Banggi",
      village: "Pasar Banggi",
      district: "Rembang",
      regency: "Rembang",
      province: "Jawa Tengah",
      packageName: "Pembangunan Kampung Nelayan Merah Putih – Pasar Banggi",
      ownerAgency: "Kementerian Kelautan dan Perikanan",
      contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
      vendorName: "PT Kurnia Alam Sentosa",
      contractValue: 5_872_342_857n,
      locationValue: 50_000_000n,
      masaPelaksanaanHari: 135,
      tahunAnggaran: 2026,
      contractStart: start,
      periodeStart: new Date(start.getTime() + 7 * 86_400_000),
      periodeEnd: new Date(start.getTime() + 13 * 86_400_000),
      ppkName: "Budi Santoso",
      ppkNip: "19800101 200501 1 001",
      weekMode: "tujuh_hari" as const,
      contractEnd: null,
      // Mingguan/bulanan kini diteken WAKIL SAH (2026-08-24) — fixture memakai
      // nama yang sama supaya assertion blok TTD tetap satu nama.
      wakilSahName: "Budi Santoso",
      wakilSahNip: "19800101 200501 1 001",
      supervisorName: "Rina Wijaya",
      supervisorFirm: "PT Konsultan Pengawas Nusantara",
      contractorSignerName: "Andi Prasetyo",
      contractorSignerTitle: "Direktur",
  pelaksanaName: "Joko Susilo",
  pelaksanaTitle: "Pelaksana Lapangan",
      supervisorFirmKontrak: "PT Konsultan Pengawas Nusantara",
      // Personel BANUSA (DECISIONS 662) – nama berbeda-beda supaya slot yang
      // salah orang langsung terlihat.
      coTeamLeaderName: "Sari Koordinator",
      teamLeaderName: "Teguh Ketua",
      projectManagerName: "Hadi Manajer",
    },
    categories: [
      {
        lineageKey: "I",
        code: "I",
        name: "PEKERJAAN PERSIAPAN",
        rows,
        subtotalAmount: 50_000_000,
        subtotalBobot: 20,
        subtotalBobotLalu: 2,
        subtotalBobotIni: 3,
        subtotalBobotSd: 5,
        subtotalBobotRencana: 6,
      },
    ],
    progresKategori: [],
    progresKategoriTotal: ringkasKelompok([]),
    realisasiKategoriMingguan: [],
    totals: { bobotLalu: 2, bobotIni: 3, bobotSd: 5, bobotRencana: 6 },
    planPct: 6,
    planPrevPct: 2.5,
    actualPct: 5,
    deviationPct: -1,
    scurve: { planPct: [2.5, 6], actualPct: [2, 5], currentWeek: 2 },
    kurvaSchedule: [{ lineageKey: "I", code: "I", name: "PEKERJAAN PERSIAPAN", weekly: Array.from({ length: 20 }, () => 1) }],
    tenaga: [],
    material: [],
    alat: [],
    cuacaRingkas: "Cerah 5 hari",
    kendala: [],
    ...over,
  };
}

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();

let GAMBAR: GambarTtdXlsx;
const TTD_W = 300;
const TTD_H = 120;

async function siapkanGambar() {
  if (GAMBAR) return GAMBAR;
  const [t, s] = await Promise.all([png(TTD_W, TTD_H), png(200, 200)]);
  GAMBAR = {
    ppk: { ttd: t, stempel: s },
    pengawas: { ttd: t, stempel: null },
    penyedia: { ttd: t, stempel: s },
  };
  return GAMBAR;
}

async function muat(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Baris (1-based) pertama yang memuat teks `cari`. */
function barisTeks(ws: ExcelJS.Worksheet, cari: RegExp): number {
  let hasil = 0;
  ws.eachRow((row, n) => {
    if (hasil) return;
    row.eachCell((c) => {
      if (!hasil && typeof c.value === "string" && cari.test(c.value)) hasil = n;
    });
  });
  return hasil;
}

/** Gambar di lembar ini yang jangkarnya di dalam blok tanda tangan. */
function gambarBlok(ws: ExcelJS.Worksheet, barisAtas: number, barisNama: number) {
  return ws
    .getImages()
    .map((g) => ({ row: g.range.tl.nativeRow + 1, ext: (g.range as unknown as { ext?: { width: number; height: number } }).ext }))
    .filter((g) => g.row >= barisAtas && g.row <= barisNama);
}

describe("laporan periodik mingguan", () => {
  it("SETIAP lembar ber-blok tanda tangan memuat 5 gambar: 3 coretan + 2 stempel", async () => {
    const wb = await muat(await buildPeriodReportXlsx(fixture(), { ttd: await siapkanGambar() }));
    const berblok = wb.worksheets.filter((ws) => barisTeks(ws, /^Mengetahui,$/) > 0);
    expect(berblok.map((ws) => ws.name).length, "lembar ber-blok tanda tangan").toBeGreaterThanOrEqual(3);
    for (const ws of berblok) {
      const atas = barisTeks(ws, /^Mengetahui,$/);
      const nama = barisTeks(ws, /^\( Budi Santoso \)$/);
      expect(nama, `${ws.name}: baris nama`).toBeGreaterThan(atas);
      expect(gambarBlok(ws, atas, nama), ws.name).toHaveLength(5);
      // Tidak lebih tinggi daripada ruang blok tanda tangan (DECISIONS 333).
      let ruang = 0;
      for (let r = atas; r < nama; r++) ruang += Math.round(((ws.getRow(r).height ?? 15) * 4) / 3);
      for (const g of gambarBlok(ws, atas, nama)) expect(g.ext!.height, `${ws.name}: tinggi gambar`).toBeLessThanOrEqual(ruang);
      // Tidak satu pun gambar menembus ke atas blok.
      const semua = ws.getImages().filter((g) => g.range.tl.nativeRow + 1 >= atas - 1);
      for (const g of semua) expect(g.range.tl.nativeRow + 1, `${ws.name}: gambar di atas blok`).toBeGreaterThanOrEqual(atas);
    }
  });

  it("rasio coretan dijaga, tidak diregangkan", async () => {
    const wb = await muat(await buildPeriodReportXlsx(fixture(), { ttd: await siapkanGambar() }));
    const ws = wb.getWorksheet("Laporan")!;
    const atas = barisTeks(ws, /^Mengetahui,$/);
    const nama = barisTeks(ws, /^\( Budi Santoso \)$/);
    const lebarTinggi = gambarBlok(ws, atas, nama)
      .map((g) => g.ext)
      .filter((e): e is { width: number; height: number } => !!e && e.width !== e.height);
    expect(lebarTinggi.length).toBe(3);
    for (const e of lebarTinggi) expect(e.width / e.height).toBeCloseTo(TTD_W / TTD_H, 1);
  });

  it("stempel ditempel LEBIH DULU, coretan sesudahnya – coretan di atas stempel (urutan PDF, DECISIONS 412)", async () => {
    const wb = await muat(await buildPeriodReportXlsx(fixture(), { ttd: await siapkanGambar() }));
    const ws = wb.getWorksheet("Laporan")!;
    const g = gambarBlok(ws, barisTeks(ws, /^Mengetahui,$/), barisTeks(ws, /^\( Budi Santoso \)$/)).map((x) =>
      x.ext && x.ext.width === x.ext.height ? "stempel" : "ttd",
    );
    // PPK: stempel, ttd · pengawas: ttd · penyedia: stempel, ttd
    expect(g).toEqual(["stempel", "ttd", "ttd", "stempel", "ttd"]);
  });

  it("tanda tangan KETIK (DECISIONS 763): setinggi coretan biasa, LEBARNYA mengikuti nama, tetap di dalam kolom", async () => {
    // Coretan biasa 300×120 (rasio 2,5) vs nama ketik memanjang 900×120 (rasio 7,5).
    const ketik = await png(900, 120);
    const g = await siapkanGambar();
    const dengan = (k: boolean) => ({
      ppk: { ...g.ppk, stempel: null },
      pengawas: { ttd: k ? ketik : g.pengawas.ttd, stempel: null, ttdKetik: k },
      penyedia: { ...g.penyedia, stempel: null },
    });
    const ukur = async (k: boolean) => {
      const wb = await muat(await buildPeriodReportXlsx(fixture(), { ttd: dengan(k) }));
      const ws = wb.getWorksheet("Laporan")!;
      return gambarBlok(ws, barisTeks(ws, /^Mengetahui,$/), barisTeks(ws, /^\( Budi Santoso \)$/)).map((x) => x.ext!);
    };
    const biasa = await ukur(false);
    const [ppk, pengawas] = await ukur(true);
    // Rasio nama dijaga, tidak diregangkan.
    expect(pengawas!.width / pengawas!.height).toBeCloseTo(900 / 120, 1);
    // Lebih lebar dari kotak coretan biasa (yang memaksanya mengecil).
    expect(pengawas!.width).toBeGreaterThan(biasa[1]!.width * 1.4);
    // Tingginya tidak melebihi coretan biasa, jadi tidak menembus ke atas.
    expect(pengawas!.height).toBeLessThanOrEqual(ppk!.height + 1);
  });

  it("tanpa berkas: tidak ada gambar di blok tanda tangan (ruang pena seperti dulu)", async () => {
    const wb = await muat(await buildPeriodReportXlsx(fixture()));
    const ws = wb.getWorksheet("Laporan")!;
    expect(gambarBlok(ws, barisTeks(ws, /^Mengetahui,$/), barisTeks(ws, /^\( Budi Santoso \)$/))).toHaveLength(0);
  });
});

describe("dokumen Excel lain yang PDF-nya bertanda tangan", () => {
  it("Time Schedule (jadwal) dan rencana-realisasi mingguan", async () => {
    const g = await siapkanGambar();
    for (const buf of [await buildJadwalXlsx(fixture(), { ttd: g }), await buildRencanaRealisasiXlsx(fixture(), { ttd: g })]) {
      const wb = await muat(buf);
      const ws = wb.worksheets.find((w) => barisTeks(w, /^Mengetahui,$/) > 0)!;
      expect(ws).toBeDefined();
      const atas = barisTeks(ws, /^Mengetahui,$/);
      expect(gambarBlok(ws, atas, atas + 12).length, ws.name).toBeGreaterThanOrEqual(5);
    }
  });

  it("laporan harian: tiga pihak blanko KKP ikut bertanda tangan", async () => {
    const d: KkpDailyData = {
      locationName: "Batah Timur",
      regency: "Bangkalan",
      province: "Jawa Timur",
      hari: "Senin",
      tanggalFull: "3 Agustus 2026",
      weekNo: 16,
      tahunAnggaran: 2026,
      workerMap: {},
      totalWorkers: 0,
      activeWeather: "Cerah",
      weatherByHour: {},
      workStart: "08:00",
      workEnd: "16:00",
      notes: "",
      materials: [],
      equipment: [],
      items: [],
      isFinal: true,
      draftItemCount: 0,
      rencana: [],
      pekerjaan: "Pembangunan KNMP Batah Timur",
      ownerName: "Kementerian Kelautan dan Perikanan",
      ownerSubtitle: "Ditjen Perikanan Tangkap",
      supervisorName: "Andi",
      supervisorFirm: "CV Pengawas Jaya",
      contractorName: "Rudi",
      contractorFirm: "PT Nusantara Bahari Utama",
      contractorSub: "Site Manager",
    } as KkpDailyData;
    const wb = await muat(await buildDailyReportXlsx(d, { ttd: await siapkanGambar() }));
    const ws = wb.worksheets[0]!;
    const atas = barisTeks(ws, /^Mengetahui :$/);
    const nama = barisTeks(ws, /^\( Rudi \)$/);
    expect(nama).toBeGreaterThan(atas);
    expect(gambarBlok(ws, atas, nama)).toHaveLength(5);
  });
});

describe("cetak A4 (DECISIONS 762)", () => {
  it("jadwal dan rencana-realisasi: A4, orientasi menurut lebar isinya", async () => {
    expect(ringkasCetak(await muat(await buildJadwalXlsx(fixture())))).toEqual({ "Time Schedule": "A4 landscape 1×n" });
    expect(ringkasCetak(await muat(await buildRencanaRealisasiXlsx(fixture())))).toEqual({
      "Rencana vs Realisasi": "A4 landscape 1×n",
    });
  });
});

describe("Kurva S paket gabungan: PPK dan penyedia saja (DECISIONS 764)", () => {
  /** Teks semua sel lembar, satu larik. */
  const teksLembar = (ws: ExcelJS.Worksheet) => {
    const out: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => typeof c.value === "string" && out.push(c.value)));
    return out;
  };
  // Wakil Sah berbeda dari PPK supaya yang tercetak terbukti PPK, bukan WSP lokasi acuan.
  const f = () => {
    const r = fixture();
    return { ...r, header: { ...r.header, wakilSahName: "Wakil Sah Lokasi Acuan" } };
  };

  it("dua blok: Mengetahui (PPK kontrak) dan Dibuat Oleh (Manajer Proyek); tanpa konsultan, tanpa Wakil Sah", async () => {
    const wb = await muat(await buildKurvaPaketXlsx(f(), { jenis: "kurva_paket", ttd: await siapkanGambar() }));
    const ws = wb.getWorksheet("Kurva S Paket")!;
    const t = teksLembar(ws);
    expect(t).toContain("Mengetahui,");
    expect(t).toContain("Dibuat Oleh,");
    expect(t).not.toContain("Diperiksa,");
    expect(t).toContain("( Budi Santoso )");
    expect(t).toContain("( Hadi Manajer )");
    expect(t.join("|")).not.toMatch(/Wakil Sah Lokasi Acuan|Sari Koordinator|Konsultan Pengawas/);
    // Gambar: coretan + stempel PPK, coretan + stempel penyedia – konsultan tidak ada.
    const atas = barisTeks(ws, /^Mengetahui,$/);
    expect(gambarBlok(ws, atas, atas + 12)).toHaveLength(4);
  });

  it("bawaan (satu lokasi) tetap tiga pihak lokasi itu", async () => {
    const wb = await muat(await buildKurvaPaketXlsx(f(), { ttd: await siapkanGambar() }));
    const ws = wb.getWorksheet("Kurva S Paket")!;
    const t = teksLembar(ws);
    expect(t).toContain("Diperiksa,");
    expect(t).toContain("( Wakil Sah Lokasi Acuan )");
    const atas = barisTeks(ws, /^Mengetahui,$/);
    expect(gambarBlok(ws, atas, atas + 12)).toHaveLength(5);
  });
});

