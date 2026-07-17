import ExcelJS from "exceljs";
import type {
  ParsedRab,
  ParsedRabCategory,
  ParsedRabItem,
  ParsedRabSubcategory,
} from "@/lib/rab/parsed";

/**
 * Parser HPS (Excel KKP) → pohon RAB. Fokus sheet "RAB".
 * Port dari kode lama (b6e77af src/lib/hps-parser.ts) — logika hierarki PERSIS:
 *   - roman + nama ^PEKERJAAN        → kategori
 *   - kode II.1 + nama ^Pekerjaan    → subkategori
 *   - kode angka (1, 2, 6)           → item level-1
 *   - kode x.y (6.1)                 → anak item level-1
 *   - huruf (a,b) / kode kosong      → anak grup terdalam saat ini
 *   - baris JUMLAH/SUB TOTAL/TOTAL   → skip
 * Total kategori/subkategori dihitung dari SUM leaf (kolom Jumlah Harga),
 * bukan dari sheet Resume (banyak sel formula tak ter-cache).
 * Tambahan vs lama: duplikat kode subkategori dalam satu kategori → `kode#2`
 * (dulu dilakukan di rab-import; sekarang di parser agar lineage unik).
 *
 * Kolom nilai DIDETEKSI dari baris header (detectColumns) — bukan hardcode —
 * karena RAB KKP bervariasi. Bila ada kolom "HARGA NEGOSIASI" (+ "JUMLAH HARGA"),
 * itu yang dipakai sebagai NILAI KONTRAK (bukan HPS). Layout klasik (tanpa
 * negosiasi): A=kode, B=nama, E=volume, F=satuan, G=harga satuan, H=jumlah, I=TKDN.
 */

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
export function isRoman(s: string): boolean {
  return s.length > 0 && ROMAN.test(s);
}

/** Klasifikasi baris berdasarkan pola kode + nama — diexport untuk testability. */
export type RowKind = "kategori" | "sub" | "item" | "dotitem" | "letter" | "blank" | "other";
export function classifyRow(code: string, name: string): RowKind {
  if (isRoman(code) && /^PEKERJAAN/i.test(name)) return "kategori";
  if (SUBCODE.test(code) && /^Pekerjaan/i.test(name)) return "sub";
  if (NUM.test(code)) return "item";
  if (DOTNUM.test(code)) return "dotitem";
  if (LETTER.test(code)) return "letter";
  if (code === "") return "blank";
  return "other";
}

/** Baris rekap ("JUMLAH", "SUB TOTAL", …) — tidak masuk pohon. */
export function isSummaryRow(name: string): boolean {
  return /^(jumlah|sub\s*total|total|grand\s*total|rekapitulasi)\b/i.test(name);
}

/** Peta kolom nilai (1-indexed) hasil deteksi header. */
export type ColMap = { vol: number; unit: number; price: number; amount: number; tkdn: number };

/**
 * Deteksi kolom dari baris header. RAB KKP bervariasi: sebagian hanya HPS
 * (harga satuan/jumlah), sebagian punya blok HARGA NEGOSIASI (hasil klarifikasi)
 * SETELAH kolom HPS. Nilai KONTRAK = harga negosiasi bila ada — itu yang dipakai
 * (bukan HPS), sesuai dokumen kontrol lapangan. Fallback ke posisi klasik
 * (G=harga, H=jumlah, I=TKDN) bila header tak terbaca (mis. fixture uji).
 */
export function detectColumns(ws: ExcelJS.Worksheet): { col: ColMap; usedNego: boolean } {
  const classic: ColMap = { vol: 5, unit: 6, price: 7, amount: 8, tkdn: 9 };
  let headerRow: ExcelJS.Row | null = null;
  for (let rn = 1; rn <= 20; rn++) {
    const row = ws.getRow(rn);
    let hasVol = false;
    let hasJml = false;
    for (let c = 1; c <= 20; c++) {
      const l = str(cellVal(row, c)).toUpperCase();
      if (/^VOL/.test(l)) hasVol = true;
      if (/JUMLAH/.test(l)) hasJml = true;
    }
    if (hasVol && hasJml) {
      headerRow = row;
      break;
    }
  }
  if (!headerRow) return { col: classic, usedNego: false };
  const label = (c: number) => str(cellVal(headerRow!, c)).toUpperCase();
  const findCol = (re: RegExp, from = 1, to = 20): number | null => {
    for (let c = from; c <= to; c++) if (re.test(label(c))) return c;
    return null;
  };
  const vol = findCol(/^VOL/) ?? classic.vol;
  const unit = findCol(/^SAT/) ?? classic.unit;
  const tkdn = findCol(/TKDN/) ?? classic.tkdn;
  const nego = findCol(/NEGO/); // "HARGA NEGOISASI"/"NEGOSIASI" (harga satuan nego)
  let price: number;
  let amount: number;
  let usedNego = false;
  if (nego != null) {
    price = nego;
    amount = findCol(/JUMLAH/, nego + 1) ?? nego + 1; // "JUMLAH HARGA" sesudah nego
    usedNego = true;
  } else {
    price = findCol(/HARGA\s*SATUAN|NILAI\s*HPS|^HARGA/) ?? classic.price;
    amount = findCol(/JUMLAH/) ?? classic.amount;
  }
  return { col: { vol, unit, price, amount, tkdn }, usedNego };
}

export function sumLeaves(items: ParsedRabItem[]): number {
  let t = 0;
  for (const it of items) {
    // Grup = pakai total anak; kalau anak semua nihil (mis. baris deskripsi),
    // jatuhkan ke total node sendiri agar leaf tak kehilangan nilainya.
    const childSum = it.children.length > 0 ? sumLeaves(it.children) : 0;
    t += childSum > 0 ? childSum : it.total_price ?? 0;
  }
  return t;
}

export async function parseHpsBuffer(
  buf: Buffer | ArrayBuffer,
): Promise<{ parsed: ParsedRab; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  // Tipe Buffer ExcelJS lebih tua dari @types/node generic Buffer — cast di sini.
  await wb.xlsx.load(buf as ArrayBuffer);
  return parseHpsWorkbook(wb);
}

export function parseHpsWorkbook(wb: ExcelJS.Workbook): {
  parsed: ParsedRab;
  warnings: string[];
} {
  const warnings: string[] = [];
  const ws = wb.getWorksheet("RAB") ?? wb.worksheets.find((w) => /rab/i.test(w.name));
  if (!ws) throw new Error('Sheet "RAB" tidak ditemukan di file HPS.');

  // Nilai kontrak = kolom HARGA NEGOSIASI bila ada; kalau tidak, kolom JUMLAH (HPS).
  const { col, usedNego } = detectColumns(ws);
  if (usedNego)
    warnings.push(
      "File punya kolom HARGA NEGOSIASI — nilai kontrak diambil dari kolom itu (bukan HPS).",
    );

  let project = "";
  let locationRaw = "";
  let year: number | null = null;
  const categories: ParsedRabCategory[] = [];

  let cat: ParsedRabCategory | null = null;
  let sub: ParsedRabSubcategory | null = null;
  let itemL1: ParsedRabItem | null = null; // item numerik (mis. "6")
  let itemL2: ParsedRabItem | null = null; // sub-item dotted (mis. "6.1")
  let subSeen = new Map<string, number>(); // dedup kode sub per kategori

  const mkItem = (
    code: string,
    name: string,
    row: ExcelJS.Row,
    parentCode: string | null,
  ): ParsedRabItem => {
    const volume = num(cellVal(row, col.vol));
    return {
      code,
      name,
      volume,
      unit: volume != null ? str(cellVal(row, col.unit)) || null : null,
      unit_price: num(cellVal(row, col.price)),
      total_price: num(cellVal(row, col.amount)),
      tkdn_ratio: num(cellVal(row, col.tkdn)),
      parent_code: parentCode,
      children: [],
    };
  };
  const nameOf = (row: ExcelJS.Row): string =>
    str(cellVal(row, 2)) || str(cellVal(row, 3)) || str(cellVal(row, 4));
  const pushSub = (code: string, name: string): void => {
    const clean = code.replace(/\.$/, "");
    const n = subSeen.get(clean) ?? 0;
    subSeen.set(clean, n + 1);
    sub = {
      code: n === 0 ? clean : `${clean}#${n + 1}`,
      name,
      total_value: 0,
      items: [],
    };
    cat!.subcategories.push(sub);
    itemL1 = null;
    itemL2 = null;
  };

  /** Prefix roman dari kode sub ("VIII.3.1" → "VIII"), atau null bila bukan roman. */
  const romanPrefixOf = (code: string): string | null => {
    const first = code.split(".")[0];
    return isRoman(first) ? first : null;
  };
  /**
   * Beberapa RAB (mis. RAB_Nyamplung) punya kategori TANPA baris judul —
   * hanya muncul lewat sub-kode (VIII.1, VIII.3). Tanpa deteksi ini, sub-kode
   * itu nyangkut ke kategori sebelumnya & menggelembungkan totalnya. Bila prefix
   * roman sub ≠ kategori berjalan, buka kategori baru (judul placeholder + warning).
   */
  const openInferredCategory = (roman: string): void => {
    cat = {
      roman,
      name: `PEKERJAAN (kategori ${roman} — judul tidak ada di file)`,
      total_value: 0,
      subcategories: [],
      direct_items: [],
    };
    categories.push(cat);
    sub = null;
    itemL1 = null;
    itemL2 = null;
    subSeen = new Map();
    warnings.push(
      `Kategori ${roman} tidak punya baris judul di file — dibuat otomatis dari sub-kode ${roman}.x agar totalnya tidak tergabung ke kategori sebelumnya. Mohon lengkapi judul kategori ${roman}.`,
    );
  };

  ws.eachRow((row) => {
    const code = str(cellVal(row, 1));
    const name = nameOf(row);

    // Metadata ringan
    const joined = `${code} ${name}`.toUpperCase();
    if (joined.includes("PROYEK") && !project) project = str(cellVal(row, 4));
    if (code.toUpperCase() === "LOKASI" && !locationRaw) locationRaw = str(cellVal(row, 4));
    if (joined.includes("TAHUN ANGGARAN")) year = num(cellVal(row, 4));

    if (!code && !name) return;

    // Baris rekap/subtotal ("JUMLAH", "SUB TOTAL", "TOTAL", dll) — JANGAN masuk pohon.
    if (isSummaryRow(name)) return;

    // Kategori (roman + nama diawali "PEKERJAAN")
    if (isRoman(code) && /^PEKERJAAN/i.test(name)) {
      cat = { roman: code, name, total_value: 0, subcategories: [], direct_items: [] };
      categories.push(cat);
      sub = null;
      itemL1 = null;
      itemL2 = null;
      subSeen = new Map();
      return;
    }
    if (!cat) return; // baris sebelum kategori pertama (header) → skip

    // Subkategori (roman.num, nama diawali "Pekerjaan")
    if (SUBCODE.test(code) && /^Pekerjaan/i.test(name)) {
      const rp = romanPrefixOf(code);
      if (rp && cat && rp !== cat.roman) openInferredCategory(rp);
      pushSub(code, name);
      return;
    }

    // Item numerik (1, 2, 6)
    if (NUM.test(code)) {
      const it = mkItem(code, name, row, null);
      (sub ? sub.items : cat.direct_items).push(it);
      itemL1 = it;
      itemL2 = null;
      return;
    }

    // Sub-item dotted (6.1, 6.1.) → anak dari item numerik
    if (DOTNUM.test(code)) {
      const it = mkItem(code.replace(/\.$/, ""), name, row, itemL1?.code ?? null);
      if (itemL1) itemL1.children.push(it);
      else (sub ? sub.items : cat.direct_items).push(it);
      itemL2 = it;
      return;
    }

    // Huruf (a,b,c) atau kode kosong (lanjutan) → anak grup terdalam saat ini
    if (LETTER.test(code) || code === "") {
      const parent = itemL2 ?? itemL1;
      const childCode = code
        ? `${parent?.code ?? "-"}.${code}`
        : `${parent?.code ?? "-"}.${(parent?.children.length ?? 0) + 1}`;
      const it = mkItem(childCode, name, row, parent?.code ?? null);
      // Baris kode-kosong tanpa nilai = deskripsi lanjutan, bukan item → skip.
      if (code === "" && it.total_price == null && it.volume == null) return;
      if (parent) parent.children.push(it);
      else (sub ? sub.items : cat.direct_items).push(it);
      return;
    }

    // Pola lain (mis. subkategori tanpa prefix "Pekerjaan") — coba tebak
    if (SUBCODE.test(code)) {
      const rp = romanPrefixOf(code);
      if (rp && cat && rp !== cat.roman) openInferredCategory(rp);
      pushSub(code, name);
    }
  });

  // Hitung total dari leaf
  for (const c of categories) {
    for (const s of c.subcategories) s.total_value = sumLeaves(s.items);
    c.total_value =
      sumLeaves(c.direct_items) + c.subcategories.reduce((t, s) => t + s.total_value, 0);
    if (c.total_value === 0)
      warnings.push(`Kategori "${c.roman} ${c.name}" total 0 (cek parsing).`);
  }
  const total = categories.reduce((t, c) => t + c.total_value, 0);

  const parsed: ParsedRab = {
    meta: {
      slug: null,
      village: null,
      regency: null,
      province: null,
      gps_lat: null,
      gps_lng: null,
      contract_number: null,
      contractor: null,
      start_date: null,
      end_date: null,
    },
    project,
    location_name_raw: locationRaw || null,
    province_raw: null,
    year,
    total,
    categories,
  };

  return { parsed, warnings };
}
