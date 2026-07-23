import "server-only";
import ExcelJS from "exceljs";

/**
 * Parser xlsx batch master lokasi. Kolom dideteksi dari BARIS HEADER (bukan
 * posisi tetap) supaya toleran urutan/kapitalisasi. Kolom yang dikenali:
 *   PROVINSI · KABUPATEN/KOTA · KECAMATAN · DESA/KELURAHAN · LATITUDE ·
 *   LONGITUDE · CALON PENYEDIA (perusahaan).
 * Wajib minimal: provinsi, kabupaten, desa.
 */

export type ParsedMasterRow = {
  province: string;
  regency: string;
  district: string | null;
  village: string;
  latitude: number | null;
  longitude: number | null;
  candidateVendor: string | null;
};

export type MasterImportResult = {
  rows: ParsedMasterRow[];
  warnings: string[];
};

const cellStr = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    // Rich text / hyperlink / formula result.
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.result != null) return String(o.result);
    return "";
  }
  return String(v);
};

const cellNum = (v: ExcelJS.CellValue): number | null => {
  const s = cellStr(v).replace(",", ".").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

type ColMap = {
  province: number;
  regency: number;
  district: number;
  village: number;
  latitude: number;
  longitude: number;
  candidateVendor: number;
};

const MATCHERS: { key: keyof ColMap; re: RegExp }[] = [
  { key: "province", re: /PROVINSI|PROPINSI/i },
  { key: "regency", re: /KABUPATEN|KOTA/i },
  { key: "district", re: /KECAMATAN/i },
  { key: "village", re: /DESA|KELURAHAN/i },
  { key: "latitude", re: /LATITUDE|LINTANG|\bLAT\b/i },
  { key: "longitude", re: /LONGITUDE|BUJUR|\bLNG\b|\bLONG?\b/i },
  { key: "candidateVendor", re: /PENYEDIA|VENDOR|PERUSAHAAN|KONTRAKTOR|PELAKSANA/i },
];

/** Cari baris header di ≤6 baris pertama (yang memuat ≥3 kolom dikenali). */
function detectHeader(ws: ExcelJS.Worksheet): { headerRow: number; cols: ColMap } | null {
  const maxScan = Math.min(ws.rowCount, 6);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const cols: ColMap = {
      province: -1, regency: -1, district: -1, village: -1,
      latitude: -1, longitude: -1, candidateVendor: -1,
    };
    for (let c = 1; c <= ws.columnCount; c++) {
      const text = cellStr(row.getCell(c).value).trim();
      if (!text) continue;
      for (const m of MATCHERS) {
        if (cols[m.key] === -1 && m.re.test(text)) cols[m.key] = c;
      }
    }
    const known = [cols.province, cols.regency, cols.village].filter((x) => x > 0).length;
    if (known >= 3) return { headerRow: r, cols };
  }
  return null;
}

export async function parseMasterLocationXlsx(buffer: Buffer): Promise<MasterImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], warnings: ["File tidak memiliki sheet."] };

  const detected = detectHeader(ws);
  if (!detected) {
    return {
      rows: [],
      warnings: [
        "Baris header tidak dikenali. Pastikan ada kolom PROVINSI, KABUPATEN/KOTA, DESA/KELURAHAN.",
      ],
    };
  }
  const { headerRow, cols } = detected;
  const warnings: string[] = [];
  if (cols.district === -1) warnings.push("Kolom KECAMATAN tidak ditemukan — dikosongkan.");
  if (cols.latitude === -1 || cols.longitude === -1) warnings.push("Kolom koordinat tidak lengkap — sebagian lat/lng kosong.");
  if (cols.candidateVendor === -1) warnings.push("Kolom CALON PENYEDIA tidak ditemukan — vendor tidak diimpor.");

  const rows: ParsedMasterRow[] = [];
  let skipped = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c: number) => (c > 0 ? cellStr(row.getCell(c).value).trim() : "");
    const province = get(cols.province);
    const regency = get(cols.regency);
    const village = get(cols.village);
    if (!province && !regency && !village) continue; // baris kosong
    if (!province || !regency || !village) {
      skipped++;
      continue; // baris tak lengkap → lewati
    }
    rows.push({
      province,
      regency,
      district: cols.district > 0 ? get(cols.district) || null : null,
      village,
      latitude: cols.latitude > 0 ? cellNum(row.getCell(cols.latitude).value) : null,
      longitude: cols.longitude > 0 ? cellNum(row.getCell(cols.longitude).value) : null,
      candidateVendor: cols.candidateVendor > 0 ? get(cols.candidateVendor) || null : null,
    });
  }
  if (skipped > 0) warnings.push(`${skipped} baris dilewati (provinsi/kabupaten/desa tidak lengkap).`);
  if (rows.length === 0) warnings.push("Tidak ada baris data valid.");
  return { rows, warnings };
}
