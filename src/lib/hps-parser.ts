import ExcelJS from "exceljs";

/**
 * Parser HPS (Excel KKP) → pohon RAB. Fokus sheet "RAB".
 * Total kategori/subkategori dihitung dari SUM leaf (kolom Jumlah Harga),
 * bukan dari sheet Resume/Sub Resume (banyak sel formula tak ter-cache).
 *
 * Kolom RAB: A=kode, B=nama, E=volume, F=satuan, G=harga satuan,
 * H=jumlah harga, I=nilai TKDN. Format "mirip tapi tak identik" antar lokasi —
 * hierarki dideteksi dari pola kode + ada/tidaknya volume (leaf vs grup).
 */

export type ParsedItem = {
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  tkdn: number | null;
  children: ParsedItem[];
};

export type ParsedSubcategory = {
  code: string;
  name: string;
  totalValue: number;
  items: ParsedItem[];
};

export type ParsedCategory = {
  roman: string;
  name: string;
  totalValue: number;
  subcategories: ParsedSubcategory[];
  directItems: ParsedItem[];
};

export type ParsedHps = {
  meta: { project: string; location: string; year: number | null };
  categories: ParsedCategory[];
  grandTotal: number;
  warnings: string[];
};

const ROMAN = /^(X{0,3})(IX|IV|V?I{0,3})$/; // I..XXXIX
const SUBCODE = /^[IVX]+\.\d+(?:\.\d+)*\.?$/; // II.1., III.2.1.
const NUM = /^\d+$/; // 1, 2, 6
const DOTNUM = /^\d+\.\d+\.?$/; // 6.1, 6.1.
const LETTER = /^[a-z]$/i; // a, b, c

function cellVal(row: ExcelJS.Row, c: number): unknown {
  const v = row.getCell(c).value;
  if (v && typeof v === "object") {
    if ("result" in v) return (v as { result: unknown }).result;
    if ("text" in v) return (v as { text: unknown }).text;
    if ("richText" in v)
      return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    return null;
  }
  return v;
}
function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function isRoman(s: string): boolean {
  return s.length > 0 && ROMAN.test(s);
}

function sumLeaves(items: ParsedItem[]): number {
  let t = 0;
  for (const it of items) {
    // Grup = pakai total anak; kalau anak semua nihil (mis. baris deskripsi),
    // jatuhkan ke total node sendiri agar leaf tak kehilangan nilainya.
    const childSum = it.children.length > 0 ? sumLeaves(it.children) : 0;
    t += childSum > 0 ? childSum : it.totalPrice ?? 0;
  }
  return t;
}

export async function parseHpsBuffer(
  buffer: Buffer | Uint8Array | ArrayBuffer
): Promise<ParsedHps> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS' Buffer type predates @types/node generic Buffer — cast di sini.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  return parseHpsWorkbook(wb);
}

export function parseHpsWorkbook(wb: ExcelJS.Workbook): ParsedHps {
  const warnings: string[] = [];
  const ws = wb.getWorksheet("RAB") ?? wb.worksheets.find((w) => /rab/i.test(w.name));
  if (!ws) throw new Error('Sheet "RAB" tidak ditemukan di file HPS.');

  const meta = { project: "", location: "", year: null as number | null };
  const categories: ParsedCategory[] = [];

  let cat: ParsedCategory | null = null;
  let sub: ParsedSubcategory | null = null;
  let itemL1: ParsedItem | null = null; // item numerik (mis. "6")
  let itemL2: ParsedItem | null = null; // sub-item dotted (mis. "6.1")

  const mkItem = (code: string, name: string, row: ExcelJS.Row): ParsedItem => {
    const volume = num(cellVal(row, 5));
    return {
      code,
      name,
      volume,
      unit: volume != null ? str(cellVal(row, 6)) || null : null,
      unitPrice: num(cellVal(row, 7)),
      totalPrice: num(cellVal(row, 8)),
      tkdn: num(cellVal(row, 9)),
      children: [],
    };
  };
  const nameOf = (row: ExcelJS.Row): string =>
    str(cellVal(row, 2)) || str(cellVal(row, 3)) || str(cellVal(row, 4));

  ws.eachRow((row) => {
    const code = str(cellVal(row, 1));
    const name = nameOf(row);

    // Metadata ringan
    const joined = `${code} ${name}`.toUpperCase();
    if (joined.includes("PROYEK") && !meta.project) meta.project = str(cellVal(row, 4));
    if ((code.toUpperCase() === "LOKASI") && !meta.location) meta.location = str(cellVal(row, 4));
    if (joined.includes("TAHUN ANGGARAN")) meta.year = num(cellVal(row, 4));

    if (!code && !name) return;

    // Baris rekap/subtotal ("JUMLAH", "SUB TOTAL", "TOTAL", dll) — JANGAN masuk pohon.
    if (/^(jumlah|sub\s*total|total|grand\s*total|rekapitulasi)\b/i.test(name)) return;

    // Kategori (roman + nama diawali "PEKERJAAN")
    if (isRoman(code) && /^PEKERJAAN/i.test(name)) {
      cat = { roman: code, name, totalValue: 0, subcategories: [], directItems: [] };
      categories.push(cat);
      sub = null;
      itemL1 = null;
      itemL2 = null;
      return;
    }
    if (!cat) return; // baris sebelum kategori pertama (header) → skip

    // Subkategori (roman.num, nama diawali "Pekerjaan")
    if (SUBCODE.test(code) && /^Pekerjaan/i.test(name)) {
      sub = { code: code.replace(/\.$/, ""), name, totalValue: 0, items: [] };
      cat.subcategories.push(sub);
      itemL1 = null;
      itemL2 = null;
      return;
    }

    // Item numerik (1, 2, 6)
    if (NUM.test(code)) {
      const it = mkItem(code, name, row);
      (sub ? sub.items : cat.directItems).push(it);
      itemL1 = it;
      itemL2 = null;
      return;
    }

    // Sub-item dotted (6.1, 6.1.) → anak dari item numerik
    if (DOTNUM.test(code)) {
      const it = mkItem(code.replace(/\.$/, ""), name, row);
      if (itemL1) itemL1.children.push(it);
      else (sub ? sub.items : cat.directItems).push(it);
      itemL2 = it;
      return;
    }

    // Huruf (a,b,c) atau kode kosong (lanjutan) → anak grup terdalam saat ini
    if (LETTER.test(code) || code === "") {
      const parent = itemL2 ?? itemL1;
      const childCode = code
        ? `${parent?.code ?? "-"}.${code}`
        : `${parent?.code ?? "-"}.${(parent?.children.length ?? 0) + 1}`;
      const it = mkItem(childCode, name, row);
      // Baris kode-kosong tanpa nilai = deskripsi lanjutan, bukan item → skip.
      if (code === "" && it.totalPrice == null && it.volume == null) return;
      if (parent) parent.children.push(it);
      else (sub ? sub.items : cat.directItems).push(it);
      return;
    }

    // Pola lain (mis. subkategori tanpa prefix "Pekerjaan") — coba tebak
    if (SUBCODE.test(code)) {
      sub = { code: code.replace(/\.$/, ""), name, totalValue: 0, items: [] };
      cat.subcategories.push(sub);
      itemL1 = null;
      itemL2 = null;
    }
  });

  // Hitung total dari leaf
  for (const c of categories) {
    for (const s of c.subcategories) s.totalValue = sumLeaves(s.items);
    c.totalValue =
      sumLeaves(c.directItems) + c.subcategories.reduce((t, s) => t + s.totalValue, 0);
    if (c.totalValue === 0) warnings.push(`Kategori "${c.roman} ${c.name}" total 0 (cek parsing).`);
  }
  const grandTotal = categories.reduce((t, c) => t + c.totalValue, 0);

  return { meta, categories, grandTotal, warnings };
}
