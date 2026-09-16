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
      // Sel minggu bisa memuat rentang tanggal di baris kedua ("M1\n5/6–11/6",
      // user 2026-08-24) — yang dicocokkan hanya token pertamanya.
      const tokenM = (v: unknown) => cellText(v as never).toUpperCase().split(/\s/)[0] ?? "";
      if (tokenM(row.getCell(c).value) === "M1") {
        // Hitung berapa banyak M{k} berurutan.
        let n = 0;
        while (tokenM(row.getCell(c + n).value) === `M${n + 1}`) n++;
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
    throw new Error("Header minggu (M1, M2, …) tidak ditemukan – pastikan file dari Unduh Excel Jadwal.");
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
    // Nilai dikembalikan APA ADANYA — termasuk negatif. Dulu negatif diam-diam
    // jadi 0; sekarang penyimpanlah yang menolaknya dengan menyebut baris &
    // minggunya, karena mengubah angka user tanpa memberi tahu adalah persoalan
    // yang sedang diperbaiki (DECISIONS 203).
    const weekly: number[] = [];
    for (let i = 0; i < totalWeeks; i++) {
      weekly.push(toNum(row.getCell(weekCol0 + i).value));
    }
    categories.push({ code: codeText, name: nameText, weekly });
  }

  if (categories.length === 0) {
    throw new Error("Tidak ada baris pekerjaan yang terbaca di bawah header minggu.");
  }
  return { totalWeeks, categories };
}

/* ------------------------------------------------------------------ */
/* Pencocokan baris Excel → kategori RAB                                */
/* ------------------------------------------------------------------ */

const normKat = (s: string): string => s.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();

export type KategoriPencocokan = { code: string | null; name: string; lineageKey: string };

/**
 * Jodohkan baris jadwal Excel dengan kategori RAB aktif.
 *
 * KODE KATEGORI TIDAK UNIK. File HPS nyata memakai nomor romawi yang berulang
 * (di data KNMP: IX, X, dan XIV masing-masing muncul dua kali), dan importir RAB
 * memang membedakannya lewat `lineageKey` ber-suffix `#N`, bukan lewat kode.
 *
 * Versi lama membangun `norm(code) → lineageKey` tanpa memeriksa keunikan, jadi
 * kode kembar ditimpa yang terakhir: baris Excel "IX" mendarat di `IX#2`, dan
 * baris "IX" berikutnya dibuang karena kuncinya sudah terpakai. Tiga kategori
 * kehilangan jadwalnya sekaligus — 27,38% bobot — sehingga template hasil ekspor
 * MARLIN sendiri ditolak saat diimpor balik ("Total bobot di Excel 72,62%").
 * E2E `perbarui-kurva-s` merah di CI 2026-09-16.
 *
 * Aturannya sekarang: kode dipakai HANYA bila ia menunjuk satu kategori. Kode
 * kembar tidak dipakai sama sekali — nama yang memutuskan, dan nama kategori
 * dalam satu RAB memang berbeda. Menebak lewat urutan baris akan "benar" pada
 * berkas terbitan MARLIN dan salah diam-diam pada berkas susunan orang.
 */
export function cocokkanKategoriJadwal(
  baris: readonly { code: string; name: string; weekly: number[] }[],
  kategori: readonly KategoriPencocokan[],
): { lineageKey: string; weekly: number[] }[] {
  const jumlahKode = new Map<string, number>();
  for (const c of kategori) {
    if (!c.code) continue;
    const k = normKat(c.code);
    jumlahKode.set(k, (jumlahKode.get(k) ?? 0) + 1);
  }
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of kategori) {
    if (c.code && jumlahKode.get(normKat(c.code)) === 1) byCode.set(normKat(c.code), c.lineageKey);
    byName.set(normKat(c.name), c.lineageKey);
  }

  const hasil: { lineageKey: string; weekly: number[] }[] = [];
  const terpakai = new Set<string>();
  for (const b of baris) {
    // Nama lebih dulu bila kodenya kembar; kode lebih dulu bila ia unik, karena
    // nama di Excel bisa disunting orang sementara kodenya jarang disentuh.
    const key = (b.code ? byCode.get(normKat(b.code)) : undefined) ?? byName.get(normKat(b.name));
    if (!key || terpakai.has(key)) continue;
    terpakai.add(key);
    hasil.push({ lineageKey: key, weekly: b.weekly });
  }
  return hasil;
}
