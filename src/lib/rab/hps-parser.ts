import ExcelJS from "exceljs";
import { bacaAngkaLokal } from "@/lib/rab/angka-lokal";
import { namaSheetXlsx, slimRabWorkbook } from "@/lib/rab/xlsx-slim";
import { deteksiCco, hitungPerubahan } from "@/lib/rab/cco-import";
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
/**
 * Kode LENGKAP berjenjang: "6.1.a", "6.7.1", "6.1.1.b" (DECISIONS 208).
 *
 * File HPS asli menulis anak terdalam dengan kode PENDEK ("a", "b") atau kosong;
 * parser inilah yang menyusun kode lengkapnya (`${induk}.${huruf}`) sebelum
 * disimpan ke DB. Ekspor RAB menulis kembali kode lengkap itu — dan dulu parser
 * tidak mengenalinya, sehingga barisnya jatuh ke "other" lalu HILANG beserta
 * volume dan harga satuannya saat berkas ekspor diimpor ulang.
 */
const DEEPCODE = /^\d+(?:\.\d+)*\.(?:[a-z]|\d+)$/i;

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
/**
 * Pembaca angka BERSAMA (`lib/rab/angka-lokal`). Sebelumnya lokal di sini dan
 * membuang semua koma lalu memperlakukan titik sebagai desimal, sementara
 * `adendum-template-parse` melakukan KEBALIKANNYA pada sel yang sama. Sel teks
 * `"1.500.000,50"` karena itu menjadi `null` di sini (baris hilang diam-diam)
 * dan `"1,5"` menjadi 15 (sepuluh kali lipat). Audit 2026-09-01.
 */
const num = bacaAngkaLokal;
/**
 * Kode romawi kategori — titik di ujung DIABAIKAN.
 *
 * File KKP menulis kategori dua gaya dalam satu berkas yang sama: "IV" dan
 * "IV.". Dulu yang bertitik tidak dikenali, jadi barisnya (berikut JUDULNYA)
 * dibuang, lalu sub-kode "IV.1" di bawahnya memicu kategori sisipan berlabel
 * "judul tidak ada di file" — padahal judulnya ADA, cuma satu titik di
 * belakang kodenya. Di Batu Putih itu terjadi pada PEKERJAAN PONDASI PABRIK ES
 * PORTABLE dan PEKERJAAN PENERANGAN KAWASAN. DECISIONS 252.
 */
export function isRoman(s: string): boolean {
  const t = s.replace(/\.$/, "");
  return t.length > 0 && ROMAN.test(t);
}
/** Kode kategori tanpa titik ujung — dipakai sebagai identitas kategori. */
export function romanCode(s: string): string {
  return s.replace(/\.$/, "");
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

/** Kata pembuka baris rekap. Sengaja TANPA `\b` di ujung — lihat isSummaryRow. */
const SUMMARY_PREFIX = /^(jumlah|sub\s*total|subtotal|total|grand\s*total|rekapitulasi)/i;

/**
 * Baris rekap ("JUMLAH", "SUB TOTAL", …) — tidak masuk pohon.
 *
 * DUA hal yang salah sebelum DECISIONS 252, keduanya membuat subtotal
 * TERHITUNG SEBAGAI PEKERJAAN sehingga kategorinya menggelembung:
 *
 * 1. Pola lama diakhiri `\b`. Batas-kata baru terpenuhi kalau sesudah kata
 *    kuncinya ADA yang bukan huruf. Template KKP NTB memuat spasi yang hilang
 *    — "JUMLAHPEK. :", "JUMLAHPENGEBORAN :", "JUMLAHPENERANGAN TIANG T=7m :" —
 *    sehingga ketiganya lolos dan nilainya dijumlahkan lagi di atas rinciannya.
 *    Di Batu Putih itu menggandakan PEKERJAAN REVETMENT (65,7 jt → 131,4 jt),
 *    menambah 321,2 jt ke TANGKI AIR, dan 73,5 jt ke PENERANGAN. Salah ketik di
 *    Excel memang, tapi angkanya keluar dari sistem kita, jadi ini cacat kita.
 *
 * 2. Penentuannya HANYA dari nama. Artinya butir pekerjaan yang namanya kebetulan
 *    diawali kata itu — "Total Station" (alat ukur) yang wajar muncul di
 *    PEKERJAAN PERSIAPAN — ikut dibuang tanpa suara, dan nilai kontrak jadi
 *    KURANG. Tidak ada galat, tidak ada peringatan; barisnya sekadar lenyap.
 *
 * Karena itu rekap sekarang ditentukan dari BENTUK barisnya, bukan namanya saja:
 * nama diawali kata kunci DAN kolom kode KOSONG. Dicek pada 8 berkas HPS/RAB
 * nyata: 155 baris rekap, SEMUANYA berkode kosong; dan tidak ada satu pun butir
 * pekerjaan berkode yang namanya diawali kata kunci itu.
 *
 * Baris berkode yang namanya menyerupai rekap tidak dibuang diam-diam — parser
 * menerbitkan peringatan supaya keputusannya terlihat, bukan ditebak.
 */
export function isSummaryRow(name: string, code = ""): boolean {
  return SUMMARY_PREFIX.test(name.trim()) && code.trim() === "";
}

/** Kosakata baris penutup RAB — termasuk yang bukan "jumlah": PPN, dibulatkan. */
const REKAP_PENUTUP = /^(jumlah|sub\s*total|subtotal|total|grand\s*total|rekapitulasi|ppn|pph|pajak|dibulatkan|pembulatan|terbilang)\b/i;

/**
 * Baris penutup yang PUNYA KODE — dikenali dari BENTUKNYA, bukan namanya saja.
 *
 * Berkas `DRAFT_MC0_..._KEMANTREN` menutup RAB-nya dengan empat baris bernomor
 * A/B/C/D di kolom NO: "JUMLAH HARGA", "PPN 11 %", "JUMLAH TOTAL",
 * "DIBULATKAN". Aturan lama hanya membuang baris rekap yang kolom kodenya
 * KOSONG, jadi keempatnya masuk sebagai pekerjaan — dan karena tiga di antaranya
 * memuat nilai TOTAL seluruh RAB, nilai kontrak yang terbaca membengkak dari
 * 7,97 M jadi 34,5 M (4×) hanya karena baris tanda tangan.
 *
 * Yang membedakannya dari butir pekerjaan bukan namanya (ada alat ukur bernama
 * "Total Station" di PEKERJAAN PERSIAPAN, dan ia harus tetap terhitung),
 * melainkan bahwa baris penutup TIDAK punya volume DAN TIDAK punya harga
 * satuan: ia cuma memindahkan angka dari baris-baris di atasnya.
 */
function adalahRekapPenutup(name: string, volume: number | null, unitPrice: number | null): boolean {
  return REKAP_PENUTUP.test(name.trim()) && volume == null && unitPrice == null;
}

/** Peta kolom nilai (1-indexed) hasil deteksi header. */
export type ColMap = { vol: number; unit: number; price: number; amount: number; tkdn: number };

export type PriceSource = "nego" | "penawaran" | "hps";

const NC = 24; // kolom A..X — cukup utk semua varian RAB KKP

/** Huruf kolom Excel utk pesan ke user ("kolom K/L"). */
export function colLetter(c: number): string {
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function labelsOf(row: ExcelJS.Row): string[] {
  const arr: string[] = [];
  for (let c = 1; c <= NC; c++) arr[c] = str(cellVal(row, c)).toUpperCase().replace(/\s+/g, " ").trim();
  return arr;
}

/** Blok harga: HPS (pagu) | PENAWARAN | NEGOSIASI (hasil klarifikasi). */
const BLOCK_RE = /HPS|PENAWAR|NEGO/;

/**
 * Deteksi kolom nilai. RAB/HPS/Lampiran-Negosiasi KKP TIDAK seragam — sedikitnya
 * empat bentuk header nyata ditemukan di korpus:
 *
 *  (a) satu baris   : NO | JENIS | VOL | SAT | HARGA SATUAN | JUMLAH HARGA | TKDN
 *  (b) satu baris   : … | NILAI HPS | JUMLAH | HARGA NEGOISASI | JUMLAH HARGA
 *  (c) dua baris    : grup "HPS | PENAWARAN | NEGOSIASI" DI ATAS
 *                     "HARGA SATUAN | HARGA TOTAL" (berulang per blok)   [Asemdoyong]
 *  (d) dua baris    : grup sama, tapi sub-barisnya "HPS | TOTAL HPS |
 *                     HARGA PENAWARAN | TOTAL PENAWARAN | HARGA NEGOSIASI |
 *                     TOTAL NEGOSIASI" — TANPA kata "HARGA SATUAN"      [Kedungrejo]
 *  (e) grup jauh    : baris grup HPS/PENAWARAN/NEGOSIASI di baris 1, header
 *                     utama (VOL/SAT + "HARGA SATUAN" ×3) baru di baris 9 [Pesisir]
 *
 * Deteksi lama hanya mengenali (a)–(c): ia menuntut kata "HARGA SATUAN" di baris
 * bawah dan hanya melihat header utama + 1 baris di bawahnya. Akibatnya (d) dan
 * (e) jatuh ke posisi klasik G/H = HPS — nilai kontrak diimpor sebesar PAGU HPS,
 * bukan hasil negosiasi (DECISIONS 175).
 *
 * Pendekatan sekarang: cari baris GRUP (di mana pun di atas/sama dengan header
 * utama) yang memuat ≥2 label blok, tandai rentang kolom tiap blok (label grup
 * terdekat di kiri — merge left-anchored), lalu di dalam blok terpilih tentukan
 * peran kolom dari gabungan label header utama + sub-header:
 *   TOTAL/JUMLAH → kolom jumlah; HARGA/NILAI/SATUAN → kolom harga satuan.
 * Nilai KONTRAK = blok NEGOSIASI > PENAWARAN > HPS (HPS cuma pagu, tak pernah
 * jadi nilai kontrak). Tanpa baris grup → jalur lama (HARGA SATUAN/JUMLAH).
 * Tanpa header sama sekali → posisi klasik (G/H/I, mis. fixture uji).
 */
export function detectColumns(ws: ExcelJS.Worksheet): {
  col: ColMap;
  usedNego: boolean;
  priceSource: PriceSource;
} {
  const classic: ColMap = { vol: 5, unit: 6, price: 7, amount: 8, tkdn: 9 };

  // Baris header UTAMA = punya VOL & SAT (satuan) sebagai sel terpisah. Ini menghindari
  // salah-deteksi baris rekap "JUMLAH" (kolom B) sbg header.
  // Sampai baris 60: berkas KKP nyata menaruh headernya di baris 21 (KEMANTREN),
  // dan yang berkop panjang bisa lebih jauh lagi. Loop berhenti di temuan pertama.
  let mainRow: ExcelJS.Row | null = null;
  for (let rn = 1; rn <= 60; rn++) {
    const L = labelsOf(ws.getRow(rn));
    if (L.some((l) => /^VOL/.test(l)) && L.some((l) => /^SAT/.test(l))) {
      mainRow = ws.getRow(rn);
      break;
    }
  }
  if (!mainRow) return { col: classic, usedNego: false, priceSource: "hps" };

  const head = labelsOf(mainRow);
  const below = labelsOf(ws.getRow(mainRow.number + 1));
  // Sub-header ada bila baris di bawah header memuat ≥2 label nilai. Sengaja TIDAK
  // menuntut kata "HARGA SATUAN" (varian (d) memakai "HARGA NEGOSIASI"/"TOTAL NEGOSIASI").
  const hasSub = below.filter((l) => l && /HARGA|TOTAL|JUMLAH|NILAI/.test(l)).length >= 2;
  const sub = hasSub ? below : [];

  const findFirst = (pred: (c: number) => boolean): number | null => {
    for (let c = 1; c <= NC; c++) if (pred(c)) return c;
    return null;
  };
  /** Label peran kolom = header utama + sub-header (blok tak ikut, itu urusan blockAt). */
  const roleAt = (c: number): string => `${head[c] ?? ""} ${sub[c] ?? ""}`.trim();
  const isTotalCol = (c: number) => /TOTAL|JUMLAH/.test(roleAt(c));
  const isPriceCol = (c: number) => {
    const s = roleAt(c);
    if (!s || isTotalCol(c)) return false;
    if (/TKDN|KDN|BOBOT|^%$|TIMPANG/.test(s)) return false; // kolom rasio, bukan harga
    // `/^SAT\b/` dulu di sini, dan ia TIDAK PERNAH cocok dengan "SATUAN":
    // "\b" menuntut batas kata sesudah "SAT", padahal huruf berikutnya "U"
    // juga karakter kata. Jadi header bertuliskan SATUAN lolos penyaring ini,
    // lalu ditangkap `/HARGA|NILAI|SATUAN/` di baris bawah - dan karena
    // pemindaian dari kiri, kolom SATUAN ditemukan SEBELUM "HARGA SATUAN".
    // Harga lalu dibaca dari sel satuan: "m3" jadi 3, "m2" jadi 2, "bh"/"ls"
    // jadi kosong. Cek-silang butuh 20 baris berangka lengkap, dan satuan
    // tanpa digit membuat baris tidak ikut dihitung, jadi RAB bersatuan
    // "bh/ls/kg" lolos tanpa satu peringatan pun. Audit 2026-09-01.
    //
    // Kolom "HARGA SATUAN" tidak terkena: labelnya dimulai "HARGA".
    if (/^VOL/.test(s) || /^SAT/.test(s)) return false;
    return /HARGA|NILAI|SATUAN/.test(s);
  };

  const vol = findFirst((c) => /^VOL/.test(head[c] ?? "")) ?? classic.vol;
  const unit = findFirst((c) => /^SAT/.test(head[c] ?? "")) ?? classic.unit;
  // TKDN: pakai kolom bila terdeteksi; kalau tidak, kolom jauh (kosong → null) supaya
  // tak salah baca kolom harga blok lain sbg rasio TKDN.
  const tkdn = findFirst((c) => /TKDN/.test(roleAt(c))) ?? 999;

  // Baris GRUP blok harga: baris terdekat DI ATAS (atau sama dengan) header utama
  // yang memuat ≥2 label blok di area nilai (kolom ≥5). Ambang ≥2 mencegah kata
  // "HPS" di judul dokumen dianggap baris grup.
  let blockRow: string[] | null = null;
  for (let rn = mainRow.number; rn >= 1; rn--) {
    const L = labelsOf(ws.getRow(rn));
    let hits = 0;
    for (let c = 5; c <= NC; c++) if (L[c] && BLOCK_RE.test(L[c])) hits++;
    if (hits >= 2) {
      blockRow = L;
      break;
    }
  }

  let price: number | null = null;
  let amount: number | null = null;
  let priceSource: PriceSource = "hps";

  if (blockRow) {
    // Label blok utk kolom c = label blok non-kosong terdekat di KIRI (sel merge
    // hanya mengisi sel pertama). Kolom sebelum blok pertama → "".
    const blockAt = (c: number): string => {
      for (let k = c; k >= 1; k--) {
        const l = blockRow![k];
        if (l && BLOCK_RE.test(l)) return l;
      }
      return "";
    };
    const pick = (re: RegExp): { price: number; amount: number } | null => {
      const cols: number[] = [];
      for (let c = 1; c <= NC; c++) if (re.test(blockAt(c))) cols.push(c);
      if (cols.length === 0) return null;
      const p = cols.find((c) => c !== unit && isPriceCol(c)) ?? cols[0];
      const a = cols.find((c) => c > p && isTotalCol(c)) ?? p + 1;
      return { price: p, amount: a };
    };
    // Prioritas nilai kontrak: NEGOSIASI > PENAWARAN > HPS.
    const order: [PriceSource, RegExp][] = [
      ["nego", /NEGO/],
      ["penawaran", /PENAWAR/],
      ["hps", /HPS/],
    ];
    for (const [source, re] of order) {
      const hit = pick(re);
      if (!hit) continue;
      price = hit.price;
      amount = hit.amount;
      priceSource = source;
      break;
    }
  }

  if (price == null) {
    // Tanpa baris grup blok: header polos "HARGA SATUAN | JUMLAH HARGA".
    // Lapis kedua, tidak bergantung pada ejaan: kolom satuan tidak akan pernah
    // menjadi kolom harga. Regex di atas menutup ejaan yang sudah diketahui;
    // ini menutup ejaan yang belum.
    price = findFirst((c) => c !== unit && isPriceCol(c)) ?? classic.price;
    amount = findFirst((c) => c > price! && isTotalCol(c)) ?? price + 1;
    priceSource = "hps";
  }

  return {
    col: { vol, unit, price, amount: amount ?? price + 1, tkdn },
    usedNego: priceSource !== "hps",
    priceSource,
  };
}

/** Bentuk teks yang bisa jadi KODE baris — dipakai saat kode tidak di kolom A. */
export function berbentukKode(t: string): boolean {
  return (
    isRoman(t) || SUBCODE.test(t) || NUM.test(t) || DOTNUM.test(t) || DEEPCODE.test(t) || LETTER.test(t)
  );
}

/** Label kolom uraian — bervariasi tiap penyusun, jadi dikumpulkan, bukan ditebak satu. */
const URAIAN_RE = /^(URAIAN|JENIS|NAMA|MACAM|ITEM|DESKRIPSI|PEKERJAAN)\b/;

/**
 * Kolom KODE — DIDETEKSI, bukan diasumsikan kolom A.
 *
 * Berkas RAB KKP disusun banyak orang berbeda dan tidak ada satu pun yang
 * mengikat: `DRAFT_MC0_..._KEMANTREN` menaruh NO di kolom **B** dan URAIAN di C,
 * dengan huruf rincian (a, b, c) turun lagi ke kolom D. Walker lama membaca kode
 * HANYA dari kolom A; di berkas itu kolom A kosong sepanjang 2.392 baris,
 * sehingga tidak satu pun kategori terbuka dan SELURUH barisnya dibuang oleh
 * `if (!cat) return`. Hasilnya nol item — lalu dilaporkan sebagai *"Sheet RAB
 * tidak ditemukan"*, padahal sheetnya dibaca dari awal sampai akhir.
 *
 * Dua sandaran, sengaja tidak bergantung pada satu kata pun:
 *
 * 1. Label "NO"/"NO." di baris yang juga memuat URAIAN atau VOL.
 * 2. Kalau labelnya lain (atau tidak ada), **bentuk isinya**: kolom paling KIRI
 *    di kiri kolom uraian yang isinya paling sering berbentuk kode. Paling kiri,
 *    bukan yang skornya tertinggi — pada berkas berjenjang-kolom, kolom huruf
 *    rincian (D) justru lebih sering terisi daripada kolom nomor induknya (B).
 *
 * Batas kanannya kolom URAIAN, bukan kolom volume: di antara keduanya sering ada
 * kolom angka (volume kontrak, bobot) yang isinya juga "berbentuk kode".
 */
export function detectCodeColumn(ws: ExcelJS.Worksheet, batas: number): number {
  const maxRow = Math.min(60, ws.rowCount);
  const tepi = Math.min(batas, NC + 1);

  let kolomUraian = 0;
  let barisHeader = 0;
  for (let rn = 1; rn <= maxRow && !kolomUraian; rn++) {
    const L = labelsOf(ws.getRow(rn));
    for (let c = 2; c < tepi; c++)
      if (URAIAN_RE.test(L[c] ?? "")) {
        kolomUraian = c;
        barisHeader = rn;
        break;
      }
  }
  const kanan = kolomUraian > 1 ? kolomUraian : tepi;

  // (1) Label eksplisit.
  for (let rn = 1; rn <= maxRow; rn++) {
    const L = labelsOf(ws.getRow(rn));
    if (!L.some((l) => /^URAIAN|^VOL/.test(l ?? ""))) continue;
    for (let c = 1; c < kanan; c++) if (/^NO\.?$/.test(L[c] ?? "")) return c;
  }

  // (2) Bentuk isinya. Hanya bila kolom uraian diketahui — tanpa batas kanan
  // yang jelas, statistik ini bisa memenangkan kolom angka.
  if (kolomUraian > 1) {
    const skor = new Array<number>(kanan).fill(0);
    ws.eachRow((row) => {
      if (row.number <= barisHeader) return;
      for (let c = 1; c < kanan; c++) {
        const t = str(cellVal(row, c));
        if (t && berbentukKode(t)) skor[c] += 1;
      }
    });
    const terbaik = Math.max(0, ...skor);
    if (terbaik >= 5) for (let c = 1; c < kanan; c++) if (skor[c] >= terbaik * 0.25) return c;
  }
  return 1;
}

/** Nilai romawi I..XXXIX → angka. 0 bila bukan romawi. */
export function romanToInt(s: string): number {
  const t = s.replace(/\.$/, "").toUpperCase();
  if (!isRoman(t)) return 0;
  const nilai: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const kini = nilai[t[i]];
    const nanti = nilai[t[i + 1]] ?? 0;
    total += kini < nanti ? -kini : kini;
  }
  return total;
}

export function sumLeaves(items: ParsedRabItem[]): number {
  let t = 0;
  for (const it of items) {
    const childSum = it.children.length > 0 ? sumLeaves(it.children) : 0;
    const own = it.total_price ?? 0;
    if (childSum === 0) {
      t += own; // leaf: pakai nilai sendiri
    } else if (own === 0) {
      t += childSum; // grup tanpa nilai sendiri (konvensi umum RAB KKP: subtotal di baris terpisah)
    } else if (Math.abs(own - childSum) <= Math.max(2, childSum * 0.001)) {
      t += own; // baris grup memuat SUBTOTAL anak (breakdown) — jangan dihitung ganda
    } else {
      // Item BERHARGA yang juga punya baris tambahan (mis. "Pengiriman", atau baris
      // berkode rusak #REF! yang nyangkut jadi anak) → jumlahkan keduanya, jangan
      // membuang nilai item induknya. (Bug lama: nilai induk hilang.)
      t += own + childSum;
    }
  }
  return t;
}

/** Ringkasan kolom nilai yang DIPAKAI — ditampilkan di pratinjau impor. */
export type PriceColumnInfo = {
  source: PriceSource;
  /** Label siap-tampil, mis. "NEGOSIASI (kolom K/L)". */
  label: string;
};

export function priceColumnInfo(source: PriceSource, col: ColMap): PriceColumnInfo {
  const name = source === "nego" ? "NEGOSIASI" : source === "penawaran" ? "PENAWARAN" : "HPS";
  return { source, label: `${name} (kolom ${colLetter(col.price)}/${colLetter(col.amount)})` };
}

export type ParseHpsResult = {
  parsed: ParsedRab;
  warnings: string[];
  priceColumn: PriceColumnInfo;
};

/**
 * Baca berkas → pohon RAB, dengan HANYA sheet yang diperlukan yang dimuat.
 *
 * Permintaan user 2026-08-07: *"kamu kan cuma perlu baca sheet tertentu saja,
 * dan yang tidak dihide."* Betul, dan itu menutup lubang terakhir: sebelum ini,
 * bila tak ada sheet bernama RAB/CCO, penipisan MENYERAH dan seluruh workbook
 * ikut dimuat — jalur 180 MB yang sama yang mematikan proses (DECISIONS 297).
 *
 * Sekarang sheet dipilih dari daftar nama di dalam zip (beberapa KB), lalu
 * berkasnya ditipiskan ke SATU sheet itu sebelum dimuat. Kandidat dicoba
 * berurutan; yang tidak menghasilkan baris apa pun dilepas sebelum kandidat
 * berikutnya dimuat, jadi puncak memorinya tetap satu-sheet berapa pun banyak
 * sheet di berkasnya.
 *
 * Sheet TERSEMBUNYI tidak pernah dicoba: di berkas KKP itu sisa kerja, arsip,
 * atau lembar bantu — bukan yang sedang dipakai tim.
 */
/**
 * Pesan saat tidak ada sheet yang bisa dibaca — MENYEBUT isi berkasnya.
 *
 * Pesan lama, *"Sheet RAB tidak ditemukan di file HPS"*, benar secara teknis
 * tapi tidak bisa ditindaklanjuti: orang tidak tahu berkasnya salah yang mana.
 * Berkas tambah/kurang KKP sendiri SUDAH diterima (DECISIONS 296), jadi sampai
 * di sini berarti bentuknya tak dikenali atau angkanya tidak terbukti.
 */
function pesanSheetTakAdaDariNama(nama: string[], dibacaTapiKosong: string[] = []): string {
  if (dibacaTapiKosong.length > 0) {
    // Pesan lama menuduh sheetnya TIDAK ADA sambil menyebutkannya di daftar
    // pada kalimat yang sama – kontradiksi yang membuat pemakainya mencari
    // masalah di tempat yang salah. Sheetnya ada dan dibaca; yang tidak
    // ditemukan adalah baris pekerjaannya.
    const dibaca = dibacaTapiKosong.map((n) => `"${n}"`).join(", ");
    return (
      `Sheet ${dibaca} DIBACA sampai habis, tapi tidak ada satu pun baris pekerjaan yang dikenali. ` +
      "Biasanya karena kolom NO/URAIAN atau kolom VOLUME/HARGA SATUAN/JUMLAH tidak berada di tempat " +
      "yang bisa dikenali – periksa baris headernya, atau kirim berkas ini supaya susunannya ditambahkan."
    );
  }
  if (nama.some((n) => /^\s*CCO\s*-?\s*\d+/i.test(n))) {
    return (
      "Berkas ini berbentuk dokumen CCO, tapi kolom volume/harga/jumlah-nya tidak bisa dipastikan – " +
      "pada baris contoh, volume × harga satuan tidak sama dengan jumlah harga. " +
      "Periksa apakah susunan kolomnya berubah atau angkanya belum lengkap; kalau ragu, pakai Template Adendum dari halaman ini."
    );
  }
  const daftar = nama.slice(0, 6).join(", ") || "(tidak ada sheet terlihat)";
  return `Sheet "RAB" tidak ditemukan, dan tidak ada sheet berformat tambah/kurang KKP. Sheet yang ada di berkas ini: ${daftar}.`;
}

function pesanSheetTakAda(wb: ExcelJS.Workbook): string {
  return pesanSheetTakAdaDariNama(wb.worksheets.map((w) => w.name));
}

export async function parseHpsBuffer(buf: Buffer | ArrayBuffer): Promise<ParseHpsResult> {
  const sheets = (await namaSheetXlsx(buf)).filter((s) => !s.tersembunyi);
  // Urutan kandidat: nama pasti dulu, lalu bentuk CCO, lalu sisanya. Dibatasi
  // supaya berkas dengan puluhan sheet tidak berubah jadi puluhan pemuatan.
  // Nama tab pun tidak seragam antar penyusun: "RAB", "BQ", "BOQ", "Daftar
  // Kuantitas", "Lampiran", "MC-0", "RAB Revisi". Yang tidak dikenali TETAP
  // dicoba (skor terakhir) — namanya hanya menentukan URUTAN, bukan izin masuk.
  const skor = (n: string) => {
    const t = n.trim();
    if (t === "RAB") return 0;
    if (/^rab\b/i.test(t)) return 1;
    if (/^(cco|mc)\s*-?\s*\d*$/i.test(t)) return 2;
    if (/\brab\b|^b\.?o?\.?q\b|daftar kuantitas|kuantitas dan harga|rincian biaya|lampiran/i.test(t))
      return 3;
    return 4;
  };
  const kandidat = sheets
    .map((s) => s.nama)
    .sort((a, b) => skor(a) - skor(b))
    .slice(0, 8);

  let terakhir: unknown = null;
  /** Sheet yang BERHASIL dibaca tapi nol baris — dipakai menyusun pesan jujur. */
  const kosong: string[] = [];
  for (const nama of kandidat) {
    let wb: ExcelJS.Workbook;
    try {
      const slim = await slimRabWorkbook(buf, nama);
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(slim as unknown as ArrayBuffer);
    } catch (e) {
      terakhir = e;
      continue;
    }
    try {
      const hasil = parseHpsWorkbook(wb);
      // Sheet yang bukan RAB (Resume, Analisa, …) terbaca tanpa satu pun baris.
      // Itu bukan galat — cukup lanjut ke kandidat berikutnya.
      if (hasil.parsed.categories.some((c) => c.direct_items.length > 0 || c.subcategories.length > 0))
        return hasil;
      // Sheet bernama RAB yang kosong itu KEJANGGALAN, bukan sekadar kandidat
      // lewat: ia harus disebut di pesan galat, bukan hilang.
      if (/rab/i.test(nama)) kosong.push(nama);
    } catch (e) {
      terakhir = e;
    }
  }
  // Tidak ada kandidat yang berisi: laporkan dengan menyebut isi berkasnya.
  if (terakhir instanceof Error) throw terakhir;
  throw new Error(pesanSheetTakAdaDariNama(sheets.map((s) => s.nama), kosong));
}

export function parseHpsWorkbook(wb: ExcelJS.Workbook): ParseHpsResult {
  const warnings: string[] = [];
  // Sheet RAB dulu; kalau tidak ada, sheet mana pun yang berbentuk
  // tambah/kurang KKP (berkas CCO/MC-0 yang dikerjakan tim di luar MARLIN).
  const ws =
    wb.getWorksheet("RAB") ??
    wb.worksheets.find((w) => /rab/i.test(w.name)) ??
    wb.worksheets.find((w) => deteksiCco(w) !== null) ??
    // Workbook satu-sheet = sudah ditipiskan ke kandidat pilihan oleh
    // `parseHpsBuffer`; namanya boleh apa saja. Berkas KKP nyata memakai
    // "Lampiran", "BQ", "RAB Revisi" — memaksa nama "RAB" berarti menolak
    // pekerjaan yang isinya sudah benar hanya karena judul tabnya.
    (wb.worksheets.length === 1 ? wb.worksheets[0] : undefined);
  if (!ws) throw new Error(pesanSheetTakAda(wb));

  /**
   * Berkas tambah/kurang KKP dibaca APA ADANYA (DECISIONS 296).
   *
   * Volume diambil dari blok HASIL — keadaan SESUDAH adendum — sedangkan
   * satuan dan harga satuan dari blok DASAR, karena adendum mengubah volume,
   * bukan harga satuan. Peran blok ditentukan dari POSISI + pembuktian
   * `volume × harga ≈ jumlah`, tidak pernah dari namanya: label "MC-0" berarti
   * HASIL di satu berkas dan KEADAAN AWAL di berkas lain.
   */
  const peta = deteksiCco(ws);
  const { col, priceSource } = peta
    ? { col: peta.col, priceSource: "hps" as const }
    : detectColumns(ws);
  const priceColumn = peta
    ? {
        source: "hps" as const,
        label: `CCO KKP – volume dari blok "${peta.blokHasil.label}" (kolom ${colLetter(peta.col.vol)}), harga satuan dari blok "${peta.blokDasar.label}" (kolom ${colLetter(peta.col.price)})`,
      }
    : priceColumnInfo(priceSource, col);
  const kolomKode = detectCodeColumn(ws, col.vol);
  if (peta?.hasilDariDasar) {
    // Berkas DRAFT: kolom adendumnya ada tapi belum diisi. Dikatakan, bukan
    // didiamkan — pemakainya harus tahu yang masuk adalah keadaan dasar.
    warnings.push(
      `Berkas berformat tambah/kurang KKP, tapi blok adendumnya masih KOSONG. ` +
        `Yang diimpor adalah blok "${peta.blokDasar.label}" apa adanya (kolom volume ${colLetter(peta.col.vol)}) – ` +
        `belum ada perubahan volume di berkas ini.`,
    );
  } else if (peta) {
    const { berubah, total } = hitungPerubahan(ws, peta);
    warnings.push(
      `Berkas berformat tambah/kurang KKP. Volume diambil dari blok "${peta.blokHasil.label}" ` +
        `(kolom ${colLetter(peta.col.vol)}) – keadaan SESUDAH adendum; satuan & harga satuan dari blok ` +
        `"${peta.blokDasar.label}". ${berubah} dari ${total} item volumenya berbeda dari blok "${peta.blokDasar.label}".`,
    );
    // Nilai total kedua blok bisa SAMA PERSIS sementara ratusan item berbeda
    // (adendum yang netral nilai). Tanpa kalimat di atas, salah-baca blok tidak
    // akan pernah tertangkap lewat pemeriksaan total.
  }
  if (priceSource === "nego")
    warnings.push(
      `File punya kolom HARGA NEGOSIASI – nilai kontrak diambil dari kolom ${colLetter(col.price)}/${colLetter(col.amount)} (bukan HPS).`,
    );
  else if (priceSource === "penawaran")
    warnings.push(
      `File tidak punya kolom NEGOSIASI – nilai kontrak diambil dari kolom PENAWARAN ${colLetter(col.price)}/${colLetter(col.amount)} (bukan HPS).`,
    );

  let project = "";
  let locationRaw = "";
  let year: number | null = null;
  const categories: ParsedRabCategory[] = [];

  let cat: ParsedRabCategory | null = null;
  /** Romawi kategori terakhir — dipakai menguji apakah romawi berikutnya lanjut. */
  let romanTerakhir = "";
  let sub: ParsedRabSubcategory | null = null;
  let itemL1: ParsedRabItem | null = null; // item numerik (mis. "6")
  let itemL2: ParsedRabItem | null = null; // sub-item dotted (mis. "6.1")
  let subSeen = new Map<string, number>(); // dedup kode sub per kategori
  /** Item per kode dalam kategori berjalan — untuk menemukan induk kode berjenjang. */
  let byCode = new Map<string, ParsedRabItem>();
  let orphanSeq = 0; // penomoran baris berkode rusak/kosong yang jadi item sendiri

  // Cek-silang kolom: pada baris berharga, volume × harga satuan harus ≈ jumlah.
  // Kalau banyak yang meleset, kolom nilai kemungkinan salah terdeteksi (mis. harga
  // blok A dipasangkan dgn jumlah blok B) — ini jaring pengaman untuk varian header
  // yang belum pernah ditemui, bukan untuk membetulkan angka diam-diam.
  let crossChecked = 0;
  let crossMismatch = 0;

  const mkItem = (
    code: string,
    name: string,
    row: ExcelJS.Row,
    parentCode: string | null,
  ): ParsedRabItem => {
    const volume = num(cellVal(row, col.vol));
    const unitPrice = num(cellVal(row, col.price));
    const totalPrice = num(cellVal(row, col.amount));
    if (volume != null && volume !== 0 && unitPrice != null && totalPrice != null && totalPrice !== 0) {
      crossChecked++;
      if (Math.abs(volume * unitPrice - totalPrice) > Math.max(2, Math.abs(totalPrice) * 0.01))
        crossMismatch++;
    }
    return {
      code,
      name,
      volume,
      unit: volume != null ? str(cellVal(row, col.unit)) || null : null,
      unit_price: unitPrice,
      total_price: totalPrice,
      tkdn_ratio: num(cellVal(row, col.tkdn)),
      parent_code: parentCode,
      children: [],
    };
  };
  /**
   * KODE + NAMA satu baris.
   *
   * Tata letak KLASIK (kode di kolom A) dibaca persis seperti dulu. Bila kolom
   * "NO" ternyata bergeser ke kanan, kode dicari sebagai sel TERISI PERTAMA yang
   * BERBENTUK kode di kiri kolom volume, dan namanya sel terisi berikutnya —
   * karena di berkas semacam itu jenjang dinyatakan dengan MENURUNKAN KOLOM
   * (NO di B untuk "1"/"6.1", tapi di D untuk huruf "a"), bukan sekadar
   * menggeser semuanya sejauh satu kolom.
   */
  const kodeNamaOf = (row: ExcelJS.Row): { code: string; name: string } => {
    if (kolomKode <= 1)
      return {
        code: str(cellVal(row, 1)),
        name: str(cellVal(row, 2)) || str(cellVal(row, 3)) || str(cellVal(row, 4)),
      };
    const batas = Math.min(col.vol, NC + 1);
    for (let c = kolomKode; c < batas; c++) {
      const t = str(cellVal(row, c));
      if (!t) continue;
      // Sel terisi PERTAMA bukan kode ⇒ baris tanpa kode (uraian lanjutan,
      // baris rekap, metadata). Jangan diangkat jadi kode: itu akan membuat
      // nama pekerjaan dibaca sebagai nomor.
      if (!berbentukKode(t)) return { code: "", name: t };
      for (let d = c + 1; d < batas; d++) {
        const n = str(cellVal(row, d));
        if (n) return { code: t, name: n };
      }
      return { code: t, name: "" };
    }
    return { code: "", name: "" };
  };
  /** Nilai metadata (PROYEK/LOKASI/TAHUN) di kanan labelnya. */
  const metaOf = (row: ExcelJS.Row): unknown => {
    if (kolomKode <= 1) return cellVal(row, 4);
    for (let c = Math.min(col.vol, NC + 1) - 1; c > kolomKode; c--) {
      const v = cellVal(row, c);
      const t = str(v);
      if (t && t !== ":") return v;
    }
    return null;
  };
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
    romanTerakhir = roman;
    cat = {
      roman,
      name: `PEKERJAAN (kategori ${roman} – judul tidak ada di file)`,
      total_value: 0,
      subcategories: [],
      direct_items: [],
    };
    categories.push(cat);
    sub = null;
    itemL1 = null;
    itemL2 = null;
    subSeen = new Map();
    byCode = new Map();
    warnings.push(
      `Kategori ${roman} tidak punya baris judul di file – dibuat otomatis dari sub-kode ${roman}.x agar totalnya tidak tergabung ke kategori sebelumnya. Mohon lengkapi judul kategori ${roman}.`,
    );
  };

  let hiddenSkipped = 0;
  ws.eachRow((row) => {
    // Baris yang SENGAJA DI-HIDE di Excel (mis. dikecualikan dari resume) tidak
    // ikut dihitung — importer mengikuti apa yang terlihat, sama seperti resume
    // kontrak. Sinyal: atribut hidden Excel; height 0 sbg cadangan defensif.
    if (row.hidden === true || row.height === 0) {
      const { code: c, name: nm } = kodeNamaOf(row);
      if ((c || nm) && !isSummaryRow(nm)) hiddenSkipped++;
      return;
    }

    const { code, name } = kodeNamaOf(row);

    // Metadata ringan
    const joined = `${code} ${name}`.toUpperCase();
    // Label metadata ada di kolom kode pada tata letak klasik, di kolom nama
    // pada tata letak bergeser (di sana "PROYEK"/"LOKASI" bukan bentuk kode).
    const labelMeta = (kolomKode > 1 ? name : code).toUpperCase();
    if (joined.includes("PROYEK") && !project) project = str(metaOf(row));
    if (labelMeta === "LOKASI" && !locationRaw) locationRaw = str(metaOf(row));
    if (joined.includes("TAHUN ANGGARAN")) year = num(metaOf(row));

    if (!code && !name) return;

    // Baris rekap/subtotal ("JUMLAH", "SUB TOTAL", "TOTAL", dll) — JANGAN masuk pohon.
    if (isSummaryRow(name, code)) return;
    // Baris penutup bernomor (JUMLAH HARGA / PPN / DIBULATKAN) — lihat
    // `adalahRekapPenutup`. Dicek SEBELUM peringatan di bawah supaya baris yang
    // memang penutup tidak jadi peringatan yang tak bisa ditindaklanjuti.
    if (adalahRekapPenutup(name, num(cellVal(row, col.vol)), num(cellVal(row, col.price)))) return;
    // Berkode TAPI bernama seperti rekap: diperlakukan sebagai pekerjaan biasa.
    // Disebutkan supaya keputusannya terlihat — kalau ternyata ini memang baris
    // rekap yang kebetulan berkode, penggelembungannya ketahuan sejak pratinjau.
    if (SUMMARY_PREFIX.test(name.trim()))
      warnings.push(
        `Baris ${row.number} "${name}" berkode "${code}" – namanya menyerupai baris rekap, tapi karena berkode ia DIHITUNG sebagai pekerjaan. Periksa bila totalnya terasa berlebih.`,
      );

    /*
     * KATEGORI. Dulu: kode romawi DAN nama diawali "PEKERJAAN".
     *
     * Syarat kedua itu menuntut satu kata yang tidak diwajibkan siapa pun.
     * Berkas yang menulis "I | PERSIAPAN", "I | PEK. PERSIAPAN", atau
     * "I | STRUKTUR" gagal membuka kategori mana pun — dan berkas tanpa satu
     * kategori pun berakhir persis seperti KEMANTREN: nol item, lalu dilaporkan
     * sebagai "sheet tidak ditemukan". Berkas RAB KKP ditulis banyak orang
     * berbeda; satu kata tidak boleh jadi syarat hidup-mati.
     *
     * Yang menggantikannya BENTUK barisnya, bukan kata:
     *  - kodenya romawi HURUF BESAR (huruf rincian "i"/"v"/"x" huruf kecil), dan
     *  - barisnya baris JUDUL: tanpa volume dan tanpa harga satuan, dan
     *  - romawinya MELANJUTKAN urutan (I, lalu II, …).
     * Nama diawali "PEKERJAAN" tetap diterima tanpa syarat tambahan — itu
     * bentuk yang sudah terbukti di korpus lama.
     */
    const romanBerikutnya = romanToInt(romanTerakhir) + 1;
    const judulTanpaAngka =
      num(cellVal(row, col.vol)) == null && num(cellVal(row, col.price)) == null;
    if (
      isRoman(code) &&
      code === code.toUpperCase() &&
      name !== "" &&
      (/^PEKERJAAN/i.test(name) || (judulTanpaAngka && romanToInt(code) === romanBerikutnya))
    ) {
      romanTerakhir = romanCode(code);
      cat = { roman: romanCode(code), name, total_value: 0, subcategories: [], direct_items: [] };
      categories.push(cat);
      sub = null;
      itemL1 = null;
      itemL2 = null;
      subSeen = new Map();
      byCode = new Map();
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
      byCode.set(it.code, it);
      itemL1 = it;
      itemL2 = null;
      return;
    }

    // Sub-item dotted (6.1, 6.1.) → anak dari item numerik
    if (DOTNUM.test(code)) {
      const it = mkItem(code.replace(/\.$/, ""), name, row, itemL1?.code ?? null);
      if (itemL1) itemL1.children.push(it);
      else (sub ? sub.items : cat.direct_items).push(it);
      byCode.set(it.code, it);
      itemL2 = it;
      return;
    }

    // Kode LENGKAP berjenjang ("6.1.a", "6.7.1") — bentuk yang DIHASILKAN parser
    // ini sendiri lalu ditulis kembali oleh ekspor RAB. Induknya dicari dari
    // prefix kodenya, jadi urutan baris tidak perlu ditebak (DECISIONS 208).
    if (DEEPCODE.test(code)) {
      const parentCode = code.slice(0, code.lastIndexOf("."));
      const parent = byCode.get(parentCode) ?? itemL2 ?? itemL1;
      const it = mkItem(code, name, row, parent?.code ?? null);
      if (parent) parent.children.push(it);
      else (sub ? sub.items : cat.direct_items).push(it);
      byCode.set(code, it);
      return;
    }

    // Huruf (a,b,c) atau kode kosong (lanjutan) → anak grup terdalam saat ini
    if (LETTER.test(code) || code === "") {
      const parent = itemL2 ?? itemL1;
      // Baris kode-KOSONG/rusak (mis. "#REF!" → terbaca kosong) yang punya NILAI
      // sendiri, sementara induk terdekat adalah ITEM BERHARGA (leaf, punya total),
      // itu line-item TERSENDIRI (mis. "Pengiriman"), BUKAN rincian anak. Jadikan
      // SIBLING di level yang sama supaya nilai induk tak hilang & tak menggelembungkan
      // anak (bug: total kurang sebesar nilai induk).
      if (code === "" && parent && parent.total_price != null) {
        const vol = num(cellVal(row, col.vol));
        const tot = num(cellVal(row, col.amount));
        if (tot == null && vol == null) return; // deskripsi lanjutan tanpa nilai → skip
        const it = mkItem(`~${++orphanSeq}`, name, row, null);
        (sub ? sub.items : cat.direct_items).push(it);
        itemL1 = it;
        itemL2 = null;
        return;
      }
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
      `${hiddenSkipped} baris tersembunyi (hidden) di Excel diabaikan – tidak masuk perhitungan (mengikuti resume kontrak).`,
    );

  // Jaring pengaman deteksi kolom: kalau >30% baris berharga gagal uji
  // volume × harga = jumlah, kemungkinan besar kolom nilai salah terbaca.
  if (crossChecked >= 20 && crossMismatch / crossChecked > 0.3)
    warnings.push(
      `PERHATIAN – ${crossMismatch} dari ${crossChecked} baris berharga tidak memenuhi "volume × harga satuan = jumlah" ` +
        `pada kolom ${colLetter(col.price)}/${colLetter(col.amount)} (${priceColumn.label}). ` +
        `Kemungkinan kolom nilai salah terdeteksi – periksa header file sebelum melanjutkan.`,
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

  return { parsed, warnings, priceColumn };
}
