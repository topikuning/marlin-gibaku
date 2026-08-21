// Workbook laporan periodik versi KKP (DECISIONS 265) — permintaan user
// 2026-08-06: "buat versi excelnya persis seperti ini … yang kurang dari sheet
// laporanmu hanyalah informasi harga satuan dan harga total … yang perlu kamu
// buat baru cuma sheet COV-BQ dan REKAP", lalu "hanya fokus pada bagian yang
// tidak dihidden".
//
// Yang dikunci berkas ini semuanya cacat SENYAP — berkasnya tetap terbuka,
// tetap rapi, dan tetap bisa diunggah ke PPK:
//
//  1. sheet wajib hilang / salah urut → pemeriksa membuka berkas yang tidak
//     sama bentuknya dengan blanko yang mereka pegang;
//  2. harga ditulis sebagai TEKS berformat → kolomnya tidak bisa dijumlah,
//     padahal itu satu-satunya alasan kolom harga diminta;
//  3. angka agregat ditempel, bukan tertaut → rekap bisa berbeda dari rincian
//     tanpa ada yang salah kelihatan;
//  4. REKAP diam-diam menumbuhkan kolom rupiah → menampilkan angka yang pada
//     berkas resmi justru disembunyikan;
//  5. blok tanda tangan hilang → dokumen tidak bisa disahkan.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildPeriodReportXlsx } from "@/lib/export/xlsx";
import type { LogoLaporan } from "@/lib/export/logo-laporan";
import type { PeriodItemRow, PeriodReport } from "@/lib/periodic-report";

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
      supervisorName: "Rina Wijaya",
      supervisorFirm: "PT Konsultan Pengawas Nusantara",
      contractorSignerName: "Andi Prasetyo",
      contractorSignerTitle: "Direktur",
  pelaksanaName: "Joko Susilo",
  pelaksanaTitle: "Pelaksana Lapangan",
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

async function book(over?: Partial<PeriodReport>, logo?: LogoLaporan) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildPeriodReportXlsx(fixture(over), { logo })) as unknown as ArrayBuffer);
  return wb;
}

/**
 * PNG 1×1 sungguhan — cukup untuk membuktikan gambarnya benar-benar ditulis ke
 * berkas. Ukuran width/height sengaja BERBEDA antar logo supaya kalau rasio
 * diregangkan paksa, hasilnya kelihatan.
 */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const LOGO: LogoLaporan = {
  pemilik: { buffer: PNG_1PX, width: 240, height: 120 },
  kontraktor: { buffer: PNG_1PX, width: 100, height: 200 },
};

/** Gambar yang benar-benar tertanam pada satu sheet. */
const gambar = (ws: ExcelJS.Worksheet) => ws.getImages();

const teks = (v: ExcelJS.CellValue): string =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && "richText" in v
      ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("")
      : String(v ?? "");

/** Semua teks sheet, digabung — untuk memastikan sesuatu ADA, bukan letaknya. */
function semuaTeks(ws: ExcelJS.Worksheet): string {
  const out: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => out.push(teks(cell.value)));
  });
  return out.join("\n");
}

function cariBaris(ws: ExcelJS.Worksheet, cocok: (t: string) => boolean, kolom = 1): number {
  let found = 0;
  ws.eachRow((row, r) => {
    if (!found && cocok(teks(row.getCell(kolom).value))) found = r;
  });
  return found;
}

describe("urutan & kelengkapan sheet", () => {
  it("empat sheet, urut seperti dokumen cetak KKP", async () => {
    const wb = await book();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["COV-BQ", "REKAP", "Kurva S", "Laporan"]);
  });
});

describe("sheet COV-BQ (sampul)", () => {
  it("menyebut periode, kegiatan, pemberi tugas, lokasi, tahun, dan pelaksana", async () => {
    const t = semuaTeks((await book()).getWorksheet("COV-BQ")!);
    expect(t).toContain("LAPORAN PROGRES MINGGU KE-2");
    expect(t).toContain("SATUAN KERJA");
    expect(t).toContain("PEMBANGUNAN KAMPUNG NELAYAN MERAH PUTIH – PASAR BANGGI");
    expect(t).toContain("KEMENTERIAN KELAUTAN DAN PERIKANAN");
    expect(t).toContain("LOKASI PEKERJAAN");
    // Nama desa yang sama dengan nama lokasi tidak diulang.
    expect(t).toContain("PASAR BANGGI – KEC. REMBANG, REMBANG, JAWA TENGAH");
    expect(t).toContain("TAHUN 2026");
    expect(t).toContain("KONTRAKTOR PELAKSANA");
    expect(t).toContain("PT Kurnia Alam Sentosa");
    expect(t).toContain("B.17105/DJPT.6/PI.420/PPK/VI/2026");
  });

  it("judul laporan bulanan menyebut BULAN, bukan minggu", async () => {
    const t = semuaTeks((await book({ kind: "bulanan", n: 3 })).getWorksheet("COV-BQ")!);
    expect(t).toContain("LAPORAN PROGRES BULAN KE-3");
    expect(t).not.toContain("MINGGU KE-");
  });
});

describe("sheet REKAP", () => {
  const kepala = async () => {
    const ws = (await book()).getWorksheet("REKAP")!;
    const r = cariBaris(ws, (t) => t === "NO");
    return { ws, r };
  };

  it("kolomnya persis enam dan MURNI BOBOT – tidak ada kolom rupiah", async () => {
    const { ws, r } = await kepala();
    expect(r).toBeGreaterThan(0);
    const head = ws.getRow(r);
    expect([1, 2, 3, 4, 5, 6].map((c) => teks(head.getCell(c).value))).toEqual([
      "NO",
      "JENIS PEKERJAAN",
      "BOBOT PEKERJAAN (%)",
      "BOBOT MINGGU LALU (%)",
      "BOBOT MINGGU INI (%)",
      "BOBOT KOMULATIF (%)",
    ]);
    // Kolom ke-7 harus kosong: pada berkas KKP kolom Nilai HPS/Penawaran/
    // Negosiasi memang disembunyikan, jadi rekap yang berlaku tanpa rupiah.
    expect(teks(head.getCell(7).value)).toBe("");
    expect(semuaTeks(ws)).not.toMatch(/\bHPS\b|Penawaran|Negosiasi|PPN/i);
  });

  it("bobot komulatif = rumus (lalu + ini), bukan angka tempelan", async () => {
    const { ws, r } = await kepala();
    const baris = ws.getRow(r + 1);
    const kum = baris.getCell(6).value as { formula?: string; result?: number };
    expect(kum.formula).toBe(`D${r + 1}+E${r + 1}`);
    expect(kum.result).toBeCloseTo(
      Number(baris.getCell(4).value) + Number(baris.getCell(5).value),
      6,
    );
  });

  it("TOTAL = SUM baris kategori", async () => {
    const ws = (await book()).getWorksheet("REKAP")!;
    const rTotal = cariBaris(ws, (t) => t === "TOTAL", 2);
    expect(rTotal).toBeGreaterThan(0);
    for (const col of [3, 4, 5, 6]) {
      const v = ws.getRow(rTotal).getCell(col).value as { formula?: string };
      expect(v.formula, `kolom ${col}`).toMatch(/^SUM\(/);
    }
  });

  it("realisasi & deviasi TERTAUT ke TOTAL tabel, bukan diketik ulang", async () => {
    const ws = (await book()).getWorksheet("REKAP")!;
    const rTotal = cariBaris(ws, (t) => t === "TOTAL", 2);
    const rRealIni = cariBaris(ws, (t) => t.startsWith("REALISASI PROGRES"));
    const rRealKum = cariBaris(ws, (t) => t === "AKUMULASI REALISASI PROGRES");
    const rRencanaKum = cariBaris(ws, (t) => t === "AKUMULASI PROGRES RENCANA");
    const rDev = cariBaris(ws, (t) => t.startsWith("DEVIASI"));

    expect((ws.getRow(rRealIni).getCell(5).value as { formula?: string }).formula).toBe(`E${rTotal}`);
    expect((ws.getRow(rRealKum).getCell(5).value as { formula?: string }).formula).toBe(`F${rTotal}`);
    const dev = ws.getRow(rDev).getCell(5).value as { formula?: string; result?: number };
    expect(dev.formula).toBe(`E${rRealKum}-E${rRencanaKum}`);
    expect(dev.result).toBeCloseTo(-1, 6);
  });

  it("deviasi negatif DIKATAKAN terlambat – angka minus saja tidak terbaca", async () => {
    const ws = (await book()).getWorksheet("REKAP")!;
    expect(cariBaris(ws, (t) => t === "DEVIASI – TERLAMBAT")).toBeGreaterThan(0);
  });

  it("deviasi positif tidak ditulis terlambat", async () => {
    const ws = (
      await book({ deviationPct: 2.4, actualPct: 8.4, totals: { bobotLalu: 2, bobotIni: 3, bobotSd: 8.4, bobotRencana: 6 } })
    ).getWorksheet("REKAP")!;
    expect(cariBaris(ws, (t) => t === "DEVIASI – LEBIH CEPAT")).toBeGreaterThan(0);
  });

  it("progres rencana periode ini = selisih kumulatif rencana, bukan kumulatifnya", async () => {
    const ws = (await book()).getWorksheet("REKAP")!;
    const r = cariBaris(ws, (t) => t.startsWith("PROGRES RENCANA"));
    // planPct 6 − planPrevPct 2,5 = 3,5. Menulis 6 di sini akan membuat rencana
    // mingguan terbaca sebesar kumulatifnya.
    expect(Number(ws.getRow(r).getCell(5).value)).toBeCloseTo(3.5, 6);
  });

  it("memuat identitas paket & pengawas", async () => {
    const t = semuaTeks((await book()).getWorksheet("REKAP")!);
    expect(t).toContain("Kementerian Kelautan dan Perikanan");
    expect(t).toContain("PT Konsultan Pengawas Nusantara");
    expect(t).toContain("2 dari 20");
  });
});

describe("sheet Laporan – kolom harga", () => {
  const laporan = async () => (await book()).getWorksheet("Laporan")!;

  it("kepala tabel memuat Harga Satuan & Harga Total tepat setelah Satuan", async () => {
    const ws = await laporan();
    const r = cariBaris(ws, (t) => t === "No");
    expect(r).toBeGreaterThan(0);
    const head = ws.getRow(r);
    expect(teks(head.getCell(4).value)).toBe("Satuan");
    expect(teks(head.getCell(5).value)).toBe("Harga Satuan (Rp)");
    expect(teks(head.getCell(6).value)).toBe("Harga Total (Rp)");
    expect(teks(head.getCell(7).value)).toBe("Bobot");
  });

  it("harga ditulis sebagai ANGKA + numFmt, bukan teks berformat", async () => {
    const ws = await laporan();
    const rItem = cariBaris(ws, (t) => t === "1");
    const satuan = ws.getRow(rItem).getCell(5);
    expect(typeof satuan.value).toBe("number");
    expect(satuan.value).toBe(250_000);
    expect(satuan.numFmt).toContain("#,##0");
  });

  it("harga total = rumus volume × harga satuan, cache = amount RAB", async () => {
    const ws = await laporan();
    const rItem = cariBaris(ws, (t) => t === "1");
    const total = ws.getRow(rItem).getCell(6).value as { formula?: string; result?: number };
    expect(total.formula).toBe(`C${rItem}*E${rItem}`);
    expect(total.result).toBe(30_000_000);
  });

  it("JUMLAH kolom Harga Total menjumlah subtotal kategori", async () => {
    const ws = await laporan();
    const rJumlah = cariBaris(ws, (t) => t === "JUMLAH", 2);
    const v = ws.getRow(rJumlah).getCell(6).value as { formula?: string; result?: number };
    expect(v.formula).toBeTruthy();
    expect(v.result).toBe(50_000_000);
  });
});

describe("blok tanda tangan", () => {
  it("Time Schedule BERDIRI SENDIRI tetap diteken Direktur", async () => {
    /*
     * Sisi lain dari ketetapan yang sama, dan yang membuatnya berarti: lembar
     * kurva-S yang SAMA berpindah penanda tangan menurut dokumen tempat ia
     * berada. Tanpa uji ini, "ikut laporan" bisa hijau hanya karena semuanya
     * ikut pelaksana.
     */
    const { buildJadwalXlsx } = await import("@/lib/export/xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildJadwalXlsx(fixture({ kind: "mingguan" }))) as unknown as ArrayBuffer);
    const t = semuaTeks(wb.getWorksheet("Time Schedule")!);
    expect(t).toContain("( Andi Prasetyo )");
    expect(t).not.toContain("( Joko Susilo )");
  });

  it("ada di Laporan, Kurva S, dan REKAP – dengan tiga pihak", async () => {
    const wb = await book();
    for (const nama of ["Laporan", "Kurva S", "REKAP"]) {
      const t = semuaTeks(wb.getWorksheet(nama)!);
      expect(t, `${nama}: mengetahui`).toContain("Mengetahui,");
      expect(t, `${nama}: diperiksa`).toContain("Diperiksa,");
      expect(t, `${nama}: dibuat`).toContain("Dibuat Oleh,");
      expect(t, `${nama}: ppk`).toContain("( Budi Santoso )");
      expect(t, `${nama}: nip`).toContain("NIP. 19800101 200501 1 001");
      expect(t, `${nama}: pengawas`).toContain("( Rina Wijaya )");
      expect(t, `${nama}: tempat & tanggal`).toContain("Rembang, 4 Agustus 2026");
    }
  });

  /*
   * SIAPA yang mengisi slot "Dibuat Oleh" bergantung jenis laporannya
   * (DECISIONS 402). Uji ini sebelumnya menuntut nama DIREKTUR pada laporan
   * MINGGUAN — yaitu keadaan yang justru diperbaiki: laporan yang dibuat dan
   * diteken orang lapangan menyatakan direktur sebagai pembuatnya.
   *
   * Sheet "Kurva S" IKUT DIPERIKSA. Ketetapan user 2026-08-21: *"kurva s yang
   * menyatu dalam laporan mingguan adalah laporan mingguan, jangan
   * campuradukkan dengan kurva s sebagai jadwal."* Yang tetap memakai direktur
   * adalah Time Schedule berdiri sendiri (`buildJadwalXlsx`), diuji terpisah.
   */
  it("MINGGUAN dibuat oleh Pelaksana Lapangan, bukan Direktur", async () => {
    const wb = await book({ kind: "mingguan" });
    for (const nama of ["Laporan", "REKAP", "Kurva S"]) {
      const t = semuaTeks(wb.getWorksheet(nama)!);
      expect(t, `${nama}: pelaksana`).toContain("( Joko Susilo )");
      expect(t, `${nama}: bukan direktur`).not.toContain("( Andi Prasetyo )");
    }
  });

  it("BULANAN tetap dibuat oleh Direktur", async () => {
    const wb = await book({ kind: "bulanan" });
    for (const nama of ["Laporan", "REKAP", "Kurva S"]) {
      const t = semuaTeks(wb.getWorksheet(nama)!);
      expect(t, `${nama}: direktur`).toContain("( Andi Prasetyo )");
      expect(t, `${nama}: bukan pelaksana`).not.toContain("( Joko Susilo )");
    }
  });

  it("penanda tangan yang belum diisi jadi GARIS TITIK, bukan hilang", async () => {
    const wb = await book({
      header: {
        ...fixture().header,
        ppkName: null,
        ppkNip: null,
        supervisorName: null,
        contractorSignerName: null,
      },
    });
    const t = semuaTeks(wb.getWorksheet("Laporan")!);
    expect(t).toContain("( ……………………………………… )");
    expect(t).not.toContain("( null )");
  });
});

describe("logo kop – TATA LETAK dari berkas acuan", () => {
  // Koreksi user 2026-08-06, dua kali. Pertama: "aku sudah berikan contoh bahwa
  // itu ada logo KKP (Pemilik Pekerjaan) dan kontraktor. kenapa itu kamu
  // hilangkan?" Lalu, setelah kupasang kiri–kanan: "SIAPA YANG MENYURUHMU TARUH
  // DI ATAS KANAN DAN KIRI. DI CONTOH SUDAH ADA SEMUA TATA LETAKNYA."
  //
  // Tata letak yang BERLAKU, dari berkas acuan:
  //   COV-BQ    → logo pemilik di puncak (tengah); logo kontraktor di tengah,
  //               tepat di atas keterangan "KONTRAKTOR PELAKSANA";
  //   REKAP     → pasangan logo BERJAJAR di kanan blok identitas;
  //   Kurva S   → pasangan logo BERJAJAR di kanan, sejajar judul;
  //   Laporan   → TANPA logo (di berkas acuan sheet RAB pun tidak berkop).

  const posisi = (ws: ExcelJS.Worksheet) =>
    ws.getImages().map((i) => {
      const tl = i.range.tl as unknown as { nativeCol: number; nativeRow: number };
      const ext = (i.range as { ext?: { width: number; height: number } }).ext!;
      return { col: tl.nativeCol, row: tl.nativeRow, w: ext.width, h: ext.height };
    });

  it("COV-BQ memuat KEDUA logo, TERSUSUN ATAS–BAWAH (bukan kiri–kanan)", async () => {
    const p = posisi((await book(undefined, LOGO)).getWorksheet("COV-BQ")!);
    expect(p).toHaveLength(2);
    // Pemilik jauh di atas kontraktor — itulah yang membedakan tata letak sampul
    // dari susunan kiri-kanan yang kukarang sebelumnya.
    expect(p[0].row).toBeLessThan(p[1].row);
  });

  it("kedua logo sampul TERPUSAT pada blok isi", async () => {
    const ws = (await book(undefined, LOGO)).getWorksheet("COV-BQ")!;
    // Blok isi sampul = kolom 2..7. Titik tengahnya dihitung dari lebar kolom.
    const px = (c: number) => Math.round((ws.getColumn(c).width ?? 8.43) * 7 + 5);
    let xBlokKiri = 0;
    for (let c = 1; c < 2; c++) xBlokKiri += px(c);
    let xBlokKanan = 0;
    for (let c = 1; c <= 7; c++) xBlokKanan += px(c);
    const tengahBlok = (xBlokKiri + xBlokKanan) / 2;

    for (const img of ws.getImages()) {
      const tl = img.range.tl as unknown as { nativeCol: number; nativeColOff: number };
      const ext = (img.range as unknown as { ext: { width: number } }).ext;
      let x = 0;
      for (let c = 1; c <= tl.nativeCol; c++) x += px(c);
      x += (tl.nativeColOff ?? 0) / 9525;
      expect(x + ext.width / 2, "titik tengah logo").toBeCloseTo(tengahBlok, -1);
    }
  });

  it("REKAP: pasangan logo BERJAJAR di kanan – baris sama, kolom berbeda", async () => {
    const p = posisi((await book(undefined, LOGO)).getWorksheet("REKAP")!);
    expect(p).toHaveLength(2);
    expect(p[0].row).toBe(p[1].row);
    expect(p[0].col).toBeLessThan(p[1].col);
  });

  it("Kurva S: pasangan logo BERJAJAR di kanan", async () => {
    const p = posisi((await book(undefined, LOGO)).getWorksheet("Kurva S")!);
    expect(p).toHaveLength(2);
    expect(p[0].row).toBe(p[1].row);
    expect(p[0].col).toBeLessThan(p[1].col);
  });

  it("sheet Laporan (RAB) TANPA logo – berkas acuan pun begitu", async () => {
    expect(posisi((await book(undefined, LOGO)).getWorksheet("Laporan")!)).toHaveLength(0);
  });

  it("RASIO gambar dijaga – logo tidak diregangkan ke kotak seragam", async () => {
    // pemilik 240×120 (2:1) dan kontraktor 100×200 (1:2). Kalau keduanya
    // dipaksa ke kotak yang sama, logo perusahaan jadi gepeng/melar.
    const p = posisi((await book(undefined, LOGO)).getWorksheet("REKAP")!);
    expect(p[0].w / p[0].h).toBeCloseTo(240 / 120, 2);
    expect(p[1].w / p[1].h).toBeCloseTo(100 / 200, 2);
  });

  it("logo yang BELUM diunggah hanya dilewati – berkas tetap terbit", async () => {
    // Kotak kosong atau teks pengganti lebih buruk daripada tidak ada apa-apa:
    // sisi yang kosong memang berarti logonya belum diunggah.
    const wb = await book(undefined, { pemilik: LOGO.pemilik, kontraktor: null });
    expect(posisi(wb.getWorksheet("COV-BQ")!)).toHaveLength(1);
    expect(posisi(wb.getWorksheet("REKAP")!)).toHaveLength(1);
  });

  it("nama kontraktor tetap tertulis di sampul walau logonya belum ada", async () => {
    // Di berkas acuan pelaksana dikenali dari logonya. Tanpa baris nama, sampul
    // tanpa logo tidak menyebut pelaksananya sama sekali.
    const wb = await book(undefined, { pemilik: LOGO.pemilik, kontraktor: null });
    const t = semuaTeks(wb.getWorksheet("COV-BQ")!);
    expect(t).toContain("KONTRAKTOR PELAKSANA");
    expect(t).toContain("PT Kurnia Alam Sentosa");
  });

  it("tanpa logo sama sekali, seluruh sheet tetap terbentuk", async () => {
    const wb = await book();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["COV-BQ", "REKAP", "Kurva S", "Laporan"]);
    expect(posisi(wb.getWorksheet("COV-BQ")!)).toHaveLength(0);
  });
});

describe("grafik kurva-S hidup berdampingan dengan logo", () => {
  // Satu worksheet HANYA boleh menunjuk SATU drawing part (OOXML). Penyisip
  // grafik dulu menulis paksa `drawing1.xml`, yang begitu ada logo berarti:
  // logo sampul tertimpa, ATAU grafiknya yang tidak jadi disisipkan. Dua-duanya
  // gagal senyap — berkasnya tetap terbuka, angkanya tetap benar.
  const zipDari = async (logo?: LogoLaporan) =>
    JSZip.loadAsync(await buildPeriodReportXlsx(fixture(), { logo }));

  it("part grafik tetap ditulis walau semua sheet berlogo", async () => {
    const zip = await zipDari(LOGO);
    expect(Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(1);
  });

  it("sheet Kurva S menunjuk SATU drawing yang memuat grafik DAN logo", async () => {
    const zip = await zipDari(LOGO);
    const wbXml = await zip.file("xl/workbook.xml")!.async("string");
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    const rid = /<sheet\b[^>]*name="Kurva S"[^>]*r:id="([^"]+)"/.exec(wbXml)![1];
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)![1];
    const sheetFile = target.slice(target.lastIndexOf("/") + 1);
    const sheetXml = await zip.file(`xl/worksheets/${sheetFile}`)!.async("string");
    // Tepat satu <drawing> – bukan dua, bukan nol.
    expect(sheetXml.match(/<drawing\b/g) ?? []).toHaveLength(1);

    const sheetRels = await zip.file(`xl/worksheets/_rels/${sheetFile}.rels`)!.async("string");
    const drawRid = /<drawing r:id="([^"]+)"/.exec(sheetXml)![1];
    const drawTarget = new RegExp(`Id="${drawRid}"[^>]*Target="([^"]+)"`).exec(sheetRels)![1];
    const drawPath = `xl/drawings/${drawTarget.replace(/^\.\.\/drawings\//, "")}`;
    const drawXml = await zip.file(drawPath)!.async("string");
    expect(drawXml, "grafik").toContain("<c:chart");
    expect(drawXml.match(/<xdr:pic>/g) ?? [], "logo").toHaveLength(2);
  });

  it("tanpa logo, grafiknya tetap terpasang seperti sebelumnya", async () => {
    const zip = await zipDari();
    expect(Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(1);
  });
});
