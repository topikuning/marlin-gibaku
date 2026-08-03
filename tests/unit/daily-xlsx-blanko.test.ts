// EKSPOR EXCEL LAPORAN HARIAN — harus mengikuti blanko yang SAMA dengan PDF.
//
// Laporan user 2026-08-03: *"format excel laporan harianmu belum menyesuaikan
// format pdf terakhir"*. Excel dan PDF sempat menyimpang karena masing-masing
// menyusun barisnya sendiri; uji ini mengunci keduanya ke satu sumber.
// DECISIONS 241.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { barisRencanaRealisasi, type KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";
import { KKP_WEATHER_HOURS } from "@/lib/weather/hourly";

const { buildDailyReportXlsx } = await import("@/lib/export/daily-xlsx");

const DATA: KkpDailyData = {
  locationName: "Batah Timur",
  regency: "Bangkalan",
  province: "Jawa Timur",
  hari: "Senin",
  tanggalFull: "3 Agustus 2026",
  weekNo: 16,
  tahunAnggaran: 2026,
  workerMap: { mandor: 2, tukang_batu: 8 },
  totalWorkers: 10,
  activeWeather: "Cerah",
  weatherByHour: { 7: "Cerah", 8: "Cerah", 13: "Hujan", 14: "Hujan" },
  workStart: "08:00",
  workEnd: "16:00",
  notes: "Pengecoran sloof selesai.",
  materials: [{ name: "Semen", unit: "sak", qty: 40 }],
  equipment: [{ name: "Molen", count: 2 }],
  items: [
    {
      code: "1.1",
      name: "Galian tanah",
      unit: "m3",
      categoryCode: "I",
      categoryName: "RUMAH NELAYAN",
      volumeContract: 100,
      volumeBefore: 20,
      volumeToday: 15,
      volumeCumulative: 35,
      pctCumulative: 35,
    },
    {
      code: "2.1",
      name: "Pembesian",
      unit: "kg",
      categoryCode: "II",
      categoryName: "DERMAGA",
      volumeContract: 500,
      volumeBefore: 0,
      volumeToday: 120,
      volumeCumulative: 120,
      pctCumulative: 24,
    },
  ],
  isFinal: true,
  draftItemCount: 2,
  rencana: [{ name: "Galian tanah", unit: "m3", volume: 20, picName: "Budi" }],
  pekerjaan: "Pembangunan KNMP Batah Timur",
  ownerName: "Kementerian Kelautan dan Perikanan",
  ownerSubtitle: "Ditjen Perikanan Tangkap",
  supervisorName: "Andi",
  supervisorFirm: "CV Pengawas Jaya",
  contractorName: "Rudi",
  contractorFirm: "PT Nusantara Bahari Utama",
  contractorSub: "Site Manager",
};

async function lembar(d: KkpDailyData = DATA) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildDailyReportXlsx(d)) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  const teks: string[] = [];
  const nilai = new Map<string, ExcelJS.CellValue>();
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      nilai.set(`${r}:${c}`, cell.value);
      if (typeof cell.value === "string") teks.push(cell.value);
    });
  });
  return { ws, teks, nilai, semua: teks.join("\n") };
}

describe("blok blanko hadir dan berurutan seperti PDF", () => {
  it("semua judul blok ada", async () => {
    const { semua } = await lembar();
    for (const judul of [
      "LAPORAN HARIAN",
      "KONSULTAN PENGAWAS",
      "KONTRAKTOR PELAKSANA",
      "PEKERJAAN",
      "TH. ANGGARAN",
      "TENAGA KERJA",
      "REKAP PEMASUKAN BAHAN / MATERIAL",
      "PERALATAN",
      "KONDISI CUACA",
      "Shop Drawing",
      "Jam Kerja",
      "RENCANA PEKERJAAN",
      "REALISASI PEKERJAAN",
      "CATATAN / KETERANGAN",
    ]) {
      expect(semua, `blok "${judul}" hilang`).toContain(judul);
    }
  });

  it("urutannya sama dengan blanko", async () => {
    const { teks } = await lembar();
    const urut = [
      "LAPORAN HARIAN",
      "TENAGA KERJA",
      "KONDISI CUACA",
      "Jam Kerja",
      "RENCANA PEKERJAAN",
      "CATATAN / KETERANGAN",
    ].map((j) => teks.indexOf(j));
    expect(urut.every((x) => x >= 0)).toBe(true);
    expect(urut).toEqual([...urut].sort((a, b) => a - b));
  });

  it("blok tambahan MARLIN diletakkan PALING BAWAH, tidak menggeser blanko", async () => {
    const { teks } = await lembar();
    expect(teks.findIndex((t) => t.startsWith("RINCIAN KEMAJUAN PEKERJAAN"))).toBeGreaterThan(
      teks.indexOf("CATATAN / KETERANGAN"),
    );
  });
});

describe("identitas: dari data, bukan ditanam di kode", () => {
  it("memakai nama pemberi kerja dari Sistem", async () => {
    const { semua } = await lembar();
    expect(semua).toContain("Kementerian Kelautan dan Perikanan");
    // Versi lama menanam "Kampung Nelayan Merah Putih (KNMP)" di kode
    // (melanggar DECISIONS 166) — tidak boleh muncul lagi sebagai kop.
    expect(semua).not.toContain("Kampung Nelayan Merah Putih (KNMP)");
  });

  it("judul pekerjaan, perusahaan pengawas & pelaksana ikut tercetak", async () => {
    const { semua } = await lembar();
    expect(semua).toContain("Pembangunan KNMP Batah Timur");
    expect(semua).toContain("CV Pengawas Jaya");
    expect(semua).toContain("PT Nusantara Bahari Utama");
  });

  it("blok tanda tangan ada berikut namanya", async () => {
    const { semua } = await lembar();
    expect(semua).toContain("Disetujui Oleh;");
    expect(semua).toContain("Dibuat Oleh :");
    expect(semua).toContain("( Andi )");
    expect(semua).toContain("( Rudi )");
  });

  it("penanda tangan kosong jadi garis isian, bukan hilang", async () => {
    const { semua } = await lembar({ ...DATA, supervisorName: null, contractorName: null });
    expect(semua).toContain("( …………………… )");
  });
});

describe("RENCANA | REALISASI dipinjam dari modul cetak", () => {
  it("teks barisnya sama persis dengan yang dipakai PDF", async () => {
    const { semua } = await lembar();
    for (const b of barisRencanaRealisasi(DATA)) {
      if (b.rencana) expect(semua, `rencana "${b.rencana}"`).toContain(b.rencana);
      if (b.realisasi) expect(semua, `realisasi "${b.realisasi}"`).toContain(b.realisasi);
    }
  });

  it("judul bangunan/kategori ikut, bukan cuma nama pekerjaan", async () => {
    // Satu lokasi punya belasan bangunan dengan nama item yang kerap sama.
    const { semua } = await lembar();
    expect(semua).toContain("I. RUMAH NELAYAN");
    expect(semua).toContain("II. DERMAGA");
  });

  it("pekerjaan basis draft adendum disebut jumlahnya, tidak hilang diam-diam", async () => {
    const { semua } = await lembar();
    expect(semua).toContain("2 pekerjaan hari ini dilaporkan atas usulan adendum");
  });
});

describe("tenaga kerja & cuaca mengikuti blanko", () => {
  it("SELURUH keahlian didaftar termasuk yang nol", async () => {
    const { semua } = await lembar();
    for (const wr of WORKER_ROLE_ORDER) expect(semua, WORKER_ROLE_LABEL[wr]).toContain(WORKER_ROLE_LABEL[wr]);
    // Versi lama melewati keahlian bernilai 0 — barisnya hilang, dan itu
    // terbaca "keahlian ini tidak dipakai".
    const kosong = WORKER_ROLE_ORDER.find((wr) => !DATA.workerMap[wr]);
    expect(kosong).toBeDefined();
    expect(semua).toContain(WORKER_ROLE_LABEL[kosong!]);
  });

  it("kolom jam 07.00–21.00 lengkap", async () => {
    const { semua } = await lembar();
    for (const h of KKP_WEATHER_HOURS) expect(semua).toContain(`${String(h).padStart(2, "0")}.00`);
  });

  it("centang cuaca mengikuti kondisi PER JAM, bukan satu kategori sehari", async () => {
    const { ws } = await lembar();
    // Cari baris "Hujan" lalu periksa kolom jam 13 tercentang & jam 7 tidak.
    let barisHujan = -1;
    ws.eachRow((row, r) => {
      if (row.getCell(1).value === "Hujan") barisHujan = r;
    });
    expect(barisHujan).toBeGreaterThan(0);
    const kolomJam = (h: number) => 3 + KKP_WEATHER_HOURS.indexOf(h);
    expect(ws.getCell(barisHujan, kolomJam(13)).value).toBe("✓");
    expect(ws.getCell(barisHujan, kolomJam(7)).value ?? "").toBe("");
  });

  it("material menyediakan kolom Ditolak dan baris kosong siap isi", async () => {
    const { semua, ws } = await lembar();
    expect(semua).toContain("Ditolak");
    // Blanko punya minimal 8 baris material walau datanya cuma satu.
    let barisNo8 = false;
    ws.eachRow((row) => {
      if (row.getCell(8).value === 8) barisNo8 = true;
    });
    expect(barisNo8, "baris material ke-8 harus tetap ada").toBe(true);
  });
});

describe("pratinjau ditandai", () => {
  it("laporan belum final memuat peringatan", async () => {
    const { semua } = await lembar({ ...DATA, isFinal: false });
    expect(semua).toContain("PRATINJAU");
  });

  it("laporan final tidak memuatnya", async () => {
    const { semua } = await lembar();
    expect(semua).not.toContain("PRATINJAU");
  });
});
