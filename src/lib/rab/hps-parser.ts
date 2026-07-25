import ExcelJS from "exceljs";
import { slimRabWorkbook } from "@/lib/rab/xlsx-slim";
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
export type PriceSource = "nego" | "penawaran" | "hps";

/**
 * Deteksi kolom nilai, TAHAN 2 varian header:
 *  (a) satu baris: NO | JENIS | VOL | SAT | HARGA SATUAN | JUMLAH | TKDN
 *  (b) dua baris: baris grup "HPS | PENAWARAN | NEGOSIASI" (merge) DI ATAS baris
 *      "HARGA SATUAN | HARGA TOTAL" (berulang per blok).
 * Nilai KONTRAK = harga akhir: prioritas NEGOSIASI > PENAWARAN > HPS (HPS cuma
 * pagu, tak pernah jadi nilai kontrak). Fallback posisi klasik (G/H/I) bila tak
 * ada header terbaca (fixture uji). Kolom "HARGA TOTAL" dianggap sama dgn "JUMLAH".
 */
export function detectColumns(ws: ExcelJS.Worksheet): {
  col: ColMap;
  usedNego: boolean;
  priceSource: PriceSource;
} {
  const classic: ColMap = { vol: 5, unit: 6, price: 7, amount: 8, tkdn: 9 };
  const NC = 24;
  const labelsOf = (row: ExcelJS.Row): string[] => {
    const arr: string[] = [];
    for (let c = 1; c <= NC; c++) arr[c] = str(cellVal(row, c)).toUpperCase().trim();
    return arr;
  };

  // Baris header UTAMA = punya VOL & SAT (satuan) sebagai sel terpisah. Ini menghindari
  // salah-deteksi baris rekap "JUMLAH" (kolom B) sbg header.
  let mainRow: ExcelJS.Row | null = null;
  for (let rn = 1; rn <= 25; rn++) {
    const L = labelsOf(ws.getRow(rn));
    if (L.some((l) => /^VOL/.test(l)) && L.some((l) => /^SAT/.test(l))) {
      mainRow = ws.getRow(rn);
      break;
    }
  }
  if (!mainRow) return { col: classic, usedNego: false, priceSource: "hps" };

  const grp = labelsOf(mainRow); // baris grup: HPS/PENAWARAN/NEGOSIASI (+ VOL/SAT)
  const below = labelsOf(ws.getRow(mainRow.number + 1));
  const twoRow = below.some((l) => /HARGA\s*SATUAN/.test(l)); // header 2 baris (grup + satuan/total)
  const sub = twoRow ? below : grp;

  const findFirst = (pred: (c: number) => boolean): number | null => {
    for (let c = 1; c <= NC; c++) if (pred(c)) return c;
    return null;
  };
  // Label grup utk kolom c = sel non-kosong terdekat di KIRI (merge left-anchored).
  const groupAt = (c: number): string => {
    for (let k = c; k >= 1; k--) if (grp[k]) return grp[k];
    return "";
  };
  const isSatuan = (c: number) => /HARGA\s*SATUAN/.test(sub[c] ?? "");
  const isTotal = (c: number) => /HARGA\s*TOTAL|JUMLAH/.test(sub[c] ?? "");
  // Header harga satu-baris (mis. "NILAI HPS", "HARGA NEGOISASI") — kolom harga langsung.
  const isPriceHeader = (s: string) =>
    /HARGA|NILAI/.test(s) && !/JUMLAH|TOTAL/.test(s) && !/^SAT/.test(s) && !/^VOL/.test(s) && !/TKDN/.test(s);

  /** Kolom HARGA SATUAN untuk blok (NEGO/PENAWAR/HPS). Dukung header 1- & 2-baris. */
  const blockPrice = (re: RegExp): number | null =>
    twoRow
      ? findFirst((c) => re.test(groupAt(c)) && isSatuan(c))
      : findFirst((c) => re.test(grp[c] ?? "") && isPriceHeader(grp[c] ?? ""));
  /** Kolom TOTAL/JUMLAH untuk blok, sesudah kolom harga-nya. */
  const blockTotal = (re: RegExp, priceIdx: number): number | null =>
    twoRow
      ? findFirst((c) => re.test(groupAt(c)) && isTotal(c))
      : findFirst((c) => c > priceIdx && /JUMLAH|TOTAL/.test(grp[c] ?? ""));

  const vol = findFirst((c) => /^VOL/.test(grp[c] ?? "")) ?? classic.vol;
  const unit = findFirst((c) => /^SAT/.test(grp[c] ?? "")) ?? classic.unit;
  // TKDN: pakai kolom bila terdeteksi; kalau tidak, kolom jauh (kosong → null) supaya
  // tak salah baca kolom harga blok lain sbg rasio TKDN.
  const tkdn = findFirst((c) => /TKDN/.test(sub[c] ?? "") || /TKDN/.test(grp[c] ?? "")) ?? 999;

  // Nilai kontrak = harga akhir: NEGOSIASI > PENAWARAN > HPS.
  let price: number | null;
  let priceSource: PriceSource;
  if ((price = blockPrice(/NEGO/)) != null) priceSource = "nego";
  else if ((price = blockPrice(/PENAWAR/)) != null) priceSource = "penawaran";
  else {
    price =
      (twoRow ? findFirst(isSatuan) : blockPrice(/HPS/) ?? findFirst((c) => isPriceHeader(grp[c] ?? ""))) ??
      classic.price;
    priceSource = "hps";
  }
  const re = priceSource === "nego" ? /NEGO/ : priceSource === "penawaran" ? /PENAWAR/ : /HPS/;
  const amount = blockTotal(re, price) ?? (twoRow ? findFirst(isTotal) : null) ?? price + 1;

  return { col: { vol, unit, price, amount, tkdn }, usedNego: priceSource !== "hps", priceSource };
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
  // Rampingkan dulu ke sheet RAB saja (buang 40+ sheet volume & ribuan defined
  // names sampah) agar exceljs tak OOM pada file HPS/Negosiasi raksasa. Bila file
  // tak cocok pola, slimRabWorkbook mengembalikan buffer asli (aman).
  let loadBuf: Buffer;
  try {
    loadBuf = await slimRabWorkbook(buf);
  } catch {
    loadBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }
  const wb = new ExcelJS.Workbook();
  // Tipe Buffer ExcelJS lebih tua dari @types/node generic Buffer — cast di sini.
  await wb.xlsx.load(loadBuf as unknown as ArrayBuffer);
  return parseHpsWorkbook(wb);
}

export function parseHpsWorkbook(wb: ExcelJS.Workbook): {
  parsed: ParsedRab;
  warnings: string[];
} {
  const warnings: string[] = [];
  const ws = wb.getWorksheet("RAB") ?? wb.worksheets.find((w) => /rab/i.test(w.name));
  if (!ws) throw new Error('Sheet "RAB" tidak ditemukan di file HPS.');

  // Nilai kontrak = harga akhir (NEGOSIASI > PENAWARAN > HPS). HPS cuma pagu.
  const { col, priceSource } = detectColumns(ws);
  if (priceSource === "nego")
    warnings.push("File punya kolom HARGA NEGOSIASI — nilai kontrak diambil dari kolom itu (bukan HPS).");
  else if (priceSource === "penawaran")
    warnings.push("File tidak punya kolom NEGOSIASI — nilai kontrak diambil dari kolom PENAWARAN (bukan HPS).");

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

  let hiddenSkipped = 0;
  ws.eachRow((row) => {
    // Baris yang SENGAJA DI-HIDE di Excel (mis. dikecualikan dari resume) tidak
    // ikut dihitung — importer mengikuti apa yang terlihat, sama seperti resume
    // kontrak. Sinyal: atribut hidden Excel; height 0 sbg cadangan defensif.
    if (row.hidden === true || row.height === 0) {
      const c = str(cellVal(row, 1));
      const nm = nameOf(row);
      if ((c || nm) && !isSummaryRow(nm)) hiddenSkipped++;
      return;
    }

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

  if (hiddenSkipped > 0)
    warnings.push(
      `${hiddenSkipped} baris tersembunyi (hidden) di Excel diabaikan — tidak masuk perhitungan (mengikuti resume kontrak).`,
    );

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
