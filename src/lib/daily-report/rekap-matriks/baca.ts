import "server-only";
import ExcelJS from "exceljs";
import { kolomTersembunyi } from "@/lib/rab/hps-parser";
import { namaSheetXlsx, slimRabWorkbook, tanpaAwalanNamespace } from "@/lib/rab/xlsx-slim";
import type { BarisRekap, RekapMatriks } from "./jenis";

/**
 * PEMBACA SHEET "REKAP HARIAN" (DECISIONS 782).
 *
 * Permintaan user 2026-11-25 (berkas DESA IYOK, JIKO, BUYAT 1): *"pada sheet
 * REKAP HARIAN, aku ingin kamu bisa membaca dan dari format ini import ke
 * marlin, untuk rekap pekerjaannya. itu ada kolom pekerjaan dan kolom tanggal
 * kapan pekerjaan dilakukan dengan volumenya, bisa jadi kolomnya lompat"*.
 *
 * Bentuknya MATRIKS: satu baris per pekerjaan (urutan sama dengan RAB/MC-0),
 * satu kolom per tanggal. Judul tanggalnya lengkap per hari, tetapi kolom
 * hari-hari di antaranya DISEMBUNYIKAN – yang terlihat hanya tanggal-tanggal
 * yang dipakai (di berkas contoh tiap 7 hari). Itu "kolom lompat"-nya.
 *
 * Aturan baca:
 * - Hanya sheet, kolom, dan baris yang TERLIHAT (DECISIONS 604). Angka di
 *   kolom/baris tersembunyi tidak dibaca, tetapi DISEBUT di pratinjau.
 * - Tanggal diambil dari sel judul kolomnya, bukan dari letak kolom.
 * - Nama pekerjaan = teks paling kanan di antara kolom NO dan kolom Sat
 *   (berkas contoh mengisi nama di dua kolom; kolom NO berisi kode atau nama).
 * - Angka 0, kosong, dan teks di sel tanggal bukan volume.
 */

export class RekapMatriksError extends Error {}

const POLA_SHEET = /rekap\s*harian/i;

type Nilai = ExcelJS.CellValue;

/** Isi sel sesudah rumus (exceljs menyimpan hasil rumus di `result`). */
function isi(v: Nilai): unknown {
  if (v == null) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
    if ("error" in o && o.error) return null;
    if ("result" in o) return o.result ?? null;
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if ("formula" in o || "sharedFormula" in o) return null;
  }
  return v;
}

function teks(v: Nilai): string {
  const x = isi(v);
  if (x == null) return "";
  if (x instanceof Date) return "";
  return String(x).replace(/\s+/g, " ").trim();
}

function angka(v: Nilai): number | null {
  const x = isi(v);
  if (typeof x === "number" && Number.isFinite(x)) return x;
  return null;
}

/** Tanggal judul kolom → "YYYY-MM-DD". Tanggal Excel tidak berzona: bagian tanggal UTC-nya. */
function tanggal(v: Nilai): string | null {
  const x = isi(v);
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x.toISOString().slice(0, 10);
  return null;
}

const bulat3 = (v: number) => Math.round(v * 1000) / 1000;

function hurufKolom(n: number): string {
  let s = "";
  for (let c = n; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

/** Baca berkas → isi sheet REKAP HARIAN. Hanya sheet itu yang dimuat. */
export async function bacaRekapMatriks(asli: Buffer | ArrayBuffer): Promise<RekapMatriks> {
  const buf = await tanpaAwalanNamespace(asli);
  const daftar = await namaSheetXlsx(buf);
  const cocok = daftar.filter((s) => POLA_SHEET.test(s.nama));
  const terlihat = cocok.find((s) => !s.tersembunyi);
  if (!terlihat) {
    if (cocok.length > 0) {
      throw new RekapMatriksError(
        `Sheet "${cocok[0]!.nama}" disembunyikan, dan sheet yang disembunyikan tidak dibaca. Tampilkan (Unhide) sheet itu di Excel, simpan, lalu unggah lagi.`,
      );
    }
    const nama = daftar.filter((s) => !s.tersembunyi).slice(0, 8).map((s) => `"${s.nama}"`).join(", ");
    throw new RekapMatriksError(`Berkas ini tidak punya sheet "REKAP HARIAN". Sheet yang ada: ${nama || "–"}.`);
  }
  const slim = await slimRabWorkbook(buf, terlihat.nama);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(slim as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new RekapMatriksError(`Sheet "${terlihat.nama}" tidak terbaca.`);
  return bacaSheet(ws);
}

/** Bagian yang bisa diuji tanpa berkas zip: satu worksheet exceljs. */
export function bacaSheet(ws: ExcelJS.Worksheet): RekapMatriks {
  const lebar = Math.max(ws.columnCount, ws.actualColumnCount ?? 0);
  const sembunyi = kolomTersembunyi(ws, lebar);
  const barisSembunyi = (r: number) => {
    const row = ws.getRow(r);
    return row.hidden === true || row.height === 0;
  };

  // 1. Baris judul: memuat "Uraian" dan "Sat".
  let judul = -1;
  let kolNo = -1;
  let kolUraian = -1;
  let kolSat = -1;
  let kolVol = -1;
  for (let r = 1; r <= Math.min(ws.rowCount, 80) && judul < 0; r++) {
    const row = ws.getRow(r);
    let u = -1;
    let s = -1;
    let n = -1;
    let v = -1;
    for (let c = 1; c <= Math.min(lebar, 40); c++) {
      const t = teks(row.getCell(c).value);
      if (!t) continue;
      if (u < 0 && /uraian/i.test(t)) u = c;
      else if (s < 0 && /^sat(uan)?\.?$/i.test(t)) s = c;
      else if (n < 0 && /^no\.?$/i.test(t)) n = c;
      else if (v < 0 && /volume\s*kontrak/i.test(t)) v = c;
    }
    if (u > 0 && s > u) {
      judul = r;
      kolUraian = u;
      kolSat = s;
      kolNo = n > 0 && n < u ? n : u;
      kolVol = v;
    }
  }
  if (judul < 0) {
    throw new RekapMatriksError(
      `Baris judul kolom tidak ditemukan di sheet "${ws.name}". Yang dicari: kolom "Uraian Pekerjaan" dan "Sat" di baris yang sama.`,
    );
  }

  // 2. Baris tanggal: di baris judul atau beberapa baris di bawahnya, yang paling banyak berisi tanggal.
  let barisTanggal = -1;
  let terbanyak = 0;
  for (let r = judul; r <= Math.min(ws.rowCount, judul + 6); r++) {
    const row = ws.getRow(r);
    let n = 0;
    for (let c = kolSat + 1; c <= lebar; c++) if (tanggal(row.getCell(c).value)) n++;
    if (n > terbanyak) {
      terbanyak = n;
      barisTanggal = r;
    }
  }
  if (barisTanggal < 0) {
    throw new RekapMatriksError(
      `Kolom tanggal tidak ditemukan di sheet "${ws.name}": di baris ${judul} sampai ${judul + 6} tidak ada sel berisi tanggal di kanan kolom Sat.`,
    );
  }
  const semuaKolomTanggal: { kolom: number; huruf: string; tanggal: string; terlihat: boolean }[] = [];
  {
    const row = ws.getRow(barisTanggal);
    for (let c = kolSat + 1; c <= lebar; c++) {
      const t = tanggal(row.getCell(c).value);
      if (t) semuaKolomTanggal.push({ kolom: c, huruf: hurufKolom(c), tanggal: t, terlihat: !sembunyi.has(c) });
    }
  }
  const kolomTanggal = semuaKolomTanggal.filter((k) => k.terlihat);
  if (kolomTanggal.length === 0) {
    throw new RekapMatriksError(`Semua kolom tanggal di sheet "${ws.name}" disembunyikan, jadi tidak ada yang dibaca.`);
  }
  const kembar = kolomTanggal.filter((k, i) => kolomTanggal.findIndex((x) => x.tanggal === k.tanggal) !== i);
  if (kembar.length > 0) {
    throw new RekapMatriksError(
      `Tanggal ${kembar[0]!.tanggal} muncul di dua kolom terlihat (${kolomTanggal
        .filter((k) => k.tanggal === kembar[0]!.tanggal)
        .map((k) => k.huruf)
        .join(" dan ")}). Satu tanggal hanya boleh satu kolom.`,
    );
  }

  // 3. Baris pekerjaan, sesudah BLOK judul. Judulnya bertingkat (Tanggal /
  //    Bulan / Minggu / Hari) dan sel judulnya digabung ke bawah, jadi baris
  //    "Minggu" berisi angka 1, 2, 3 di kolom tanggal – itu bukan volume.
  const barisKepala = (r: number) => {
    const row = ws.getRow(r);
    if (/^uraian/i.test(teks(row.getCell(kolUraian).value))) return true;
    if (/^no\.?$/i.test(teks(row.getCell(kolNo).value))) return true;
    return semuaKolomTanggal.some((k) => tanggal(row.getCell(k.kolom).value) != null);
  };
  let awalData = judul + 1;
  while (awalData <= judul + 8 && barisKepala(awalData)) awalData++;
  const baris: BarisRekap[] = [];
  const tersembunyiKolom = new Map<string, number>();
  const tersembunyiBaris: number[] = [];
  const teksDiSelTanggal: { excelRow: number; kolom: string; isi: string }[] = [];
  for (let r = awalData; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // Nama: teks paling kanan di antara kolom NO dan kolom Sat (yang terlihat).
    let nama = "";
    for (let c = kolSat - 1; c >= kolNo; c--) {
      if (sembunyi.has(c)) continue;
      const t = teks(row.getCell(c).value);
      if (t && t !== "0" && !/^-?\d+([.,]\d+)?$/.test(t)) {
        nama = t;
        break;
      }
    }
    const sel: { tanggal: string; volume: number; kolom: string }[] = [];
    for (const k of semuaKolomTanggal) {
      const cell = row.getCell(k.kolom).value;
      const v = angka(cell);
      if (v == null) {
        const t = teks(cell);
        if (t && k.terlihat && !barisSembunyi(r)) teksDiSelTanggal.push({ excelRow: r, kolom: k.huruf, isi: t.slice(0, 30) });
        continue;
      }
      if (Math.abs(v) < 0.0005) continue;
      if (!k.terlihat) {
        tersembunyiKolom.set(k.tanggal, (tersembunyiKolom.get(k.tanggal) ?? 0) + 1);
        continue;
      }
      sel.push({ tanggal: k.tanggal, volume: bulat3(v), kolom: k.huruf });
    }
    if (barisSembunyi(r)) {
      if (sel.length > 0) tersembunyiBaris.push(r);
      continue;
    }
    if (!nama) continue;
    const kodeMentah = teks(row.getCell(kolNo).value);
    const kode = kodeMentah && kodeMentah !== nama && kodeMentah.length <= 8 ? kodeMentah : "";
    const satMentah = teks(row.getCell(kolSat).value);
    const satuan = satMentah && satMentah !== "0" ? satMentah : null;
    const volumeKontrak = kolVol > 0 ? angka(row.getCell(kolVol).value) : null;
    baris.push({
      excelRow: r,
      kode,
      nama,
      satuan,
      volumeKontrak: volumeKontrak == null ? null : bulat3(volumeKontrak),
      judul: satuan == null,
      sel,
    });
  }

  const berisi = baris.flatMap((b) => b.sel.map((s) => s.tanggal)).sort();
  return {
    sheet: ws.name,
    barisJudul: judul,
    kolomTanggal: kolomTanggal.map(({ kolom, huruf, tanggal: t }) => ({ kolom, huruf, tanggal: t })),
    awalPeriode: kolomTanggal[0]!.tanggal,
    akhirPeriode: berisi.at(-1) ?? null,
    baris,
    tersembunyi: [...tersembunyiKolom].map(([t, sel]) => ({ tanggal: t, sel })).sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    barisTersembunyi: tersembunyiBaris,
    teksDiSelTanggal: teksDiSelTanggal.slice(0, 20),
  };
}
