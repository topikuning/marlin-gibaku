import type ExcelJS from "exceljs";

/**
 * BERKAS TAMBAH/KURANG KKP — dibaca APA ADANYA, bukan dipaksa ke bentuk MARLIN.
 *
 * Permintaan user 2026-08-07: *"itu adalah format dari kkp, bisa jadi tim
 * terlanjur mengerjakan di file seperti itu, lalu baru masuk ke sistem, jadi
 * kamu harus lebih luwes."* Betul: tim lapangan mengerjakan adendum di berkas
 * KKP, dan menolaknya sampai mereka menyalin ulang ke template MARLIN adalah
 * memindahkan pekerjaan tanpa menambah kebenaran — malah menambah peluang
 * salah salin.
 *
 * ### Bentuknya sama, NAMANYA yang menipu
 *
 * Dua berkas nyata dari paket yang sama:
 *
 * | | blok 1 | blok 2 | blok 3 | blok 4 |
 * |---|---|---|---|---|
 * | `MC_0_*.xlsx` | **RAB** | PEKERJAAN TAMBAH | PEKERJAAN KURANG | **MC 0** |
 * | `CCO01_*.xlsx` | **MC - 0** | PEKERJAAN TAMBAH | PEKERJAAN KURANG | **CCO - 01** |
 *
 * Perhatikan "MC-0": di berkas pertama ia HASIL, di berkas kedua ia KEADAAN
 * AWAL. Label yang sama, arti berlawanan. Karena itu modul ini TIDAK PERNAH
 * menyimpulkan peran blok dari namanya.
 *
 * ### Yang dipakai: posisi + aritmetika
 *
 * 1. Baris grup dikenali dari adanya blok TAMBAH **dan** KURANG.
 * 2. Blok DASAR = blok terakhir sebelum "tambah"; blok HASIL = blok terakhir
 *    sesudah "kurang". Urutan kolom inilah yang stabil di semua varian, bukan
 *    penamaannya.
 * 3. Kolom di dalam blok ditentukan dengan MEMBUKTIKAN `volume × harga ≈
 *    jumlah` pada baris-baris contoh. Header tidak dipercaya — pada berkas
 *    `MC_0_*` sel header ter-merge membuat labelnya bergeser satu kolom
 *    terhadap datanya, dan deteksi berbasis label memang salah membaca SATUAN
 *    sebagai harga. Angka tidak bisa bergeser diam-diam; label bisa.
 *
 * Modul MURNI: tanpa DB, tanpa I/O. Yang menentukan benar-salah di sini adalah
 * angkanya.
 */

/** Sekelompok kolom di bawah satu label grup (mis. "PEKERJAAN TAMBAH"). */
export type BlokNilai = { label: string; mulai: number; akhir: number };

export type PetaCco = {
  /** Baris berisi label grup — header rincian ada di bawahnya. */
  barisGrup: number;
  blokDasar: BlokNilai;
  blokHasil: BlokNilai;
  /**
   * Blok adendum masih KOSONG, jadi blok DASAR sendiri yang dipakai sebagai
   * hasil. Terjadi pada berkas DRAFT (mis. MC-0 yang kolom CCO-01-nya belum
   * diisi). Dipakai halaman impor untuk mengatakannya apa adanya.
   */
  hasilDariDasar: boolean;
  /** Peta kolom siap pakai untuk walker RAB: volume dari blok HASIL. */
  col: { vol: number; unit: number; price: number; amount: number; tkdn: number };
  /** Kolom volume blok DASAR — dipakai melaporkan berapa item yang berubah. */
  volDasar: number;
};

const NC = 30; // kolom A..AD — cukup untuk semua varian CCO KKP yang ditemui

function teks(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("result" in v) return teks((v as { result: ExcelJS.CellValue }).result);
    if ("text" in v) return String((v as { text: string }).text);
    return "";
  }
  return String(v).trim();
}

function angka(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && "result" in v) {
    const r = (v as { result: ExcelJS.CellValue }).result;
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  }
  return null;
}

const punyaTambah = (s: string) => /PEKERJAAN\s*TAMBAH|TAMBAH/i.test(s);
const punyaKurang = (s: string) => /PEKERJAAN\s*KURANG|KURANG/i.test(s);

/** Blok label kontinu di baris grup (sel ter-merge terbaca berulang — itu dipakai). */
function blokDi(ws: ExcelJS.Worksheet, baris: number): BlokNilai[] {
  const blok: BlokNilai[] = [];
  let kini: BlokNilai | null = null;
  for (let c = 1; c <= NC; c++) {
    const label = teks(ws.getRow(baris).getCell(c).value).replace(/\s+/g, " ").trim();
    if (!label) {
      kini = null;
      continue;
    }
    if (kini && kini.label === label) kini.akhir = c;
    else {
      kini = { label, mulai: c, akhir: c };
      blok.push(kini);
    }
  }
  return blok;
}

/** Baris-baris contoh: ada uraian (kolom teks kiri) dan sedikitnya satu angka. */
function barisContoh(ws: ExcelJS.Worksheet, mulai: number, blok: BlokNilai): number[] {
  const out: number[] = [];
  for (let r = mulai; r <= ws.rowCount && out.length < 60; r++) {
    const row = ws.getRow(r);
    let adaAngka = false;
    for (let c = blok.mulai; c <= blok.akhir; c++) if (angka(row.getCell(c).value) != null) adaAngka = true;
    if (adaAngka) out.push(r);
  }
  return out;
}

/** Cocok bila selisihnya ≤1% (pembulatan harga satuan di Excel itu lazim). */
const cocok = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);

/**
 * Cari (volume, harga, jumlah) di dalam satu blok dengan MEMBUKTIKAN
 * `volume × harga ≈ jumlah`. Semua kombinasi kolom dicoba; yang menang adalah
 * yang paling sering terbukti — bukan yang namanya paling mirip.
 */
function triplet(
  ws: ExcelJS.Worksheet,
  blok: BlokNilai,
  baris: number[],
): { vol: number; price: number; amount: number; skor: number } | null {
  let terbaik: { vol: number; price: number; amount: number; skor: number } | null = null;
  for (let v = blok.mulai; v <= blok.akhir; v++)
    for (let p = blok.mulai; p <= blok.akhir; p++) {
      if (p === v) continue;
      for (let a = blok.mulai; a <= blok.akhir; a++) {
        if (a === v || a === p) continue;
        let skor = 0;
        for (const r of baris) {
          const row = ws.getRow(r);
          const nv = angka(row.getCell(v).value);
          const np = angka(row.getCell(p).value);
          const na = angka(row.getCell(a).value);
          if (nv == null || np == null || na == null) continue;
          // Baris nol tidak membuktikan apa pun (0×apa saja = 0) — dilewati
          // supaya kolom BOBOT yang kebetulan nol tidak ikut menang.
          if (nv === 0 || np === 0 || na === 0) continue;
          if (cocok(nv * np, na)) skor++;
        }
        if (skor > 0 && (!terbaik || skor > terbaik.skor)) terbaik = { vol: v, price: p, amount: a, skor };
      }
    }
  return terbaik;
}

/** Kolom SATUAN = kolom yang isinya teks pendek bukan-angka paling sering. */
function kolomSatuan(ws: ExcelJS.Worksheet, blok: BlokNilai, baris: number[]): number | null {
  let terbaik: { c: number; skor: number } | null = null;
  for (let c = blok.mulai; c <= blok.akhir; c++) {
    let skor = 0;
    for (const r of baris) {
      const sel = ws.getRow(r).getCell(c).value;
      if (angka(sel) != null) continue;
      const t = teks(sel);
      if (t && t.length <= 6) skor++;
    }
    if (skor > 0 && (!terbaik || skor > terbaik.skor)) terbaik = { c, skor };
  }
  return terbaik?.c ?? null;
}

/**
 * Kenali sheet berformat tambah/kurang. `null` = bukan (biar jalur RAB biasa
 * yang menanganinya) — modul ini tidak boleh menebak-nebak berkas orang lain.
 */
export function deteksiCco(ws: ExcelJS.Worksheet): PetaCco | null {
  let barisGrup = -1;
  let blok: BlokNilai[] = [];
  for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
    const b = blokDi(ws, r);
    if (b.some((x) => punyaTambah(x.label)) && b.some((x) => punyaKurang(x.label))) {
      barisGrup = r;
      blok = b;
      break;
    }
  }
  if (barisGrup < 0) return null;

  const iTambah = blok.findIndex((b) => punyaTambah(b.label));
  const iKurang = blok.findIndex((b) => punyaKurang(b.label));
  if (iTambah < 1 || iKurang <= iTambah) return null;

  const blokDasar = blok[iTambah - 1];
  // Kandidat blok HASIL = semua blok sesudah "kurang", tanpa kolom keterangan.
  const sesudah = blok.slice(iKurang + 1).filter((b) => !/^KET|KETERANGAN/i.test(b.label));
  if (sesudah.length === 0) return null;

  // Data mulai beberapa baris di bawah grup (ada 1–3 baris sub-header).
  const contoh = barisContoh(ws, barisGrup + 1, blokDasar);
  if (contoh.length < 3) return null;

  const dasar = triplet(ws, blokDasar, contoh);
  if (!dasar || dasar.skor < 3) return null; // tidak terbukti → jangan diterka
  const unit = kolomSatuan(ws, blokDasar, contoh);
  if (unit == null) return null;

  /**
   * Volume HASIL: kolom yang, dikalikan harga satuan dasar, menghasilkan salah
   * satu kolom di blok hasil.
   */
  const buktikan = (b: BlokNilai): { vol: number; amount: number; skor: number } | null => {
    let terbaik: { vol: number; amount: number; skor: number } | null = null;
    for (let v = b.mulai; v <= b.akhir; v++)
      for (let a = b.mulai; a <= b.akhir; a++) {
        if (a === v) continue;
        let skor = 0;
        for (const r of contoh) {
          const row = ws.getRow(r);
          const nv = angka(row.getCell(v).value);
          const na = angka(row.getCell(a).value);
          const np = angka(row.getCell(dasar.price).value);
          if (nv == null || na == null || np == null || nv === 0 || na === 0 || np === 0) continue;
          if (cocok(nv * np, na)) skor++;
        }
        if (skor >= 3 && (!terbaik || skor > terbaik.skor)) terbaik = { vol: v, amount: a, skor };
      }
    return terbaik;
  };

  /**
   * Blok HASIL = blok TERBUKTI paling kanan sesudah "kurang" — bukan sekadar
   * yang paling kanan.
   *
   * Berkas nyata `DRAFT_MC0_..._KEMANTREN` punya lima blok: RAB KONTRAK · MC-0 ·
   * TAMBAH · KURANG · CCO-01, dan CCO-01-nya MASIH KOSONG karena adendumnya
   * memang belum dikerjakan. Aturan "ambil yang paling kanan" memilih blok
   * kosong itu, gagal membuktikan `volume × harga ≈ jumlah`, lalu seluruh
   * berkas ditolak — padahal blok yang berlaku (MC-0) ada dan angkanya lengkap.
   */
  let blokHasil: BlokNilai | null = null;
  let volHasil = 0;
  let amountHasil = 0;
  for (let i = sesudah.length - 1; i >= 0; i--) {
    const hit = buktikan(sesudah[i]);
    if (!hit) continue;
    blokHasil = sesudah[i];
    volHasil = hit.vol;
    amountHasil = hit.amount;
    break;
  }

  let hasilDariDasar = false;
  if (!blokHasil) {
    // Ada isinya tapi tidak satu pun terbukti → jangan diterka; biarkan pesan
    // "kolom volume/harga/jumlah tidak bisa dipastikan" yang bicara.
    const adaIsi = sesudah.some((b) =>
      contoh.some((r) => {
        for (let c = b.mulai; c <= b.akhir; c++)
          if (angka(ws.getRow(r).getCell(c).value) != null) return true;
        return false;
      }),
    );
    if (adaIsi) return null;
    // Semua blok adendum kosong = berkas DRAFT. Yang benar bukan menolaknya,
    // melainkan membacanya sebagai keadaan DASAR apa adanya (nol perubahan).
    blokHasil = blokDasar;
    volHasil = dasar.vol;
    amountHasil = dasar.amount;
    hasilDariDasar = true;
  }

  return {
    barisGrup,
    blokDasar,
    blokHasil,
    hasilDariDasar,
    volDasar: dasar.vol,
    col: {
      // Volume ADENDUM (keadaan sesudah) — inti dari impor ini.
      vol: volHasil,
      // Satuan & harga satuan tidak berubah karena adendum; diambil dari dasar.
      unit,
      price: dasar.price,
      amount: amountHasil,
      // Berkas CCO tidak membawa TKDN. Kolom jauh = selalu kosong.
      tkdn: 999,
    },
  };
}

/** Berapa item yang volumenya BERBEDA antara blok dasar dan blok hasil. */
export function hitungPerubahan(
  ws: ExcelJS.Worksheet,
  peta: PetaCco,
): { berubah: number; total: number } {
  let berubah = 0;
  let total = 0;
  for (let r = peta.barisGrup + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const harga = angka(row.getCell(peta.col.price).value);
    if (harga == null || harga === 0) continue;
    const a = angka(row.getCell(peta.volDasar).value) ?? 0;
    const b = angka(row.getCell(peta.col.vol).value) ?? 0;
    if (a === 0 && b === 0) continue;
    total++;
    if (Math.abs(a - b) > 1e-9) berubah++;
  }
  return { berubah, total };
}
