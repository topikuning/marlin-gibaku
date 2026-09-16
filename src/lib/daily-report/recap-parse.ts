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

export type RecapRowStatus =
  | "ok"
  | "unmatched"
  /**
   * Kodenya dipakai lebih dari satu pekerjaan dan uraiannya tidak memihak
   * siapa pun. Menebak salah satu berarti volume mendarat di pekerjaan lain
   * tanpa ada yang tahu — lebih baik berhenti dan menyebut kandidatnya.
   */
  | "ambigu"
  /** Tanggal & pekerjaan sama dengan baris sebelumnya: volumenya dijumlahkan ke sana. */
  | "digabung"
  | "bad_date"
  | "future_date"
  | "zero_volume"
  | "over_volume";

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
      "Header tidak ditemukan. Pastikan ada kolom Tanggal, Volume, dan Kode/Uraian pekerjaan – gunakan template unduhan.",
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

type HasilCocok =
  | { leaf: RecapLeaf }
  | { leaf: null; kandidat: RecapLeaf[] };

/** Cocokkan baris rekap ke leaf RAB + tandai masalah. Fungsi MURNI. */
export function matchRows(rows: ParsedRecapRow[], leaves: RecapLeaf[], todayKey: string): RecapMatch[] {
  /*
   * KODE BUKAN KUNCI UNIK.
   *
   * RAB KNMP lazim memakai kode item yang berulang antar kategori — item "1" di
   * kategori I dan item "1" di kategori II. Yang membedakan keduanya lineageKey.
   * Versi pertama menyimpan SATU leaf per kode (`set()` polos), jadi yang menang
   * leaf terakhir yang kebetulan dibaca `findMany` — dan urutan itu tidak dijamin
   * sama antara permintaan pratinjau dan permintaan commit.
   *
   * Sekarang tiap kode menyimpan SEMUA kandidatnya; yang memutuskan uraiannya.
   * Kalau uraian tidak memihak, jangan menebak. DECISIONS 203 melarang angka
   * pengguna "dibetulkan" diam-diam — dan memindahkannya ke pekerjaan lain jauh
   * lebih buruk daripada membetulkannya. Audit 2026-09-15 (C-1).
   */
  const byCode = new Map<string, RecapLeaf[]>();
  const byName = new Map<string, RecapLeaf>();
  for (const l of leaves) {
    const codeKey = normalize(l.code);
    if (codeKey) (byCode.get(codeKey) ?? byCode.set(codeKey, []).get(codeKey)!).push(l);
    const nameKey = normalize(l.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, l);
  }

  /** Persempit kandidat dengan uraian: sama persis dulu, baru saling-memuat. */
  const saringDenganNama = (kandidat: RecapLeaf[], nameKey: string): RecapLeaf[] => {
    if (!nameKey) return kandidat;
    const persis = kandidat.filter((l) => normalize(l.name) === nameKey);
    if (persis.length === 1) return persis;
    const memuat = kandidat.filter((l) => {
      const n = normalize(l.name);
      return n.includes(nameKey) || nameKey.includes(n);
    });
    return memuat.length === 1 ? memuat : persis.length > 0 ? persis : kandidat;
  };

  const findLeaf = (row: ParsedRecapRow): HasilCocok => {
    const codeKey = normalize(row.code);
    const nameKey = normalize(row.name);
    const sekode = codeKey ? (byCode.get(codeKey) ?? []) : [];
    if (sekode.length === 1) return { leaf: sekode[0] };
    if (sekode.length > 1) {
      const sisa = saringDenganNama(sekode, nameKey);
      return sisa.length === 1 ? { leaf: sisa[0] } : { leaf: null, kandidat: sisa };
    }
    if (!nameKey) return { leaf: null, kandidat: [] };
    if (byName.has(nameKey)) return { leaf: byName.get(nameKey)! };
    const hits = leaves.filter((l) => {
      const n = normalize(l.name);
      return n.includes(nameKey) || nameKey.includes(n);
    });
    return hits.length === 1 ? { leaf: hits[0] } : { leaf: null, kandidat: [] };
  };

  const runningByLineage = new Map<string, number>();
  /*
   * BARIS KEMBAR (tanggal + pekerjaan sama) DIGABUNG, bukan saling menimpa.
   *
   * `commitRecap` menyimpan lewat `upsertItem` pada kunci unik
   * (reportId, lineageKey): dua baris untuk hari & pekerjaan yang sama membuat
   * yang kedua MENIMPA yang pertama — pratinjau menjanjikan 3+4, yang tersimpan
   * 4. Volumenya dijumlahkan di sini supaya yang dijanjikan layar sama dengan
   * yang masuk basis data, dan penggabungannya DIKATAKAN. Audit 2026-09-15 (C-2).
   */
  const pertamaPerHariItem = new Map<string, RecapMatch>();

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

    const cocok = findLeaf(row);
    if (!cocok.leaf) {
      if (cocok.kandidat.length > 1) {
        const daftar = cocok.kandidat.map((l) => `${l.code || "?"} ${l.name}`).join(" · ");
        return {
          ...base,
          status: "ambigu",
          message: `Kode "${row.code}" dipakai ${cocok.kandidat.length} pekerjaan – sebutkan uraian yang tepat: ${daftar}`,
        };
      }
      return { ...base, status: "unmatched", message: `Pekerjaan tak dikenali: "${row.name || row.code}"` };
    }
    const leaf = cocok.leaf;

    const matched = { ...base, matchedNodeId: leaf.id, matchedName: leaf.name, matchedCode: leaf.code, unit: leaf.unit };

    if (!Number.isFinite(row.volume) || row.volume <= 0) {
      return { ...matched, status: "zero_volume", message: "Volume harus lebih dari 0" };
    }

    const running = runningByLineage.get(leaf.lineageKey) ?? 0;
    if (leaf.volume != null && leaf.doneCumulative + running + row.volume > leaf.volume + VOLUME_EPSILON) {
      const sisa = Math.max(0, Math.round((leaf.volume - leaf.doneCumulative - running) * 1000) / 1000);
      const valueDone = Number(calcValueDone(row.volume, leaf.unitPrice));
      return { ...matched, status: "over_volume", valueDone, message: `Melebihi sisa RAB (sisa ${sisa} ${leaf.unit ?? ""})`.trim() };
    }
    runningByLineage.set(leaf.lineageKey, running + row.volume);

    // Baris kembar: volumenya masuk ke baris PERTAMA hari itu, bukan berdiri sendiri.
    const kunciHariItem = `${row.dateKey} ${leaf.lineageKey}`;
    const pertama = pertamaPerHariItem.get(kunciHariItem);
    if (pertama) {
      pertama.volume = Math.round((pertama.volume + row.volume) * 1000) / 1000;
      pertama.valueDone = Number(calcValueDone(pertama.volume, leaf.unitPrice));
      return {
        ...matched,
        status: "digabung",
        message: `Digabung ke baris ${pertama.rowNum} (tanggal & pekerjaan sama) – total ${pertama.volume} ${leaf.unit ?? ""}`.trim(),
      };
    }

    const hasil: RecapMatch = {
      ...matched,
      status: "ok",
      valueDone: Number(calcValueDone(row.volume, leaf.unitPrice)),
      message: null,
    };
    pertamaPerHariItem.set(kunciHariItem, hasil);
    return hasil;
  });
}
