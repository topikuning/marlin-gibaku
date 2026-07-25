import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { classifyRow, isSummaryRow, parseHpsBuffer, sumLeaves } from "@/lib/rab/hps-parser";
import { flattenParsedRab, grandTotal } from "@/lib/rab/flatten";

const mk = (total: number | null, children: any[] = []): any => ({
  code: "x",
  name: "x",
  volume: 1,
  unit: "ls",
  unit_price: total,
  total_price: total,
  tkdn_ratio: null,
  parent_code: null,
  children,
});

describe("sumLeaves", () => {
  it("leaf → nilai sendiri; grup tanpa nilai → total anak", () => {
    expect(sumLeaves([mk(500)])).toBe(500);
    expect(sumLeaves([mk(null, [mk(300), mk(200)])])).toBe(500); // grup
  });
  it("item BERHARGA + baris tambahan (mis. pengiriman/#REF!) → dijumlahkan", () => {
    // Bug lama: nilai induk (7000) hilang, hanya anak (2000) terhitung.
    expect(sumLeaves([mk(7000, [mk(2000)])])).toBe(9000);
  });
  it("baris grup memuat SUBTOTAL anak (breakdown) → tidak dihitung ganda", () => {
    expect(sumLeaves([mk(1000, [mk(600), mk(400)])])).toBe(1000);
  });
});

describe("baris berkode rusak/kosong (#REF!) sesudah item berharga → item sendiri (bukan anak)", () => {
  it("grand total (jalur flatten) ikut menghitung baris tsb — nilai induk tak hilang", async () => {
    // Item "4" berharga (2000), lalu baris kode-KOSONG (#REF! → terbaca kosong) yg
    // punya nilai sendiri (500). Bug lama: baris jadi anak "4" → nilai induk 2000
    // hilang, hanya 500 terhitung. Harus: 2000 + 500 = 2500.
    const { parsed } = await parseHpsBuffer(
      await xlsxFromRows([
        ["I", "PEKERJAAN PERSIAPAN", null, null, null, null, null, null, null],
        ["4", "Pengadaan Tiang", null, null, 2, "unit", 1000, 2000, 1],
        ["", "Pengiriman Tiang", null, null, 1, "unit", 500, 500, 1],
      ]),
    );
    expect(Math.round(parsed.categories[0].total_value)).toBe(2500);
    expect(Number(grandTotal(flattenParsedRab(parsed)))).toBe(2500);
  });
});

async function xlsxFromRows(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  for (const r of rows) ws.addRow(r);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * Fixture xlsx dibuat in-memory via exceljs (round-trip writeBuffer → parse).
 * Kolom: A=kode, B=nama, E=volume, F=satuan, G=harga satuan, H=jumlah, I=TKDN.
 */
async function buildFixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  const rows: (string | number | null)[][] = [
    // kode, nama, C, D, volume, satuan, hrg satuan, jumlah, tkdn
    ["I", "PEKERJAAN PERSIAPAN", null, null, null, null, null, null, null],
    ["1", "Papan Nama Proyek", null, null, 1, "bh", 500000, 500000, 0.9],
    ["6", "Pekerjaan Pengadaan SMK3K", null, null, null, null, null, null, null],
    ["6.1", "Penyiapan RK3K", null, null, null, null, null, null, null],
    ["a", "Pembuatan Manual & Prosedur", null, null, 2, "set", 250000, 500000, 1],
    [null, "JUMLAH", null, null, null, null, null, 1000000, null], // rekap → skip
    ["II", "PEKERJAAN GEDUNG", null, null, null, null, null, null, null],
    ["II.1", "Pekerjaan Pondasi", null, null, null, null, null, null, null],
    ["1", "Galian tanah", null, null, 10, "m3", 100000, 1000000, 1],
    ["II.1", "Pekerjaan Pondasi Tahap 2", null, null, null, null, null, null, null], // kode duplikat
    ["1", "Urugan kembali", null, null, 5, "m3", 50000, 250000, 1],
    ["", "SUB TOTAL", null, null, null, null, null, 1250000, null], // rekap → skip
  ];
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// top-level await (ESM) — hasil parse dipakai lintas test
const { parsed, warnings } = await parseHpsBuffer(await buildFixture());

describe("parseHpsBuffer (fixture in-memory)", () => {
  it("mendeteksi kategori dari roman + ^PEKERJAAN", () => {
    expect(parsed.categories.map((c) => c.roman)).toEqual(["I", "II"]);
  });

  it("hierarki item: angka = L1, x.y = anak, huruf = anak terdalam", () => {
    const cat1 = parsed.categories[0];
    expect(cat1.direct_items.map((i) => i.code)).toEqual(["1", "6"]);
    const grup = cat1.direct_items[1];
    expect(grup.children.map((c) => c.code)).toEqual(["6.1"]);
    expect(grup.children[0].children.map((c) => c.code)).toEqual(["6.1.a"]);
  });

  it("subkategori + dedup kode duplikat → kode#2", () => {
    const cat2 = parsed.categories[1];
    expect(cat2.subcategories.map((s) => s.code)).toEqual(["II.1", "II.1#2"]);
    expect(cat2.subcategories[0].items[0].name).toBe("Galian tanah");
    expect(cat2.subcategories[1].items[0].name).toBe("Urugan kembali");
  });

  it("baris JUMLAH/SUB TOTAL tidak masuk pohon", () => {
    const allNames = JSON.stringify(parsed);
    expect(allNames).not.toContain("JUMLAH");
    expect(allNames).not.toContain("SUB TOTAL");
  });

  it("total = sumLeaves dari total_price", () => {
    expect(parsed.categories[0].total_value).toBe(1_000_000); // 500rb + 500rb
    expect(parsed.categories[1].total_value).toBe(1_250_000);
    expect(parsed.total).toBe(2_250_000);
    expect(warnings).toEqual([]);
  });

  it("kolom item terbaca (volume, satuan, harga, tkdn)", () => {
    const it1 = parsed.categories[0].direct_items[0];
    expect(it1).toMatchObject({
      code: "1",
      name: "Papan Nama Proyek",
      volume: 1,
      unit: "bh",
      unit_price: 500000,
      total_price: 500000,
      tkdn_ratio: 0.9,
    });
  });
});

describe("helper classifyRow / isSummaryRow", () => {
  it("klasifikasi pola kode + nama", () => {
    expect(classifyRow("I", "PEKERJAAN PERSIAPAN")).toBe("kategori");
    expect(classifyRow("XIV", "PEKERJAAN LEVELLING LAHAN")).toBe("kategori");
    expect(classifyRow("II.1", "Pekerjaan Pondasi")).toBe("sub");
    expect(classifyRow("II.1.", "Pekerjaan Pondasi")).toBe("sub");
    expect(classifyRow("6", "Item biasa")).toBe("item");
    expect(classifyRow("6.1", "Anak item")).toBe("dotitem");
    expect(classifyRow("a", "Anak huruf")).toBe("letter");
    expect(classifyRow("", "Lanjutan")).toBe("blank");
    // "I" tunggal tanpa nama ^PEKERJAAN jatuh ke aturan huruf (perilaku lama dipertahankan)
    expect(classifyRow("I", "Bukan pekerjaan")).toBe("letter");
    expect(classifyRow("IV", "Bukan pekerjaan")).toBe("other");
  });

  it("deteksi baris rekap", () => {
    expect(isSummaryRow("JUMLAH")).toBe(true);
    expect(isSummaryRow("Sub Total")).toBe(true);
    expect(isSummaryRow("TOTAL KESELURUHAN")).toBe(true);
    expect(isSummaryRow("Papan Nama Proyek")).toBe(false);
  });
});

describe("kategori tanpa judul (mis. RAB_Nyamplung VIII) — infer dari sub-kode", () => {
  it("sub-kode VIII.x setelah kategori VII → kategori VIII terpisah, VII tak menyerap", async () => {
    const { parsed, warnings } = await parseHpsBuffer(
      await xlsxFromRows([
        ["VII", "PEKERJAAN KIOS", null, null, null, null, null, null, null],
        ["VII.1", "Pekerjaan Struktural", null, null, null, null, null, null, null],
        ["1", "Item VII", null, null, 1, "ls", 100, 100, 1],
        // Kategori VIII TANPA baris judul — hanya lewat sub-kode:
        ["VIII.3", "Pekerjaan Deep Well", null, null, null, null, null, null, null],
        ["1", "Item VIII", null, null, 1, "ls", 900, 900, 1],
      ]),
    );
    expect(parsed.categories.map((c) => c.roman)).toEqual(["VII", "VIII"]);
    expect(Math.round(parsed.categories[0].total_value)).toBe(100); // VII tidak menyerap VIII
    expect(Math.round(parsed.categories[1].total_value)).toBe(900);
    expect(warnings.some((w) => /VIII.*judul/i.test(w))).toBe(true);
  });
});

describe("nilai kontrak = HARGA NEGOSIASI bila ada (bukan HPS)", () => {
  it("baris header dgn kolom negosiasi → total pakai kolom JUMLAH HARGA (nego)", async () => {
    const { parsed, warnings } = await parseHpsBuffer(
      await xlsxFromRows([
        // A=NO B=JENIS C D E=VOL F=SAT G=NILAI HPS H=JUMLAH I=HRG NEGO J=JUMLAH HRG K=TKDN
        ["NO", "JENIS PEKERJAAN", null, null, "VOL", "SAT", "NILAI HPS", "JUMLAH", "HARGA NEGOISASI", "JUMLAH HARGA", "NILAI TKDN"],
        ["I", "PEKERJAAN PERSIAPAN", null, null, null, null, null, null, null, null, null],
        ["1", "Item A", null, null, 2, "m", 1000, 2000, 800, 1600, 0.9],
      ]),
    );
    const it = parsed.categories[0].direct_items[0];
    expect(it.unit_price).toBe(800); // harga satuan nego, bukan 1000 (HPS)
    expect(it.total_price).toBe(1600); // JUMLAH HARGA nego, bukan 2000 (HPS)
    expect(parsed.categories[0].total_value).toBe(1600);
    expect(warnings.some((w) => /NEGOSIASI/i.test(w))).toBe(true);
  });

  it("tanpa header (fixture) → fallback kolom klasik G/H/I", () => {
    // fixture in-memory teratas tak punya baris header → total = kolom H (klasik)
    expect(parsed.categories[0].direct_items[0].total_price).toBe(500000);
  });

  it("header DUA BARIS (HPS | PENAWARAN | NEGOSIASI × HARGA SATUAN/TOTAL) → pakai NEGOSIASI", async () => {
    // Baris grup di atas, sub-header HARGA SATUAN/HARGA TOTAL di bawah (spt file NEGO vendor).
    // Kol: A=NO B=JENIS E=VOL F=SAT G=HPS-sat H=HPS-tot I=Pen-sat J=Pen-tot K=Nego-sat L=Nego-tot
    const { parsed, warnings } = await parseHpsBuffer(
      await xlsxFromRows([
        ["RAB"],
        ["NO", "JENIS PEKERJAAN", null, null, "VOL", "SAT", "HPS", null, "PENAWARAN", null, "NEGOSIASI", null],
        [null, null, null, null, null, null, "HARGA SATUAN", "HARGA TOTAL", "HARGA SATUAN", "HARGA TOTAL", "HARGA SATUAN", "HARGA TOTAL"],
        ["I", "PEKERJAAN PERSIAPAN"],
        ["1", "Item A", null, null, 50, "m²", 1700, 85000, 1600, 80000, 1559, 77950],
      ]),
    );
    const it = parsed.categories[0].direct_items[0];
    expect(it.unit_price).toBe(1559); // NEGOSIASI harga satuan, bukan 1700 (HPS) / 1600 (penawaran)
    expect(it.total_price).toBe(77950); // NEGOSIASI harga total
    expect(warnings.some((w) => /NEGOSIASI/i.test(w))).toBe(true);
  });

  it("hanya PENAWARAN (tanpa NEGOSIASI) → pakai PENAWARAN, bukan HPS", async () => {
    const { parsed, warnings } = await parseHpsBuffer(
      await xlsxFromRows([
        ["NO", "JENIS PEKERJAAN", null, null, "VOL", "SAT", "HPS", null, "PENAWARAN", null],
        [null, null, null, null, null, null, "HARGA SATUAN", "HARGA TOTAL", "HARGA SATUAN", "HARGA TOTAL"],
        ["I", "PEKERJAAN PERSIAPAN"],
        ["1", "Item A", null, null, 2, "m", 1000, 2000, 900, 1800],
      ]),
    );
    expect(parsed.categories[0].direct_items[0].unit_price).toBe(900); // penawaran, bukan 1000 (HPS)
    expect(warnings.some((w) => /PENAWARAN/i.test(w))).toBe(true);
  });
});

describe("kategori total 0 tidak masuk DB (flatten)", () => {
  it("kategori bernilai 0 di-skip; kategori bernilai tetap masuk", async () => {
    const { parsed } = await parseHpsBuffer(
      await xlsxFromRows([
        ["I", "PEKERJAAN PERSIAPAN", null, null, null, null, null, null, null],
        ["1", "Item nyata", null, null, 1, "ls", 500000, 500000, 1],
        ["II", "PEKERJAAN BANGUNAN SENTRA KULINER", null, null, null, null, null, null, null],
        ["II.1", "Pekerjaan Kosong", null, null, null, null, null, null, null],
        ["1", "Item tanpa nilai", null, null, null, null, null, null, null],
      ]),
    );
    // Parser tetap melihat 2 kategori (I bernilai, II = 0)…
    expect(parsed.categories.map((c) => c.roman)).toEqual(["I", "II"]);
    expect(parsed.categories[1].total_value).toBe(0);
    // …tapi flatten (yang dipakai import DB) hanya emit kategori bernilai.
    const cats = flattenParsedRab(parsed).filter((n) => n.kind === "kategori");
    expect(cats.map((c) => c.code)).toEqual(["I"]);
  });
});

describe("parseHpsBuffer error", () => {
  it("workbook tanpa sheet RAB → throw", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Resume");
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseHpsBuffer(Buffer.from(buf as ArrayBuffer))).rejects.toThrow(/RAB/);
  });
});

describe("baris DIHIDE di Excel diabaikan (tidak masuk perhitungan) — DECISIONS 084", () => {
  it("baris hidden dikecualikan dari pohon & total; ada peringatan", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    ws.addRow(["No", "Uraian", null, null, "Vol", "Sat", "Harga Satuan", "Jumlah Harga", "TKDN"]);
    ws.addRow(["I", "PEKERJAAN PERSIAPAN", null, null, null, null, null, null, null]);
    ws.addRow(["1", "Mobilisasi", null, null, 1, "ls", 1000000, 1000000, 1]);
    const hidden = ws.addRow(["2", "Item dikecualikan dari resume", null, null, 1, "ls", 5000000, 5000000, 1]);
    hidden.hidden = true;
    ws.addRow(["3", "Papan nama", null, null, 1, "ls", 500000, 500000, 1]);
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { parsed, warnings } = await parseHpsBuffer(buf);

    const cat = parsed.categories.find((c) => c.roman === "I")!;
    expect(cat.direct_items.map((i) => i.name)).toEqual(["Mobilisasi", "Papan nama"]);
    expect(parsed.total).toBe(1_500_000); // TANPA 5jt baris hidden
    expect(warnings.some((w) => /tersembunyi \(hidden\)/i.test(w))).toBe(true);
  });
});

describe("slimRabWorkbook: file raksasa multi-sheet + defined names → ramping ke RAB — DECISIONS 085", () => {
  it("workbook 3 sheet + 3000 defined names → parse RAB benar, tanpa OOM", async () => {
    const { slimRabWorkbook } = await import("@/lib/rab/xlsx-slim");
    const wb = new ExcelJS.Workbook();
    // Sheet volume besar & sheet resume (harus dibuang oleh slimming).
    const vol = wb.addWorksheet("Vol Besar");
    for (let i = 0; i < 500; i++) vol.addRow([i, `baris volume ${i}`, i, i * 2, i * 3]);
    wb.addWorksheet("Resume").addRow(["Resume"]);
    const ws = wb.addWorksheet("RAB");
    ws.addRow(["No", "Uraian", null, null, "Vol", "Sat", "Harga Satuan", "Jumlah Harga", "TKDN"]);
    ws.addRow(["I", "PEKERJAAN PERSIAPAN", null, null, null, null, null, null, null]);
    ws.addRow(["1", "Mobilisasi", null, null, 1, "ls", 1000000, 1000000, 1]);
    // banyak defined names sampah (simulasi 47k → kecil utk uji)
    for (let i = 0; i < 3000; i++) wb.definedNames.add(`Vol Besar!A1`, `_junk${i}`);
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

    const slim = await slimRabWorkbook(buf);
    expect(slim.length).toBeLessThan(buf.length); // lebih ramping
    // Slim workbook hanya berisi sheet RAB.
    const check = new ExcelJS.Workbook();
    await check.xlsx.load(slim as unknown as ArrayBuffer);
    expect(check.worksheets.map((w) => w.name)).toEqual(["RAB"]);

    const { parsed } = await parseHpsBuffer(buf);
    expect(parsed.categories.map((c) => c.roman)).toEqual(["I"]);
    expect(parsed.total).toBe(1_000_000);
  });
});
