import "server-only";
import ExcelJS from "exceljs";

/**
 * Parser Time Schedule (Kurva-S) Excel yang diekspor lalu DIEDIT sipil, untuk
 * di-round-trip balik jadi jadwal (matriks mingguan per kategori). Membaca baris
 * kategori (No · Uraian · Bobot · M1..MN) dan mengambil increment mingguan per
 * kategori — termasuk minggu bernilai 0 (jeda). Toleran terhadap sel rumus
 * (memakai hasil cache `.result`). DECISIONS 103.
 */

export type ParsedJadwalCategory = { code: string; name: string; weekly: number[] };
export type ParsedJadwal = { totalWeeks: number; categories: ParsedJadwalCategory[] };

function toNum(v: ExcelJS.CellValue): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") {
    // Sel rumus exceljs: { formula, result } — pakai hasil cache.
    const r = (v as { result?: unknown }).result;
    if (typeof r === "number") return r;
    if (r != null && Number.isFinite(Number(r))) return Number(r);
    return 0;
  }
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const r = (v as { result?: unknown; richText?: { text: string }[] }).result;
    if (typeof r === "string") return r.trim();
    const rich = (v as { richText?: { text: string }[] }).richText;
    if (Array.isArray(rich)) return rich.map((t) => t.text).join("").trim();
  }
  return String(v).trim();
}

const SUMMARY_RE = /prestasi|kumulatif|deviasi/i;

/** Pilih sheet jadwal (mengandung "time schedule"/"kurva"/"jadwal"), else pertama. */
function pickSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  const named = wb.worksheets.find((ws) => /time schedule|kurva|jadwal/i.test(ws.name));
  return named ?? wb.worksheets[0] ?? null;
}

export async function parseJadwalWorkbook(buf: Buffer): Promise<ParsedJadwal> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = pickSheet(wb);
  if (!ws) throw new Error("File Excel tidak berisi sheet apa pun.");

  // 1) Temukan baris header minggu: sel berturut "M1","M2",… Tentukan kolom awal & N.
  let weekRow = -1;
  let weekCol0 = -1;
  let totalWeeks = 0;
  const maxScan = Math.min(ws.rowCount, 60);
  for (let r = 1; r <= maxScan && weekRow < 0; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) {
      if (cellText(row.getCell(c).value).toUpperCase() === "M1") {
        // Hitung berapa banyak M{k} berurutan.
        let n = 0;
        while (cellText(row.getCell(c + n).value).toUpperCase() === `M${n + 1}`) n++;
        if (n >= 1) {
          weekRow = r;
          weekCol0 = c;
          totalWeeks = n;
          break;
        }
      }
    }
  }
  if (weekRow < 0) {
    throw new Error("Header minggu (M1, M2, …) tidak ditemukan — pastikan file dari Unduh Excel Jadwal.");
  }

  // 2) Baris kategori setelah header minggu: kolom B = nama, kolom A = kode,
  //    kolom minggu = weekCol0.. Berhenti saat baris ringkasan (Prestasi/Kumulatif/Deviasi).
  const categories: ParsedJadwalCategory[] = [];
  for (let r = weekRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codeText = cellText(row.getCell(1).value);
    const nameText = cellText(row.getCell(2).value);
    if (SUMMARY_RE.test(codeText) || SUMMARY_RE.test(nameText)) break;
    if (!nameText) continue; // baris kosong / helper tersembunyi
    const weekly: number[] = [];
    for (let i = 0; i < totalWeeks; i++) {
      const v = toNum(row.getCell(weekCol0 + i).value);
      weekly.push(v > 0 ? v : 0);
    }
    categories.push({ code: codeText, name: nameText, weekly });
  }

  if (categories.length === 0) {
    throw new Error("Tidak ada baris pekerjaan yang terbaca di bawah header minggu.");
  }
  return { totalWeeks, categories };
}
