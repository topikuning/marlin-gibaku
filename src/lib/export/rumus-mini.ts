/**
 * RUMUS EXCEL MINI – hitung dan geser (DECISIONS 741).
 *
 * Murni dan tanpa I/O. Dipakai ekspor RAB/CCO bertaut untuk dua hal:
 *
 * 1. MEMBUKTIKAN sebelum menulis. Rumus asli berkas (backup volume) hanya
 *    ditulis ulang ke Excel MARLIN bila – setelah digeser ke letak barunya –
 *    menghasilkan angka yang SAMA dengan nilai yang tersimpan. Kalau tidak bisa
 *    dihitung atau hasilnya beda, yang ditulis angkanya (ketetapan user
 *    2026-11-05: "tautkan bila cocok").
 * 2. Uji: menghitung ulang seluruh workbook hasil ekspor untuk membuktikan
 *    totalnya sama dengan angka resmi MARLIN.
 *
 * Yang dikenali hanya bentuk yang memang dipakai berkas RAB KKP: angka,
 * rujukan sel/rentang (boleh nama sheet, boleh `$`), + − × ÷ ^ %, kurung, dan
 * fungsi SUM, PRODUCT, MIN, MAX, ABS, INT, ROUND, ROUNDUP, ROUNDDOWN. Yang lain
 * (teks, perbandingan, IF, VLOOKUP, nama terdefinisi) → `null`: tidak bisa
 * dibuktikan, jadi tidak dipakai. Menebak lebih berbahaya daripada menulis
 * angka.
 */

import { angkaKeKolom, kolomKeAngka } from "@/lib/rab/rincian/rumus";

export type NilaiSel = number | string | null | undefined;
/** Nilai satu sel: `sheet` null = sheet yang sama dengan pemilik rumus. */
export type AmbilSel = (sheet: string | null, c: number, r: number) => NilaiSel;

type Ref = { sheet: string | null; c1: number; r1: number; c2: number; r2: number; rentang: boolean };
type Token =
  | { t: "angka"; v: number }
  | { t: "ref"; ref: Ref; teks: string }
  | { t: "fungsi"; nama: string }
  | { t: "op"; v: string }
  | { t: "kurung"; v: "(" | ")" }
  | { t: "koma" };

const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!`;
const SEL = String.raw`\$?([A-Za-z]{1,3})\$?(\d+)`;
const POLA_REF = new RegExp(String.raw`^(?:${SHEET})?${SEL}(?::${SEL})?`);

/** Pecah rumus menjadi token. `null` bila ada bagian yang tidak dikenali. */
function tokenisasi(rumus: string): Token[] | null {
  const s = rumus.trim().replace(/^=/, "");
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const sisa = s.slice(i);
    const angka = /^(\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(sisa);
    // Angka – tapi bukan awal alamat sel (alamat selalu diawali huruf).
    if (angka) {
      out.push({ t: "angka", v: Number(angka[0]) });
      i += angka[0].length;
      continue;
    }
    // Nama diikuti "(" selalu fungsi: rujukan sel tidak pernah diikuti kurung.
    const fungsi = /^([A-Za-z_][A-Za-z0-9._]*)\s*\(/.exec(sisa);
    if (fungsi) {
      out.push({ t: "fungsi", nama: fungsi[1]!.toUpperCase() });
      out.push({ t: "kurung", v: "(" });
      i += fungsi[0].length;
      continue;
    }
    const ref = POLA_REF.exec(sisa);
    if (ref) {
      const sesudah = sisa[ref[0].length];
      // "LOG10(" dll. sudah tertangkap sebagai fungsi; nama lain yang menempel
      // huruf/angka bukan rujukan.
      if (sesudah && /[\w(!]/.test(sesudah)) return null;
      const sheet = ref[1] != null ? ref[1].replace(/''/g, "'") : (ref[2] ?? null);
      const c1 = kolomKeAngka(ref[3]!);
      const r1 = Number(ref[4]);
      const c2 = ref[5] ? kolomKeAngka(ref[5]) : c1;
      const r2 = ref[6] ? Number(ref[6]) : r1;
      out.push({
        t: "ref",
        teks: ref[0],
        ref: { sheet, c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2), rentang: ref[5] != null },
      });
      i += ref[0].length;
      continue;
    }
    if ("+-*/^%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      out.push({ t: "kurung", v: ch });
      i++;
      continue;
    }
    if (ch === "," || ch === ";") {
      out.push({ t: "koma" });
      i++;
      continue;
    }
    return null; // teks, perbandingan, &, nama terdefinisi, dst.
  }
  return out;
}

/* ── Hitung ───────────────────────────────────────────────────────────────── */

class TakBisa extends Error {}

type Nilai = number | number[];

const FUNGSI: Record<string, (args: Nilai[]) => number> = {
  SUM: (a) => rata(a).reduce((x, y) => x + y, 0),
  PRODUCT: (a) => rata(a).reduce((x, y) => x * y, 1),
  MIN: (a) => Math.min(...rata(a)),
  MAX: (a) => Math.max(...rata(a)),
  ABS: (a) => Math.abs(tunggal(a, 1)[0]!),
  INT: (a) => Math.floor(tunggal(a, 1)[0]!),
  ROUND: (a) => bulat(tunggal(a, 2), "dekat"),
  ROUNDUP: (a) => bulat(tunggal(a, 2), "atas"),
  ROUNDDOWN: (a) => bulat(tunggal(a, 2), "bawah"),
};

function rata(a: Nilai[]): number[] {
  return a.flatMap((x) => (Array.isArray(x) ? x : [x]));
}
function tunggal(a: Nilai[], n: number): number[] {
  if (a.length !== n || a.some(Array.isArray)) throw new TakBisa();
  return a as number[];
}
/** Pembulatan ala Excel: setengah menjauhi nol; digit negatif = puluhan/ratusan. */
function bulat([x, d]: number[], arah: "dekat" | "atas" | "bawah"): number {
  const f = 10 ** Math.trunc(d!);
  const v = Math.abs(x!) * f;
  // Koreksi galat biner (2.675 × 100 = 267.49999…) sebelum membulatkan.
  const v2 = Number(v.toPrecision(15));
  const r = arah === "dekat" ? Math.round(v2) : arah === "atas" ? Math.ceil(v2) : Math.floor(v2);
  return (Math.sign(x!) * r) / f;
}

function nilaiAngka(v: NilaiSel, dalamRentang: boolean): number | null {
  if (v == null || v === "") return dalamRentang ? null : 0; // sel kosong = 0
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (dalamRentang) return null; // SUM melewati teks
  throw new TakBisa(); // teks dalam aritmetika = #VALUE!
}

/**
 * Hitung rumus. `null` bila ada bagian yang tidak dikenali, merujuk teks
 * dalam aritmetika, atau membagi dengan nol – keadaan yang tidak bisa
 * dibuktikan.
 */
export function hitungRumus(rumus: string, ambil: AmbilSel): number | null {
  const tok = tokenisasi(rumus);
  if (!tok || tok.length === 0) return null;
  let p = 0;
  const lihat = () => tok[p];
  const ambilTok = () => tok[p++];

  const sel = (ref: Ref): Nilai => {
    if (!ref.rentang && ref.c1 === ref.c2 && ref.r1 === ref.r2) {
      const v = nilaiAngka(ambil(ref.sheet, ref.c1, ref.r1), false);
      return v ?? 0;
    }
    const isi: number[] = [];
    for (let r = ref.r1; r <= ref.r2; r++)
      for (let c = ref.c1; c <= ref.c2; c++) {
        const v = nilaiAngka(ambil(ref.sheet, c, r), true);
        if (v != null) isi.push(v);
      }
    return isi;
  };

  const skalar = (v: Nilai): number => {
    if (Array.isArray(v)) throw new TakBisa();
    return v;
  };

  const primer = (): Nilai => {
    const t = ambilTok();
    if (!t) throw new TakBisa();
    if (t.t === "angka") return t.v;
    if (t.t === "ref") return sel(t.ref);
    if (t.t === "kurung" && t.v === "(") {
      const v = ekspresi();
      const tutup = ambilTok();
      if (!tutup || tutup.t !== "kurung" || tutup.v !== ")") throw new TakBisa();
      return v;
    }
    if (t.t === "fungsi") {
      const f = FUNGSI[t.nama];
      if (!f) throw new TakBisa();
      ambilTok(); // "("
      const args: Nilai[] = [];
      if (!(lihat()?.t === "kurung" && (lihat() as { v: string }).v === ")")) {
        args.push(ekspresi());
        while (lihat()?.t === "koma") {
          ambilTok();
          args.push(ekspresi());
        }
      }
      const tutup = ambilTok();
      if (!tutup || tutup.t !== "kurung" || tutup.v !== ")") throw new TakBisa();
      return f(args);
    }
    throw new TakBisa();
  };
  const persen = (): Nilai => {
    let v = primer();
    while (lihat()?.t === "op" && (lihat() as { v: string }).v === "%") {
      ambilTok();
      v = skalar(v) / 100;
    }
    return v;
  };
  const unari = (): Nilai => {
    const t = lihat();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      ambilTok();
      const v = skalar(unari());
      return t.v === "-" ? -v : v;
    }
    return persen();
  };
  const pangkat = (): Nilai => {
    let v = unari();
    while (lihat()?.t === "op" && (lihat() as { v: string }).v === "^") {
      ambilTok();
      v = skalar(v) ** skalar(unari());
    }
    return v;
  };
  const suku = (): Nilai => {
    let v = pangkat();
    for (;;) {
      const t = lihat();
      if (t?.t !== "op" || (t.v !== "*" && t.v !== "/")) return v;
      ambilTok();
      const b = skalar(pangkat());
      if (t.v === "/") {
        if (b === 0) throw new TakBisa();
        v = skalar(v) / b;
      } else v = skalar(v) * b;
    }
  };
  const ekspresi = (): Nilai => {
    let v = suku();
    for (;;) {
      const t = lihat();
      if (t?.t !== "op" || (t.v !== "+" && t.v !== "-")) return v;
      ambilTok();
      const b = skalar(suku());
      v = t.v === "+" ? skalar(v) + b : skalar(v) - b;
    }
  };

  try {
    const v = ekspresi();
    if (p !== tok.length) return null;
    const n = skalar(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/* ── Geser ────────────────────────────────────────────────────────────────── */

/** Letak baru satu sel; `null` = sel itu tidak ikut ditulis. */
export type PetaSel = (sheet: string | null, c: number, r: number) => { sheet: string | null; c: number; r: number } | null;

const kutipSheet = (s: string) => (/^[A-Za-z_][\w.]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`);

/**
 * Tulis ulang rujukan rumus ke letak barunya. Rentang hanya boleh digeser
 * UTUH: setiap sel di dalamnya harus berpindah dengan jarak yang sama, supaya
 * `SUM(M80:M94)` tetap menjumlah sel yang sama. Bila tidak, `null`.
 */
export function geserRumus(rumus: string, peta: PetaSel): string | null {
  const tok = tokenisasi(rumus);
  if (!tok) return null;
  const bagian: string[] = [];
  for (const t of tok) {
    if (t.t === "angka") bagian.push(String(t.v));
    else if (t.t === "op") bagian.push(t.v);
    else if (t.t === "kurung") bagian.push(t.v);
    else if (t.t === "koma") bagian.push(",");
    else if (t.t === "fungsi") bagian.push(t.nama);
    else {
      const { sheet, c1, r1, c2, r2, rentang } = t.ref;
      const a = peta(sheet, c1, r1);
      if (!a) return null;
      const dc = a.c - c1;
      const dr = a.r - r1;
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const b = peta(sheet, c, r);
          if (!b || b.sheet !== a.sheet || b.c - c !== dc || b.r - r !== dr) return null;
        }
      const awalan = a.sheet ? `${kutipSheet(a.sheet)}!` : "";
      const satu = `${angkaKeKolom(a.c)}${a.r}`;
      bagian.push(
        rentang || c1 !== c2 || r1 !== r2 ? `${awalan}${satu}:${angkaKeKolom(c2 + dc)}${r2 + dr}` : `${awalan}${satu}`,
      );
    }
  }
  // Fungsi selalu diikuti "(" token tersendiri – gabungkan tanpa spasi.
  return bagian.join("");
}
