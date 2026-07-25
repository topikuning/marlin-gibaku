import "server-only";
import ExcelJS from "exceljs";
import { jakartaDateKey } from "@/lib/format";
import { valueDone as calcValueDone } from "@/lib/money";
import { VOLUME_EPSILON } from "./constants";

/**
 * Bagian MURNI impor rekap laporan harian: parser Excel + pencocokan ke leaf RAB.
 * Tanpa akses DB (bisa diuji unit tanpa env). Orkestrasi DB + commit ada di
 * recap-import.ts. DECISIONS 114.
 */

export type ParsedRecapRow = {
  rowNum: number;
  rawDate: string;
  dateKey: string | null;
  code: string;
  name: string;
  volume: number;
};

export type RecapLeaf = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  unitPrice: number;
  lineageKey: string;
  doneCumulative: number;
};

export type RecapRowStatus = "ok" | "unmatched" | "bad_date" | "future_date" | "zero_volume" | "over_volume";

export type RecapMatch = ParsedRecapRow & {
  status: RecapRowStatus;
  matchedNodeId: string | null;
  matchedName: string | null;
  matchedCode: string | null;
  unit: string | null;
  valueDone: number | null;
  message: string | null;
};

// ─── Parsing ──────────────────────────────────────────────────

const RE_DATE = /tanggal|tgl|date/i;
const RE_CODE = /\bkode\b/i;
const RE_NAME = /uraian|pekerjaan|nama|deskripsi|item/i;
const RE_VOLUME = /volume|kuantitas|\bqty\b|\bvol\b|realisasi|terpasang/i;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result != null) return o.result instanceof Date ? o.result.toISOString() : String(o.result).trim();
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("").trim();
    if (typeof o.text === "string") return o.text.trim();
  }
  return String(v).trim();
}

function toNum(v: ExcelJS.CellValue): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && !(v instanceof Date)) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === "number") return r;
    if (r != null && Number.isFinite(Number(r))) return Number(r);
  }
  const n = Number(String(v).replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Ubah nilai sel tanggal (Date exceljs / string ISO / DD-MM-YYYY) → key "YYYY-MM-DD". */
function toDateKey(v: ExcelJS.CellValue): string | null {
  const asDate =
    v instanceof Date
      ? v
      : v && typeof v === "object" && (v as { result?: unknown }).result instanceof Date
        ? ((v as { result?: unknown }).result as Date)
        : null;
  if (asDate) return jakartaDateKey(asDate);

  const s = cellText(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${y}-${m}-${d}`;
  }
  return null;
}

/** Baca workbook rekap → baris mentah (deteksi header fleksibel). */
export async function parseRecapWorkbook(buf: Buffer): Promise<ParsedRecapRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File Excel tidak berisi sheet apa pun.");

  let headerRow = -1;
  let colDate = -1;
  let colCode = -1;
  let colName = -1;
  let colVolume = -1;
  const maxScan = Math.min(ws.rowCount, 40);
  for (let r = 1; r <= maxScan && headerRow < 0; r++) {
    const row = ws.getRow(r);
    let cDate = -1;
    let cCode = -1;
    let cName = -1;
    let cVol = -1;
    for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
      const t = cellText(row.getCell(c).value);
      if (!t) continue;
      if (cDate < 0 && RE_DATE.test(t)) cDate = c;
      else if (cVol < 0 && RE_VOLUME.test(t)) cVol = c;
      else if (cCode < 0 && RE_CODE.test(t)) cCode = c;
      else if (cName < 0 && RE_NAME.test(t)) cName = c;
    }
    if (cDate > 0 && cVol > 0 && (cCode > 0 || cName > 0)) {
      headerRow = r;
      colDate = cDate;
      colCode = cCode;
      colName = cName;
      colVolume = cVol;
    }
  }
  if (headerRow < 0) {
    throw new Error(
      "Header tidak ditemukan. Pastikan ada kolom Tanggal, Volume, dan Kode/Uraian pekerjaan — gunakan template unduhan.",
    );
  }

  const rows: ParsedRecapRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawDate = cellText(row.getCell(colDate).value);
    const code = colCode > 0 ? cellText(row.getCell(colCode).value) : "";
    const name = colName > 0 ? cellText(row.getCell(colName).value) : "";
    const volume = toNum(row.getCell(colVolume).value);
    if (!rawDate && !code && !name && !volume) continue;
    rows.push({ rowNum: r, rawDate, dateKey: toDateKey(row.getCell(colDate).value), code, name, volume });
  }
  return rows;
}

// ─── Pencocokan (murni) ───────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Cocokkan baris rekap ke leaf RAB + tandai masalah. Fungsi MURNI. */
export function matchRows(rows: ParsedRecapRow[], leaves: RecapLeaf[], todayKey: string): RecapMatch[] {
  const byCode = new Map<string, RecapLeaf>();
  const byName = new Map<string, RecapLeaf>();
  for (const l of leaves) {
    const codeKey = normalize(l.code);
    if (codeKey) byCode.set(codeKey, l);
    const nameKey = normalize(l.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, l);
  }

  const findLeaf = (row: ParsedRecapRow): RecapLeaf | null => {
    const codeKey = normalize(row.code);
    if (codeKey && byCode.has(codeKey)) return byCode.get(codeKey)!;
    const nameKey = normalize(row.name);
    if (!nameKey) return null;
    if (byName.has(nameKey)) return byName.get(nameKey)!;
    const hits = leaves.filter((l) => {
      const n = normalize(l.name);
      return n.includes(nameKey) || nameKey.includes(n);
    });
    return hits.length === 1 ? hits[0] : null;
  };

  const runningByLineage = new Map<string, number>();

  return rows.map((row): RecapMatch => {
    const base: Omit<RecapMatch, "status"> = {
      ...row,
      matchedNodeId: null,
      matchedName: null,
      matchedCode: null,
      unit: null,
      valueDone: null,
      message: null,
    };

    if (!row.dateKey) return { ...base, status: "bad_date", message: `Tanggal tidak terbaca: "${row.rawDate}"` };
    if (row.dateKey > todayKey) return { ...base, status: "future_date", message: "Tanggal belum terjadi" };

    const leaf = findLeaf(row);
    if (!leaf) return { ...base, status: "unmatched", message: `Pekerjaan tak dikenali: "${row.name || row.code}"` };

    const matched = { ...base, matchedNodeId: leaf.id, matchedName: leaf.name, matchedCode: leaf.code, unit: leaf.unit };

    if (!Number.isFinite(row.volume) || row.volume <= 0) {
      return { ...matched, status: "zero_volume", message: "Volume harus lebih dari 0" };
    }

    const running = runningByLineage.get(leaf.lineageKey) ?? 0;
    const valueDone = Number(calcValueDone(row.volume, leaf.unitPrice));
    if (leaf.volume != null && leaf.doneCumulative + running + row.volume > leaf.volume + VOLUME_EPSILON) {
      const sisa = Math.max(0, Math.round((leaf.volume - leaf.doneCumulative - running) * 1000) / 1000);
      return { ...matched, status: "over_volume", valueDone, message: `Melebihi sisa RAB (sisa ${sisa} ${leaf.unit ?? ""})`.trim() };
    }

    runningByLineage.set(leaf.lineageKey, running + row.volume);
    return { ...matched, status: "ok", valueDone, message: null };
  });
}
