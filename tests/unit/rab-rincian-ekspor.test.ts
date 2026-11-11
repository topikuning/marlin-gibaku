import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { hitungRumus } from "@/lib/export/rumus-mini";
import type { RincianEkspor } from "@/lib/export/rincian-rencana";
import { ringkasCetak } from "./cetak-a4-bantu";

vi.mock("server-only", () => ({}));
const { buildRabXlsx } = await import("@/lib/export/rab-xlsx");

/**
 * UNDUHAN RAB BERTAUT KE BACKUP VOLUME & ANALISA (DECISIONS 741).
 *
 * Permintaan user 2026-11-05: Resume, Sub Resume, Detail, Resume Analisa,
 * Analisa, Bahan & Upah, dan Backup Volume *"yang terlink total"*, pilihan
 * "tautkan bila cocok". Yang dibuktikan di sini dengan MENGHITUNG ULANG
 * seluruh rumus berkas hasil:
 *  - total berkas = total resmi MARLIN;
 *  - volume & harga satuan tertaut ke rinciannya bila sama, dibungkus ROUND
 *    ke presisi MARLIN;
 *  - yang berbeda tetap angka resmi, berwarna, dan terdaftar;
 *  - rumus asli backup hanya dipakai bila terbukti menghasilkan angka berkas.
 */

const rincian: RincianEkspor = {
  hargaDasar: [
    { kunci: "r1|Bahan & Upah|C10", nama: "Pekerja", satuan: "OH", harga: 100000, asalSel: "Bahan & Upah!C10" },
    { kunci: "r1|Bahan & Upah|C11", nama: "Semen", satuan: "kg", harga: 5000, asalSel: "Bahan & Upah!C11" },
    { kunci: "r1|Bahan & Upah|C99", nama: "Tidak dipakai", satuan: "bh", harga: 1, asalSel: "Bahan & Upah!C99" },
  ],
  analisa: [
    {
      id: "a1",
      kode: "A.4.1",
      uraian: "Pasangan batu kali",
      hargaSatuan: 115000,
      overhead: 0.15,
      asal: { revisionNo: 1, warisan: false },
      komponen: [
        { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 0.5, harga: 100000, jumlah: 50000, hargaDasar: "r1|Bahan & Upah|C10" },
        { kategori: "bahan", nama: "Semen", satuan: "kg", koefisien: 10, harga: 5000, jumlah: 50000, hargaDasar: "r1|Bahan & Upah|C11" },
      ],
    },
    {
      // Angka berkas 20.000, hitungan komponennya 19.000 → Resume memakai angka berkas.
      id: "a2",
      kode: "A.2.2",
      uraian: "Galian",
      hargaSatuan: 20000,
      overhead: null,
      asal: { revisionNo: 1, warisan: false },
      komponen: [{ kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 0.19, harga: 100000, jumlah: 19000, hargaDasar: "r1|Bahan & Upah|C10" }],
    },
    {
      // Berkas membulatkan ke atas ratusan: ROUNDUP(36.630, -2) = 36.700.
      id: "a3",
      kode: "A.5.1",
      uraian: "Plesteran 1:4",
      hargaSatuan: 36700,
      overhead: 0.1,
      pembulatan: { fungsi: "ROUNDUP", digit: -2 },
      asal: { revisionNo: 1, warisan: false },
      komponen: [{ kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 0.333, harga: 100000, jumlah: 33300, hargaDasar: "r1|Bahan & Upah|C10" }],
    },
  ],
  item: [
    {
      lineageKey: "A",
      kode: "1",
      nama: "Pasangan batu kali",
      satuan: "m3",
      volume: 12.5,
      hargaSatuan: 115000,
      analisaId: "a1",
      sebabTanpaBackup: null,
      backup: {
        jenis: "berkas",
        asal: { revisionNo: 1, warisan: false },
        rumusRab: "'7. Vol Kios'!M82",
        nilaiRab: 12.5,
        sumber: [{ sheet: "7. Vol Kios", sel: "M82", nilai: 12.5 }],
        // Kolom 14 di berkas asli berisi galat (#VALUE!) – bukan judul, tidak ikut ditulis.
        kepala: { "7. Vol Kios": { 2: "Uraian", 5: "P", 6: "L", 13: "Volume", 14: "#VALUE!" } },
        baris: [
          { sheet: "7. Vol Kios", baris: 80, sel: [{ kolom: 2, nilai: "Dinding A", rumus: null }, { kolom: 5, nilai: 2.5, rumus: null }, { kolom: 6, nilai: 2, rumus: null }, { kolom: 13, nilai: 5, rumus: "E80*F80" }] },
          { sheet: "7. Vol Kios", baris: 81, sel: [{ kolom: 2, nilai: "Dinding B", rumus: null }, { kolom: 5, nilai: 3, rumus: null }, { kolom: 6, nilai: 2.5, rumus: null }, { kolom: 13, nilai: 7.5, rumus: "E81*F81" }] },
          { sheet: "7. Vol Kios", baris: 82, sel: [{ kolom: 2, nilai: "Jumlah", rumus: null }, { kolom: 13, nilai: 12.5, rumus: "SUM(M80:M81)" }] },
          // Rumus bisa digeser, tapi hasilnya (5) bukan angka tersimpan (99) → ditulis angka.
          { sheet: "7. Vol Kios", baris: 83, sel: [{ kolom: 14, nilai: 99, rumus: "E80*2" }] },
        ],
      },
    },
    {
      lineageKey: "B",
      kode: "2",
      nama: "Galian tanah",
      satuan: "m3",
      volume: 4,
      hargaSatuan: 20000,
      analisaId: "a2",
      sebabTanpaBackup: null,
      backup: {
        jenis: "isian",
        asal: { revisionNo: 1, warisan: false },
        baris: [{ uraian: "Pondasi", jumlah: 2, panjang: 2, lebar: null, tinggi: null, kurang: false, keterangan: null }],
      },
    },
    {
      // Backup 9, RAB 10 → TIDAK ditautkan, ditandai.
      lineageKey: "C",
      kode: "3",
      nama: "Urugan pasir",
      satuan: "m3",
      volume: 10,
      hargaSatuan: 20000,
      analisaId: "a2",
      sebabTanpaBackup: null,
      backup: {
        jenis: "isian",
        asal: { revisionNo: 1, warisan: true },
        baris: [
          { uraian: "Lantai", jumlah: null, panjang: 5, lebar: 2, tinggi: 1, kurang: false, keterangan: null },
          { uraian: "Lubang", jumlah: 1, panjang: 1, lebar: 1, tinggi: 1, kurang: true, keterangan: null },
        ],
      },
    },
    {
      lineageKey: "F",
      kode: "6",
      nama: "Plesteran dinding",
      satuan: "m2",
      volume: 2,
      hargaSatuan: 36700,
      analisaId: "a3",
      sebabTanpaBackup: null,
      backup: {
        jenis: "isian",
        asal: { revisionNo: 1, warisan: false },
        baris: [{ uraian: "Dinding", jumlah: null, panjang: 2, lebar: 1, tinggi: null, kurang: false, keterangan: null }],
      },
    },
    { lineageKey: "D", kode: "4", nama: "Pekerjaan baru", satuan: "ls", volume: 1, hargaSatuan: 500000, analisaId: null, sebabTanpaBackup: "Item baru di revisi ini", backup: null },
    {
      // Rumus asli tidak bisa dibuktikan (IF) dan sel sumbernya tidak tersimpan.
      lineageKey: "E",
      kode: "5",
      nama: "Plesteran",
      satuan: "m2",
      volume: 7,
      hargaSatuan: 20000,
      analisaId: null,
      sebabTanpaBackup: null,
      backup: {
        jenis: "berkas",
        asal: { revisionNo: 1, warisan: false },
        rumusRab: "'Vol Plester'!H40*1",
        nilaiRab: 7,
        sumber: [{ sheet: "Vol Plester", sel: "H40", nilai: 7 }],
        kepala: {},
        baris: [{ sheet: "Vol Plester", baris: 10, sel: [{ kolom: 8, nilai: 7, rumus: "IF(G10>0,7,0)" }] }],
      },
    },
  ],
};

const jumlah = (v: number, h: number) => BigInt(Math.round(v * h));
const nodes = [
  { id: "k", parentId: null, kind: "kategori" as const, code: "I", name: "PEKERJAAN KIOS", unit: null, volume: null, unitPrice: null, amount: 0n },
  ...rincian.item.map((i) => ({
    id: i.lineageKey,
    parentId: "k",
    kind: "item" as const,
    code: i.kode,
    name: i.nama,
    unit: i.satuan,
    volume: i.volume,
    unitPrice: i.hargaSatuan,
    amount: jumlah(i.volume!, i.hargaSatuan!),
    lineageKey: i.lineageKey,
  })),
];
const total = nodes.reduce((t, n) => t + n.amount, 0n);
nodes[0]!.amount = total;

async function bangun() {
  const buf = await buildRabXlsx({
    locationName: "Uji",
    packageName: "Paket",
    contractNumber: null,
    vendorName: null,
    ppnPercent: 11,
    revisionNo: 2,
    totalValue: total,
    nodes,
    rincian,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Hitung sel apa pun di workbook, mengikuti rumus antar-sheet. */
function penghitung(wb: ExcelJS.Workbook) {
  const memo = new Map<string, number | string | null>();
  const nilai = (sheet: string, c: number, r: number): number | string | null => {
    const k = `${sheet}|${c}|${r}`;
    if (memo.has(k)) return memo.get(k)!;
    const cell = wb.getWorksheet(sheet)!.getCell(r, c);
    let v: number | string | null;
    if (cell.formula) {
      const h = hitungRumus(cell.formula, (sh, cc, rr) => nilai(sh ?? sheet, cc, rr));
      if (h == null) throw new Error(`Rumus ${sheet}!${cell.address} tidak bisa dihitung: =${cell.formula}`);
      v = h;
    } else v = (cell.value as number | string | null) ?? null;
    memo.set(k, v);
    return v;
  };
  return nilai;
}

const barisDetail = (wb: ExcelJS.Workbook, kode: string) => {
  const ws = wb.getWorksheet("Detail RAB")!;
  let ketemu = 0;
  ws.eachRow((row, r) => {
    if (row.getCell(1).value === kode && row.getCell(4).value) ketemu = r;
  });
  return ketemu;
};

describe("unduhan RAB dengan rincian bertaut", () => {
  it("sheet lengkap dan berurutan", async () => {
    const wb = await bangun();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Resume",
      "Sub Resume",
      "Detail RAB",
      "Backup Volume",
      "Resume Analisa",
      "Analisa",
      "Bahan & Upah",
      "Catatan Rincian",
    ]);
  });

  it("dihitung ulang seluruhnya: JUMLAH Resume dan Detail sama dengan total resmi", async () => {
    const wb = await bangun();
    const hitung = penghitung(wb);
    const det = wb.getWorksheet("Detail RAB")!;
    let barisJumlah = 0;
    det.eachRow((row, r) => {
      if (row.getCell(2).value === "JUMLAH (pra-PPN)") barisJumlah = r;
    });
    expect(hitung("Detail RAB", 6, barisJumlah)).toBe(Number(total));
    const res = wb.getWorksheet("Resume")!;
    let barisRes = 0;
    res.eachRow((row, r) => {
      if (row.getCell(2).value === "JUMLAH") barisRes = r;
    });
    expect(hitung("Resume", 3, barisRes)).toBe(Number(total));
    // Setiap item: volume & harga terhitung = angka resmi.
    for (const it of rincian.item) {
      const r = barisDetail(wb, it.kode);
      expect(hitung("Detail RAB", 3, r), `volume ${it.kode}`).toBe(it.volume);
      expect(hitung("Detail RAB", 5, r), `harga ${it.kode}`).toBe(it.hargaSatuan);
    }
  });

  it("yang cocok tertaut lewat ROUND ke rinciannya; rantai sampai Bahan & Upah", async () => {
    const wb = await bangun();
    const det = wb.getWorksheet("Detail RAB")!;
    const rA = barisDetail(wb, "1");
    expect(det.getCell(rA, 3).formula).toMatch(/^ROUND\('Backup Volume'!C\d+,3\)$/);
    expect(det.getCell(rA, 5).formula).toMatch(/^ROUND\('Resume Analisa'!D\d+,2\)$/);
    const rB = barisDetail(wb, "2");
    expect(det.getCell(rB, 3).formula).toMatch(/^ROUND\('Backup Volume'!G\d+,3\)$/);

    // Resume Analisa a1 → Analisa F → komponen → Bahan & Upah.
    const resA = wb.getWorksheet("Resume Analisa")!;
    const selRes = /D(\d+)/.exec(det.getCell(rA, 5).formula)![1]!;
    const fAnalisa = resA.getCell(`D${selRes}`).formula;
    expect(fAnalisa).toMatch(/^'Analisa'!F\d+$/);
    const an = wb.getWorksheet("Analisa")!;
    const formulas: string[] = [];
    an.eachRow((row) => row.eachCell((c) => c.formula && formulas.push(c.formula)));
    expect(formulas.some((f) => /^'Bahan & Upah'!D\d+$/.test(f))).toBe(true);
    expect(formulas.some((f) => /^D\d+\*E\d+$/.test(f))).toBe(true);
    // Bahan yang tidak dipakai analisa mana pun tidak ikut.
    const bahan: string[] = [];
    wb.getWorksheet("Bahan & Upah")!.eachRow((row) => bahan.push(String(row.getCell(2).value)));
    expect(bahan).not.toContain("Tidak dipakai");
  });

  it("pembulatan akhir analisa mengikuti rumus berkas dan tetap tertaut", async () => {
    const wb = await bangun();
    const det = wb.getWorksheet("Detail RAB")!;
    const rF = barisDetail(wb, "6");
    expect(det.getCell(rF, 5).formula).toMatch(/^ROUND\('Resume Analisa'!D\d+,2\)$/);
    const rumus: string[] = [];
    wb.getWorksheet("Analisa")!.eachRow((row) => row.eachCell((c) => void (c.formula && rumus.push(c.formula))));
    expect(rumus.some((f) => /^ROUNDUP\(F\d+\+F\d+,-2\)$/.test(f))).toBe(true);
    expect(penghitung(wb)("Detail RAB", 5, rF)).toBe(36700);
  });

  it("rumus asli backup digeser dan terbukti; yang tak terbukti jadi angka", async () => {
    const wb = await bangun();
    const bv = wb.getWorksheet("Backup Volume")!;
    const rumus: string[] = [];
    bv.eachRow((row) => row.eachCell((c) => c.formula && rumus.push(c.formula)));
    expect(rumus).toEqual(expect.arrayContaining([expect.stringMatching(/^E\d+\*F\d+$/), expect.stringMatching(/^SUM\(M\d+:M\d+\)$/)]));
    expect(rumus.some((f) => f.includes("IF("))).toBe(false);
    let angka99 = 0;
    bv.eachRow((row) => row.eachCell((c) => c.value === 99 && !c.formula && angka99++));
    expect(angka99, "rumus yang hasilnya beda dari angka berkas harus ditulis sebagai angka").toBe(1);
    const judul: unknown[] = [];
    bv.eachRow((row) => row.getCell(13).value === "Volume" && row.eachCell((c) => judul.push(c.value)));
    expect(judul).toEqual(["Uraian", "P", "L", "Volume"]);
    const hitung = penghitung(wb);
    bv.eachRow((row, r) =>
      row.eachCell((c, k) => {
        if (c.formula) expect(Number.isFinite(hitung("Backup Volume", k, r))).toBe(true);
      }),
    );
  });

  it("yang berbeda: angka resmi, berwarna, bercatatan, terdaftar di Catatan Rincian", async () => {
    const wb = await bangun();
    const det = wb.getWorksheet("Detail RAB")!;
    const rC = barisDetail(wb, "3");
    expect(det.getCell(rC, 3).formula).toBeUndefined();
    expect(det.getCell(rC, 3).value).toBe(10);
    expect((det.getCell(rC, 3).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFEF3C7");
    expect(String(det.getCell(rC, 3).note)).toMatch(/backup volume: 9/);

    const teks: string[] = [];
    wb.getWorksheet("Catatan Rincian")!.eachRow((row) => row.eachCell((c) => teks.push(String(c.value))));
    const isi = teks.join(" | ");
    expect(isi).toMatch(/SELISIH/);
    expect(isi).toMatch(/Urugan pasir \| Volume \| 10 \| 9/);
    expect(isi).toMatch(/BELUM PUNYA BACKUP VOLUME \(1\)/);
    expect(isi).toMatch(/Item baru di revisi ini/);
    expect(isi).toMatch(/BELUM PUNYA ANALISA KONTRAK \(2\)/);
    // Harga analisa a2 tidak sama dengan hitungan komponennya – disebut.
    expect(isi).toMatch(/A\.2\.2: hitungan komponen 19000\.00, angka berkas 20000\.00/);
    // Rumus volume item E tidak bisa dihitung ulang – disebut.
    expect(isi).toMatch(/Backup 5 Plesteran: rumus volume di berkas/);
  });

  it("tanpa rincian: tetap tiga sheet seperti sebelumnya", async () => {
    const buf = await buildRabXlsx({
      locationName: "Uji",
      packageName: "Paket",
      contractNumber: null,
      vendorName: null,
      ppnPercent: 11,
      revisionNo: 2,
      totalValue: total,
      nodes,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resume", "Sub Resume", "Detail RAB"]);
  });
});

/* ── Dokumen CCO bertaut ──────────────────────────────────────────────────── */

import type { CcoNode } from "@/lib/rab/cco-rows";
const { buildCcoXlsx } = await import("@/lib/export/cco-xlsx");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");

const ccoNode = (n: (typeof nodes)[number], vol?: number): CcoNode => ({
  id: n.id,
  parentId: n.parentId,
  kind: n.kind,
  code: n.code,
  name: n.name,
  unit: n.unit,
  volume: vol ?? n.volume,
  unitPrice: n.unitPrice,
  amount: vol != null && n.unitPrice != null ? jumlah(vol, n.unitPrice) : n.amount,
  lineageKey: n.kind === "kategori" ? "K" : n.id,
});
// Kontrak: volume item A 10 (draft 12,5); harga item B di kontrak 21.000 (draft 20.000).
const LAMA_CCO = nodes.map((n) => {
  const x = ccoNode(n, n.id === "A" ? 10 : undefined);
  return n.id === "B" ? { ...x, unitPrice: 21000, amount: jumlah(4, 21000) } : x;
});
const BARU_CCO = nodes.map((n) => ccoNode(n));
LAMA_CCO[0]!.amount = LAMA_CCO.slice(1).reduce((t, n) => t + n.amount, 0n);

async function cco(denganRincian: boolean) {
  return buildCcoXlsx({
    locationName: "Uji",
    packageName: "Paket",
    workTitle: null,
    address: null,
    contractNumber: null,
    vendorName: null,
    ppnPercent: 11,
    ccoNo: 1,
    nilaiTercatatLama: LAMA_CCO[0]!.amount,
    nilaiTercatatBaru: total,
    realisasiByLineage: new Map(),
    lama: LAMA_CCO,
    baru: BARU_CCO,
    ...(denganRincian ? { rincianBaru: rincian, revisiBaruNo: 3 } : {}),
  });
}

describe("dokumen CCO dengan rincian bertaut", () => {
  it("lembar CCO tetap pertama, diikuti RAB draft dan rinciannya", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await cco(true)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "CCO-01",
      "Resume",
      "Sub Resume",
      "Detail RAB",
      "Backup Volume",
      "Resume Analisa",
      "Analisa",
      "Bahan & Upah",
      "Catatan Rincian",
    ]);
    expect(String(wb.getWorksheet("Detail RAB")!.getCell("A3").value)).toMatch(/Draft adendum \(CCO - 01\) – revisi #3/);
  });

  it("VOLUME sisi CCO menunjuk Detail RAB draft dan terhitung sama sampai ke backup", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await cco(true)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const hitung = penghitung(wb);
    const tautan: { r: number; c: number; f: string }[] = [];
    ws.eachRow((row, r) => row.eachCell((c, k) => c.formula?.startsWith("'Detail RAB'!") && tautan.push({ r, c: k, f: c.formula })));
    // Lima item: volume tertaut semua; harga hanya yang harga kontraknya = harga draft
    // (item B berbeda – harga kontrak tetap, tidak diam-diam diganti harga draft).
    expect(tautan.filter((t) => /!C\d+$/.test(t.f))).toHaveLength(6);
    expect(tautan.filter((t) => /!E\d+$/.test(t.f))).toHaveLength(5);
    const nilaiVol = tautan.filter((t) => /!C\d+$/.test(t.f)).map((t) => hitung("CCO-01", t.c, t.r));
    expect(nilaiVol).toEqual(rincian.item.map((i) => i.volume));
  });

  it("diimpor ulang lewat jalur impor sungguhan: lembar CCO yang dibaca, hasilnya sama dengan tanpa rincian", async () => {
    const tanpa = await parseHpsBuffer(await cco(false));
    const dengan = await parseHpsBuffer(await cco(true));
    expect(dengan.sheetName).toBe("CCO-01");
    expect(JSON.stringify(dengan.parsed)).toBe(JSON.stringify(tanpa.parsed));
  });
});

describe("cetak A4 (DECISIONS 762)", () => {
  it("semua sheet RAB & rincian A4, orientasi menurut lebar isinya", async () => {
    expect(ringkasCetak(await bangun())).toEqual({
      Resume: "A4 portrait 1×n",
      "Sub Resume": "A4 portrait 1×n",
      "Detail RAB": "A4 portrait 1×n",
      // Kolom backup bertambah mengikuti berkasnya; contoh ini sudah terlalu lebar untuk potret.
      "Backup Volume": "A4 landscape 1×n",
      "Resume Analisa": "A4 portrait 1×n",
      Analisa: "A4 portrait 1×n",
      "Bahan & Upah": "A4 portrait 1×n",
      "Catatan Rincian": "A4 portrait 1×n",
    });
  });
});
