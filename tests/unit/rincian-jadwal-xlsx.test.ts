// TIME SCHEDULE RINCI harus mengikuti BERKAS ACUAN user dan tidak boleh
// mengubah angka resmi (DECISIONS 316).
//
// Uji ini membaca balik workbook yang dihasilkan, bukan memeriksa kode
// penyusunnya. Dua hal yang dijaga:
//   1. Σ kolom minggu tiap item = kurva-S RESMI. Rinciannya boleh baru; angka
//      yang dipertanggungjawabkan tidak boleh bergeser sedikit pun.
//   2. Berkasnya MENGATAKAN mana yang fakta dan mana yang turunan.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { sebarMingguan, susunRincian, type SimpulRab } from "@/lib/export/rincian-jadwal";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import type { PeriodHeader } from "@/lib/periodic-report";

const { buildRincianJadwalXlsx } = await import("@/lib/export/rincian-jadwal-xlsx");

const NODES: SimpulRab[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", volume: null, unit: null, unitPrice: null, amount: 400, lineageKey: "A" },
  { id: "s1", parentId: "k1", kind: "sub", code: "1", name: "Mobilisasi", volume: null, unit: null, unitPrice: null, amount: 400, lineageKey: "A.1" },
  { id: "i1", parentId: "s1", kind: "item", code: "a", name: "Direksi keet", volume: 2, unit: "unit", unitPrice: 100, amount: 200, lineageKey: "A.1.1" },
  { id: "i2", parentId: "s1", kind: "item", code: "b", name: "Papan nama", volume: 1, unit: "bh", unitPrice: 200, amount: 200, lineageKey: "A.1.2" },
  { id: "k2", parentId: null, kind: "kategori", code: "II", name: "PEKERJAAN STRUKTUR", volume: null, unit: null, unitPrice: null, amount: 600, lineageKey: "B" },
  { id: "i3", parentId: "k2", kind: "item", code: "1", name: "Beton K250", volume: 10, unit: "m³", unitPrice: 60, amount: 600, lineageKey: "B.1" },
];

const HEADER = {
  locationName: "Batah Timur",
  village: "Batah Timur",
  district: null,
  regency: "Bangkalan",
  province: "Jawa Timur",
  packageName: "KNMP Bangkalan",
  ownerAgency: "KKP",
  contractNumber: "KTR-001",
  vendorName: "PT Gibaku",
  contractValue: 1_000_000n,
  locationValue: 1_000n,
  masaPelaksanaanHari: 28,
  tahunAnggaran: 2026,
  contractStart: new Date("2026-06-01T00:00:00Z"),
  periodeStart: new Date("2026-06-01T00:00:00Z"),
  periodeEnd: new Date("2026-06-07T00:00:00Z"),
  ppkName: null,
  ppkNip: null,
  supervisorName: null,
  supervisorFirm: null,
  contractorSignerName: null,
  contractorSignerTitle: null,
} as unknown as PeriodHeader;

const TOTAL_MINGGU = 4;
/** Kategori A jalan M1–M2, kategori B jalan M3–M4. */
const KURVA = [
  { lineageKey: "A", code: "I", name: "PEKERJAAN PERSIAPAN", weekly: [20, 20, 0, 0] },
  { lineageKey: "B", code: "II", name: "PEKERJAAN STRUKTUR", weekly: [0, 0, 30, 30] },
];

function siapkan() {
  const sheet = buildKurvaSheet({
    categories: KURVA,
    totalWeeks: TOTAL_MINGGU,
    contractStart: HEADER.contractStart,
    actualCum: [10, 25, null, null],
    currentWeek: 2,
  });
  const rows = susunRincian(NODES, 1000, [
    { lineageKey: "A", segments: [{ startWeek: 1, endWeek: 2 }] },
    { lineageKey: "B", segments: [{ startWeek: 3, endWeek: 4 }] },
  ]);
  const weeklyKategori = new Map<string, number[]>();
  KURVA.forEach((k) => {
    const c = sheet.categories.find((x) => x.code === k.code)!;
    weeklyKategori.set(k.lineageKey, c.weeklyShown);
  });
  const mingguan = sebarMingguan(rows, weeklyKategori, TOTAL_MINGGU);
  return { sheet, rows, mingguan, weeklyKategori };
}

async function baca() {
  const { sheet, rows, mingguan } = siapkan();
  const buf = await buildRincianJadwalXlsx(rows, HEADER, { sheet, mingguan });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(buf) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("RAB")!;
  const teks: string[] = [];
  ws.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (c) => {
      if (typeof c.value === "string") teks.push(c.value);
    });
  });
  /** Cari baris menurut isi kolom NO. */
  const cariBaris = (kode: string) => {
    let n = -1;
    ws.eachRow((row, i) => {
      if (row.getCell(1).value === kode) n = i;
    });
    return n;
  };
  return { ws, teks, cariBaris, sheet, rows, mingguan };
}

describe("sebaran mingguan per item", () => {
  it("Σ item dalam satu kategori = profil mingguan kategori, PERSIS", async () => {
    // Inilah yang membuat sebaran turunan ini boleh ada: kurva resmi tidak
    // bergeser sedikit pun oleh rincian yang baru.
    const { rows, mingguan, weeklyKategori } = siapkan();
    for (const [key, profil] of weeklyKategori) {
      for (let w = 0; w < TOTAL_MINGGU; w++) {
        const jumlah = rows.reduce(
          (s, r, i) => (r.kind === "item" && r.kategoriKey === key ? s + mingguan[i][w] : s),
          0,
        );
        expect(jumlah, `${key} M${w + 1}`).toBeCloseTo(profil[w], 6);
      }
    }
  });

  it("dua item bernilai sama dapat porsi sama", () => {
    const { rows, mingguan } = siapkan();
    const i1 = rows.findIndex((r) => r.name === "Direksi keet");
    const i2 = rows.findIndex((r) => r.name === "Papan nama");
    expect(mingguan[i1][0]).toBeCloseTo(mingguan[i2][0], 6);
  });

  it("minggu di luar jendela kategori tetap KOSONG – jeda tidak ketempelan", () => {
    const { rows, mingguan } = siapkan();
    const beton = rows.findIndex((r) => r.name === "Beton K250");
    expect(mingguan[beton][0]).toBe(0);
    expect(mingguan[beton][1]).toBe(0);
    expect(mingguan[beton][2]).toBeGreaterThan(0);
  });

  it("baris kategori & sub tidak membawa angka mingguan", () => {
    const { rows, mingguan } = siapkan();
    rows.forEach((r, i) => {
      if (r.kind === "item") return;
      expect(mingguan[i].every((v) => v === 0), r.name).toBe(true);
    });
  });
});

describe("berkas mengikuti tata letak acuan", () => {
  it("judul & identitas paket seperti berkas acuan", async () => {
    const { teks } = await baca();
    expect(teks.some((t) => t.includes("DAFTAR KUANTITAS & HARGA"))).toBe(true);
    expect(teks.some((t) => t === "PROYEK")).toBe(true);
    expect(teks.some((t) => t === "TAHUN ANGGARAN")).toBe(true);
    expect(teks.some((t) => t.includes("KNMP Bangkalan"))).toBe(true);
  });

  it("kepala kolom persis acuan: NO, JENIS PEKERJAAN, VOL, SAT, HARGA SATUAN, JUMLAH HARGA, BOBOT", async () => {
    const { teks } = await baca();
    for (const t of ["NO", "JENIS PEKERJAAN", "VOL", "SAT", "HARGA SATUAN", "JUMLAH HARGA", "BOBOT"]) {
      expect(teks, t).toContain(t);
    }
  });

  it("kolom minggu dikelompokkan per BULAN, dengan baris M1..MN di bawahnya", async () => {
    const { teks } = await baca();
    // Sel minggu kini "M1\n<rentang tanggal>" (user 2026-08-24) — yang dijaga
    // token pertamanya.
    expect(teks.some((t) => t.split(/\s/)[0] === "M1")).toBe(true);
    expect(teks.some((t) => t.split(/\s/)[0] === `M${TOTAL_MINGGU}`)).toBe(true);
    expect(teks.some((t) => /JUNI|JULI/.test(t))).toBe(true);
  });

  it("enam baris kaki: RENCANA / REALISASI / DEVIASI × (kemajuan, kumulatif)", async () => {
    const { teks } = await baca();
    expect(teks.filter((t) => t === "RENCANA")).toHaveLength(2);
    expect(teks.filter((t) => t === "REALISASI")).toHaveLength(2);
    expect(teks.filter((t) => t === "DEVIASI")).toHaveLength(2);
    expect(teks.some((t) => t.includes("KUMULATIF KEMAJUAN"))).toBe(true);
  });

  it("JUMLAH HARGA & BOBOT berupa RUMUS – berkas yang diedit tetap jujur", async () => {
    const { ws, cariBaris } = await baca();
    const n = cariBaris("a");
    const jumlah = ws.getRow(n).getCell(8).value as { formula?: string };
    const bobot = ws.getRow(n).getCell(9).value as { formula?: string };
    expect(jumlah.formula).toBe(`E${n}*G${n}`);
    expect(bobot.formula).toMatch(/^H\d+\/\$H\$\d+\*100$/);
  });

  it("baris RENCANA adalah SUM kolom item, bukan angka tempelan", async () => {
    const { ws, teks } = await baca();
    expect(teks).toContain("RENCANA");
    let f: string | undefined;
    ws.eachRow((row) => {
      if (row.getCell(2).value === "RENCANA" && String(row.getCell(3).value).startsWith("KEMAJUAN")) {
        f = (row.getCell(10).value as { formula?: string })?.formula;
      }
    });
    expect(f).toMatch(/^SUM\(J\d+:J\d+\)$/);
  });

  it("KUMULATIF RENCANA berakhir 100% – kurva resmi tidak bergeser", async () => {
    const { ws, sheet } = await baca();
    let akhir: number | undefined;
    ws.eachRow((row) => {
      if (row.getCell(2).value === "RENCANA" && String(row.getCell(3).value).startsWith("KUMULATIF")) {
        const v = row.getCell(9 + TOTAL_MINGGU).value as { result?: number } | number;
        akhir = typeof v === "number" ? v : v?.result;
      }
    });
    expect(akhir).toBeCloseTo(sheet.kumulatifRencana[TOTAL_MINGGU - 1], 2);
    expect(akhir).toBeCloseTo(100, 2);
  });

  it("MENYEBUT mana yang fakta dan mana yang turunan", async () => {
    // Tanpa kalimat ini, sebaran per item terbaca sebagai rencana yang disusun
    // orang — padahal ia diturunkan dari jadwal kategori.
    const { teks } = await baca();
    const catatan = teks.find((t) => t.includes("TURUNAN"));
    expect(catatan).toBeTruthy();
    expect(catatan).toMatch(/per KATEGORI, bukan per item/);
  });
});
