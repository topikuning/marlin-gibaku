// DOKUMEN CCO TIDAK BOLEH MENGARANG PEKERJAAN TAMBAH.
//
// Laporan user 2026-09-05 atas ekspor CCO-01 Pasar Banggi, baris V 3.b
// "Pekerjaan Pancang Cerucuk Dolken" (dan IX 3.b yang serupa):
//
//   kontrak (MC-0)      : volume 0,   harga satuan Rp 28.117,52
//   berkas adendum      : volume 704, harga satuan 0  → NILAI ITEM NOL
//   dokumen CCO terbit  : PEKERJAAN TAMBAH 704 × Rp 28.117,52 = Rp 19.794.734,
//                         KET "BARU"
//
// Ketetapan user: *"kalaupun user mengenolkan harganya itu karena asumsi vol
// baru dinolkan, jadi 0 saja"* — item yang dinolkan di berkas bernilai nol,
// titik. Dokumen tidak boleh menghidupkannya kembali dengan harga kontrak.
//
// Dua sebab menumpuk di satu baris, dan keduanya dijaga di sini:
//
//  1. SELURUH baris dihitung dengan SATU harga (harga kontrak), termasuk sisi
//     CCO-01. Berkas menulis harga 0; dokumen tetap mengalikan 704 dengan harga
//     kontrak. Bersama IX 3.b, JUMLAH CCO-01 di dokumen membengkak Rp 27,4 juta
//     di atas nilai adendum yang tercatat di sistem — angka yang tidak ada di
//     berkas mana pun (DECISIONS 203: angka berkas dipakai apa adanya).
//  2. KET disimpulkan dari `volume MC-0 = 0` → "BARU", padahal itemnya ADA di
//     kontrak sejak awal.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { susunBarisCco, type CcoNode } from "@/lib/rab/cco-rows";

const { buildCcoXlsx, KOLOM_CCO: KOL } = await import("@/lib/export/cco-xlsx");

const HARGA_KONTRAK = 28_117.52;

const kat = (): CcoNode => ({
  id: "V",
  parentId: null,
  kind: "kategori",
  code: "V",
  name: "PEKERJAAN BANGUNAN SHELTER PENDARATAN IKAN",
  unit: null,
  volume: null,
  unitPrice: null,
  amount: 0n,
  lineageKey: "V",
});

const item = (o: { id: string; volume: number; harga: number; lineage?: string }): CcoNode => ({
  id: o.id,
  parentId: "V",
  kind: "item",
  code: "3.b",
  name: "Pekerjaan Pancang Cerucuk Dolken",
  unit: "m¹",
  volume: o.volume,
  unitPrice: o.harga,
  amount: BigInt(Math.round(o.volume * o.harga)),
  lineageKey: o.lineage ?? "V#3#3.b",
});

/** Persis keadaan Pasar Banggi V 3.b. */
const LAMA = [kat(), item({ id: "a", volume: 0, harga: HARGA_KONTRAK })];
const BARU = [kat(), item({ id: "b", volume: 704, harga: 0 })];

const baris = () => susunBarisCco(LAMA, BARU).rows.find((r) => r.jenis === "item")!;

describe("harga satuan kedua sisi dibawa, tidak dilebur jadi satu", () => {
  it("harga kontrak dan harga berkas sama-sama terbaca", () => {
    const r = baris();
    expect(r.hargaLama).toBe(HARGA_KONTRAK);
    expect(r.hargaBaru).toBe(0);
  });

  it("nilai item mengikuti berkas: nol tetap nol", () => {
    const r = baris();
    expect(r.jumlahBaru).toBe(0n);
    expect(r.jumlahTambah).toBe(0n);
    expect(r.ket).toBe("TETAP"); // nilainya tidak bergerak
  });

  it("item yang ada di kontrak tidak dianggap baru", () => {
    expect(baris().adaDiKontrak).toBe(true);
  });

  it("item yang benar-benar baru tetap ditandai baru", () => {
    const r = susunBarisCco(
      [kat()],
      [kat(), item({ id: "c", volume: 704, harga: HARGA_KONTRAK, lineage: "V#9#9.a" })],
    ).rows.find((x) => x.jenis === "item")!;
    expect(r.adaDiKontrak).toBe(false);
    expect(r.ket).toBe("BARU");
  });
});

async function lembar(lama: CcoNode[], baru: CcoNode[]): Promise<ExcelJS.Worksheet> {
  const buf = await buildCcoXlsx({
    ccoNo: 1,
    packageName: "Uji",
    workTitle: null,
    locationName: "Pasar Banggi",
    address: null,
    vendorName: null,
    contractNumber: null,
    ppnPercent: 11,
    nilaiTercatatLama: 0n,
    nilaiTercatatBaru: 0n,
    lama,
    baru,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.getWorksheet(1)!;
}

const teks = (c: ExcelJS.Cell): string => {
  const v = c.value;
  if (v == null) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "richText" in v)
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  return String(v);
};

const angka = (c: ExcelJS.Cell): number | string => {
  const v = c.value;
  if (v && typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    return typeof r === "number" ? r : String(r ?? "");
  }
  return typeof v === "number" ? v : String(v ?? "");
};

/**
 * Rumus sel apa adanya. Dipakai karena ExcelJS MEMBUANG cache hasil yang
 * bernilai 0 atau "" saat berkas ditulis-baca ulang – justru dua nilai yang
 * jadi pokok perkara di sini. Yang menentukan isi berkas memang rumusnya;
 * hasilnya dihitung Excel saat dibuka (`fullCalcOnLoad`).
 */
const rumus = (c: ExcelJS.Cell): string => {
  const v = c.value;
  return v && typeof v === "object" && "formula" in v ? String((v as { formula: string }).formula) : "";
};

/** KOLOM_CCO memetakan key → huruf kolom Excel ("F"); di sini perlu nomornya. */
const kolom = (key: string) => KOL[key]!.charCodeAt(0) - 64;

/** Baris item pertama pada lembar. */
function barisItem(ws: ExcelJS.Worksheet): ExcelJS.Row {
  let hasil: ExcelJS.Row | null = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (!hasil && /^(TETAP|TAMBAH|KURANG|BARU|HAPUS)$/.test(teks(row.getCell(kolom("ket")))))
      hasil = row;
  });
  return hasil!;
}

describe("dokumen CCO: item yang dinolkan di berkas adendum", () => {
  it("BUKTI PERBAIKAN: JUMLAH CCO-01 memakai harga BERKAS (0), bukan harga kontrak", async () => {
    const b = barisItem(await lembar(LAMA, BARU));
    expect(angka(b.getCell(kolom("volumeBaru")))).toBe(704);
    // "0*O11" – harga sisi CCO-01 dari berkas, bukan rujukan ke sel harga kontrak.
    expect(rumus(b.getCell(kolom("jumlahBaru")))).toMatch(/^0\*O\d+$/);
  });

  it("kolom PEKERJAAN TAMBAH dihitung dari selisih NILAI, bukan volume × harga kontrak", async () => {
    const b = barisItem(await lembar(LAMA, BARU));
    // Volumenya memang bertambah 704 – itu fakta berkas dan tetap disebut.
    expect(angka(b.getCell(kolom("volumeTambah")))).toBe(704);
    // Rumus lama: IF(I11="","",F11*I11) → 704 × harga kontrak. Sekarang selisih
    // JUMLAH kedua sisi, sehingga nilai yang nol tetap nol.
    const f = rumus(b.getCell(kolom("jumlahTambah")));
    expect(f).toMatch(/^IF\(P\d+-G\d+>0,P\d+-G\d+,""\)$/);
    expect(f).not.toMatch(/F\d+/); // tidak lagi mengalikan dengan sel harga
  });

  it("KET-nya bukan BARU – itemnya ada di kontrak sejak awal", async () => {
    expect(teks(barisItem(await lembar(LAMA, BARU)).getCell(kolom("ket")))).toBe("TAMBAH");
  });

  it("harga yang berselisih ditandai di selnya, tidak didiamkan", async () => {
    const sel = barisItem(await lembar(LAMA, BARU)).getCell(kolom("harga"));
    expect(sel.value).toBe(HARGA_KONTRAK);
    expect(String(sel.note ?? "")).toContain("berkas adendum");
  });

  it("selisihnya disebut di kaki dokumen beserta barisnya", async () => {
    const ws = await lembar(LAMA, BARU);
    let catatan = "";
    ws.eachRow({ includeEmpty: false }, (row) => {
      const t = teks(row.getCell(1));
      if (t.startsWith("PERHATIAN – harga satuan")) catatan = t;
    });
    expect(catatan).toContain("1 item");
    expect(catatan).toContain("3.b Pekerjaan Pancang Cerucuk Dolken");
  });
});

describe("baris berharga sama: perilaku lama tidak ikut berubah", () => {
  const SAMA = [kat(), item({ id: "d", volume: 704, harga: HARGA_KONTRAK })];

  it("volume naik dari 0 → pekerjaan tambah bernilai, seperti seharusnya", async () => {
    const b = barisItem(await lembar(LAMA, SAMA));
    expect(angka(b.getCell(kolom("jumlahTambah")))).toBeCloseTo(704 * HARGA_KONTRAK, 2);
    expect(teks(b.getCell(kolom("ket")))).toBe("TAMBAH");
    // Harga sama → sisi CCO-01 tetap menunjuk SEL harga, jadi mengubah harga di
    // Excel tetap menggerakkan kedua sisi.
    expect(rumus(b.getCell(kolom("jumlahBaru")))).toMatch(/^F\d+\*O\d+$/);
  });

  it("tidak ada peringatan harga – tanda ini bukan tanda yang selalu menyala", async () => {
    const ws = await lembar(LAMA, SAMA);
    let ada = false;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (teks(row.getCell(1)).startsWith("PERHATIAN – harga satuan")) ada = true;
    });
    expect(ada).toBe(false);
    expect(String(barisItem(ws).getCell(kolom("harga")).note ?? "")).toBe("");
  });
});
