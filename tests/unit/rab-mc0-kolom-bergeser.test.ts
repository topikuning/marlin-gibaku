// BERKAS MC-0 KEMANTREN — tiga cacat yang bertumpuk jadi satu pesan yang salah.
//
// Keberatan user 2026-09-01: berkas `DRAFT_MC0_KNMP_KEMANTREN_2026_27_AGUSTUS_`
// ditolak dengan *"Sheet "RAB" tidak ditemukan …. Sheet yang ada di berkas ini:
// RAB, BACK UP VOL, …"* — menyebut sheet yang katanya tidak ada, di kalimat yang
// sama. Sheetnya ADA dan DIBACA; yang gagal ada tiga hal lain:
//
//  1. Kolom NO berkas itu di **B**, uraian di C, dan huruf rincian turun lagi ke
//     D. Walker membaca kode HANYA dari kolom A, jadi tidak satu pun kategori
//     terbuka dan 2.392 baris dibuang oleh `if (!cat) return`.
//  2. Blok adendumnya (CCO-01) MASIH KOSONG — ini draft. `deteksiCco` memilih
//     blok paling kanan tanpa peduli terbukti atau tidak, gagal membuktikan
//     `volume × harga ≈ jumlah`, lalu menyerah.
//  3. Baris penutup RAB berkode A/B/C/D ("JUMLAH HARGA", "PPN 11 %", "JUMLAH
//     TOTAL", "DIBULATKAN"). Aturan rekap lama menuntut kolom kode KOSONG, jadi
//     keempatnya ikut terhitung sebagai pekerjaan — nilai kontrak membengkak
//     dari 7,97 M jadi 34,5 M.
//
// Bentuknya diuji, bukan berkas aslinya: yang menentukan benar-salah di sini
// adalah susunan kolomnya, dan susunan itu bisa disusun ulang di sini persis.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { deteksiCco } from "@/lib/rab/cco-import";
import {
  detectCodeColumn,
  parseHpsBuffer,
  parseHpsWorkbook,
  romanToInt,
} from "@/lib/rab/hps-parser";

type Baris = {
  /** Kode di kolom B (jenjang 1–2) atau kolom D (huruf rincian). */
  kode: string;
  huruf?: boolean;
  nama: string;
  volKontrak?: number;
  volMc?: number;
  sat?: string;
  harga?: number;
};

/**
 * Sheet berbentuk KEMANTREN: kolom A kosong, NO di B, uraian di C/E, lima blok
 * nilai (RAB KONTRAK · MC-0 · TAMBAH · KURANG · CCO-01) dengan CCO-01 kosong.
 */
function sheetKemantren(baris: Baris[], opts: { isiCco?: boolean } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  const set = (r: number, c: number, v: ExcelJS.CellValue) => {
    ws.getRow(r).getCell(c).value = v;
  };

  // Baris grup blok (sel merge di berkas asli terbaca berulang — ditiru).
  for (let c = 6; c <= 11; c++) set(1, c, "RAB KONTRAK");
  for (let c = 12; c <= 17; c++) set(1, c, "MC - 0");
  for (let c = 18; c <= 20; c++) set(1, c, "PEKERJAAN TAMBAH");
  for (let c = 21; c <= 23; c++) set(1, c, "PEKERJAAN KURANG");
  for (let c = 24; c <= 26; c++) set(1, c, "CCO - 01");

  set(2, 9, "HARGA");
  set(2, 10, "JUMLAH");
  set(2, 11, "BOBOT");
  set(2, 15, "HARGA");
  set(2, 16, "JUMLAH");
  set(2, 17, "BOBOT");

  // Header utama — perhatikan NO di kolom B, bukan A.
  set(3, 2, "NO");
  set(3, 3, "URAIAN PEKERJAAN");
  set(3, 6, "VOLUME");
  set(3, 8, "SAT");
  set(3, 12, "VOLUME");
  set(3, 14, "SAT");

  baris.forEach((b, i) => {
    const r = 4 + i;
    if (b.huruf) {
      set(r, 4, b.kode);
      set(r, 5, b.nama);
    } else {
      set(r, 2, b.kode);
      set(r, 3, b.nama);
    }
    if (b.harga == null) return;
    const vk = b.volKontrak ?? 0;
    const vm = b.volMc ?? 0;
    set(r, 6, vk);
    set(r, 8, b.sat ?? "m³");
    set(r, 9, b.harga);
    set(r, 10, vk * b.harga);
    set(r, 12, vm);
    set(r, 14, b.sat ?? "m³");
    set(r, 15, b.harga);
    set(r, 16, vm * b.harga);
    if (opts.isiCco) {
      set(r, 24, vm);
      set(r, 25, b.harga);
      set(r, 26, vm * b.harga);
    }
  });
  return { wb, ws };
}

const PEKERJAAN: Baris[] = [
  { kode: "I", nama: "PEKERJAAN PERSIAPAN" },
  { kode: "1", nama: "Buat Bedeng Pekerja", volKontrak: 50, volMc: 50, sat: "m²", harga: 1_000_000 },
  { kode: "2", nama: "Pagar Sementara", volKontrak: 150, volMc: 195, sat: "m¹", harga: 400_000 },
  { kode: "3", nama: "Pekerjaan Pengadaan SMK3K" },
  { kode: "3.1.", nama: "Penyiapan RK3K" },
  { kode: "a", huruf: true, nama: "Pembuatan Manual", volKontrak: 2, volMc: 2, sat: "set", harga: 1_000_000 },
  { kode: "b", huruf: true, nama: "Kartu Identitas", volKontrak: 80, volMc: 80, sat: "org", harga: 7_000 },
];
/** 50jt + 78jt + 2jt + 560rb, dari VOLUME MC-0 (bukan volume kontrak). */
const TOTAL_MC0 = 50 * 1_000_000 + 195 * 400_000 + 2 * 1_000_000 + 80 * 7_000;

/** Baris penutup RAB — bernomor A/B/C/D, tanpa volume & tanpa harga satuan. */
const PENUTUP: Baris[] = [
  { kode: "A", nama: "JUMLAH HARGA" },
  { kode: "B", nama: "PPN 11 %" },
  { kode: "C", nama: "JUMLAH TOTAL" },
  { kode: "D", nama: "DIBULATKAN" },
];

function isiPenutup(ws: ExcelJS.Worksheet, mulai: number, total: number) {
  PENUTUP.forEach((p, i) => {
    const r = mulai + i;
    ws.getRow(r).getCell(2).value = p.kode;
    ws.getRow(r).getCell(3).value = p.nama;
    // Hanya kolom JUMLAH yang terisi — itulah bentuk baris penutup.
    ws.getRow(r).getCell(10).value = total;
    ws.getRow(r).getCell(16).value = total;
  });
}

const totalSemua = (hasil: ReturnType<typeof parseHpsWorkbook>) =>
  hasil.parsed.categories.reduce((t, c) => t + c.total_value, 0);

describe("kolom NO tidak selalu di kolom A", () => {
  it("dideteksi dari header, bukan diasumsikan", () => {
    const { ws } = sheetKemantren(PEKERJAAN);
    expect(detectCodeColumn(ws, 12)).toBe(2);
  });

  it("tanpa header NO yang meyakinkan, tetap kolom A seperti dulu", () => {
    // Jaring pengaman: berkas RAB lama TIDAK BOLEH berubah perilakunya hanya
    // karena deteksi ini ada.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    ws.getRow(1).values = ["KODE", "URAIAN", "", "", "VOLUME", "SAT", "HARGA", "JUMLAH"];
    expect(detectCodeColumn(ws, 5)).toBe(1);
  });

  it("kategori & item terbaca walau kode di B dan huruf rincian di D", () => {
    const { wb } = sheetKemantren(PEKERJAAN);
    const hasil = parseHpsWorkbook(wb);
    expect(hasil.parsed.categories).toHaveLength(1);
    const kat = hasil.parsed.categories[0];
    expect(kat.roman).toBe("I");
    expect(kat.name).toBe("PEKERJAAN PERSIAPAN");
    expect(kat.direct_items.map((i) => i.name)).toContain("Buat Bedeng Pekerja");
    // Jenjangnya utuh: "3.1." jadi anak item "3", dan huruf a/b (yang di berkas
    // ini turun ke KOLOM D) jadi anak "3.1." — bukan hilang, bukan naik jadi
    // item sendiri.
    const tiga = kat.direct_items.find((i) => i.code === "3")!;
    expect(tiga.children.map((c) => c.code)).toEqual(["3.1"]);
    expect(tiga.children[0].children.map((c) => c.name)).toEqual([
      "Pembuatan Manual",
      "Kartu Identitas",
    ]);
  });

  it("volume yang dipakai volume MC-0, bukan volume kontrak", () => {
    const { wb } = sheetKemantren(PEKERJAAN);
    expect(totalSemua(parseHpsWorkbook(wb))).toBeCloseTo(TOTAL_MC0, 3);
  });
});

describe("blok adendum yang masih kosong", () => {
  it("berkas draft dibaca sebagai keadaan DASAR, bukan ditolak", () => {
    const { ws } = sheetKemantren(PEKERJAAN);
    const peta = deteksiCco(ws)!;
    expect(peta).not.toBeNull();
    expect(peta.hasilDariDasar).toBe(true);
    expect(peta.blokHasil.label).toBe("MC - 0");
  });

  it("begitu blok CCO-01 berisi, ia yang jadi HASIL", () => {
    const { ws } = sheetKemantren(PEKERJAAN, { isiCco: true });
    const peta = deteksiCco(ws)!;
    expect(peta.hasilDariDasar).toBe(false);
    expect(peta.blokHasil.label).toBe("CCO - 01");
  });

  it("pemakainya diberi tahu bahwa yang masuk keadaan dasar", () => {
    const { wb } = sheetKemantren(PEKERJAAN);
    expect(parseHpsWorkbook(wb).warnings.join(" ")).toContain("masih KOSONG");
  });
});

describe("baris penutup bernomor", () => {
  it("JUMLAH HARGA / PPN / DIBULATKAN tidak ikut terhitung", () => {
    const { wb, ws } = sheetKemantren(PEKERJAAN);
    isiPenutup(ws, 4 + PEKERJAAN.length, TOTAL_MC0);
    // Tanpa penyaringan, tiga baris bernilai total akan menambah 3 × TOTAL_MC0.
    expect(totalSemua(parseHpsWorkbook(wb))).toBeCloseTo(TOTAL_MC0, 3);
  });

  it("pekerjaan bernama “Total Station” TETAP terhitung", () => {
    // Yang membedakan penutup dari pekerjaan bukan namanya — melainkan bahwa
    // penutup tidak punya volume dan tidak punya harga satuan.
    const baris: Baris[] = [
      ...PEKERJAAN,
      { kode: "4", nama: "Total Station", volKontrak: 1, volMc: 1, sat: "unit", harga: 25_000_000 },
    ];
    const { wb } = sheetKemantren(baris);
    expect(totalSemua(parseHpsWorkbook(wb))).toBeCloseTo(TOTAL_MC0 + 25_000_000, 3);
  });
});

/**
 * Susunan KLASIK: kode di A, uraian di B, nilai di E–H. Dipakai menguji hal-hal
 * yang tidak ada hubungannya dengan pergeseran kolom.
 */
function sheetKlasik(
  baris: { kode: string; nama: string; vol?: number; sat?: string; harga?: number }[],
  opts: { namaSheet?: string; labelNo?: string } = {},
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.namaSheet ?? "RAB");
  ws.getRow(1).values = [
    opts.labelNo ?? "NO",
    "URAIAN PEKERJAAN",
    "",
    "",
    "VOLUME",
    "SAT",
    "HARGA SATUAN",
    "JUMLAH HARGA",
  ];
  baris.forEach((b, i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = b.kode;
    r.getCell(2).value = b.nama;
    if (b.harga == null) return;
    r.getCell(5).value = b.vol ?? 0;
    r.getCell(6).value = b.sat ?? "m³";
    r.getCell(7).value = b.harga;
    r.getCell(8).value = (b.vol ?? 0) * b.harga;
  });
  return { wb, ws };
}

describe("judul kategori tidak wajib berbunyi “PEKERJAAN”", () => {
  it("“I | PERSIAPAN” tetap membuka kategori", () => {
    // Satu kata yang tidak diwajibkan siapa pun tidak boleh jadi syarat
    // hidup-mati: berkas tanpa satu kategori pun berakhir sebagai nol item,
    // lalu dilaporkan sebagai "sheet tidak ditemukan".
    const { wb } = sheetKlasik([
      { kode: "I", nama: "PERSIAPAN" },
      { kode: "1", nama: "Bedeng pekerja", vol: 2, harga: 1_000_000 },
      { kode: "II", nama: "PEK. STRUKTUR" },
      { kode: "1", nama: "Beton K-250", vol: 10, harga: 1_400_000 },
    ]);
    const hasil = parseHpsWorkbook(wb);
    expect(hasil.parsed.categories.map((c) => `${c.roman} ${c.name}`)).toEqual([
      "I PERSIAPAN",
      "II PEK. STRUKTUR",
    ]);
    expect(totalSemua(hasil)).toBeCloseTo(2_000_000 + 14_000_000, 3);
  });

  it("romawi yang PUNYA volume & harga bukan judul, jadi bukan kategori", () => {
    // Penjaga arah sebaliknya: baris berangka adalah pekerjaan, betapa pun
    // kodenya terbaca seperti romawi.
    const { wb } = sheetKlasik([
      { kode: "I", nama: "PERSIAPAN" },
      { kode: "1", nama: "Bedeng pekerja", vol: 2, harga: 1_000_000 },
      { kode: "V", nama: "Barang berkode aneh", vol: 3, harga: 500_000 },
    ]);
    expect(parseHpsWorkbook(wb).parsed.categories).toHaveLength(1);
  });

  it("romawi yang MELOMPAT urutan tidak membuka kategori baru", () => {
    const { wb } = sheetKlasik([
      { kode: "I", nama: "PERSIAPAN" },
      { kode: "1", nama: "Bedeng pekerja", vol: 2, harga: 1_000_000 },
      { kode: "X", nama: "SESUATU" },
    ]);
    expect(parseHpsWorkbook(wb).parsed.categories).toHaveLength(1);
  });

  it("romawi → angka", () => {
    expect([romanToInt("I"), romanToInt("IV"), romanToInt("IX"), romanToInt("XIX.")]).toEqual([
      1, 4, 9, 19,
    ]);
    expect(romanToInt("A")).toBe(0);
  });
});

describe("kolom kode dikenali dari bentuk isinya, bukan dari labelnya", () => {
  it("tanpa label “NO” sama sekali, kolom kode tetap ketemu", () => {
    // Label kolom kode bervariasi ("NO", "No.", "URUT", kosong). Yang tidak
    // bervariasi: isinya berbentuk kode, dan letaknya di kiri kolom uraian.
    const { ws } = sheetKemantren(PEKERJAAN);
    ws.getRow(3).getCell(2).value = ""; // buang label "NO"
    expect(detectCodeColumn(ws, 12)).toBe(2);
  });

  it("kolom angka di kanan uraian tidak ikut dihitung sebagai kolom kode", () => {
    const { ws } = sheetKemantren(PEKERJAAN);
    ws.getRow(3).getCell(2).value = "";
    // Kolom F/G/H (volume kontrak) penuh angka, dan angka juga "berbentuk
    // kode" — batas kanannya kolom URAIAN, jadi mereka di luar hitungan.
    expect(detectCodeColumn(ws, 12)).toBeLessThan(3);
  });
});

describe("nama tab tidak menentukan izin masuk", () => {
  it("sheet bernama “BQ” tetap dibaca", async () => {
    const { wb } = sheetKlasik(
      [
        { kode: "I", nama: "PEKERJAAN PERSIAPAN" },
        { kode: "1", nama: "Bedeng pekerja", vol: 2, harga: 1_000_000 },
      ],
      { namaSheet: "BQ" },
    );
    wb.addWorksheet("Cover");
    const buf = await wb.xlsx.writeBuffer();
    const hasil = await parseHpsBuffer(buf as ArrayBuffer);
    expect(hasil.parsed.categories).toHaveLength(1);
  });
});

describe("pesan galat menyebut yang sebenarnya terjadi", () => {
  it("sheet RAB yang dibaca tapi nol baris tidak lagi disebut “tidak ditemukan”", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    ws.getRow(1).values = ["NO", "URAIAN", "VOLUME", "SAT", "HARGA", "JUMLAH"];
    ws.getRow(2).values = ["", "catatan bebas tanpa satu pun kategori", "", "", "", ""];
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseHpsBuffer(buf as ArrayBuffer)).rejects.toThrow(/DIBACA sampai habis/);
    await expect(parseHpsBuffer(buf as ArrayBuffer)).rejects.not.toThrow(/tidak ditemukan/);
  });
});
