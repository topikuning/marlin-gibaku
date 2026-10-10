import JSZip from "jszip";
import { alamat, bacaAlamat, kolomKeAngka, angkaKeKolom } from "./rumus";

/**
 * PEMBACA XLSX RINGAN untuk pelacak rincian.
 *
 * Kenapa bukan ExcelJS: pelacak melompat-lompat antar 20–40 sheet (RAB →
 * backup volume → Resume Analisa → ANALISA → Bahan & Upah). Dengan ExcelJS
 * satu berkas KKP 3 MB butuh 142 detik dan 1,3 GB heap – kontainer produksi
 * mati jauh sebelum itu (DECISIONS 297). Pelacak cuma butuh nilai tersimpan
 * dan teks rumus tiap sel, jadi XML sheet dibaca langsung ke peta ringkas,
 * sekali per sheet, dan hanya sheet yang dirujuk yang dibuka.
 *
 * Rumus bersama (`<f t="shared">`) diterjemahkan sendiri: sel anak hanya
 * membawa nomor kelompok, teksnya milik sel induk yang harus digeser sejauh
 * selisih baris/kolom – sama seperti yang dilakukan Excel.
 */

export type SelRingan = { v: number | string | null; f: string | null };
export type InfoSheet = { nama: string; tersembunyi: boolean };

export class SheetRingan {
  constructor(
    readonly nama: string,
    readonly tersembunyi: boolean,
    private readonly baris: Map<number, Map<number, SelRingan>>,
  ) {}

  sel(c: number, r: number): SelRingan | undefined {
    return this.baris.get(r)?.get(c);
  }

  /** Sel terisi di satu baris, urut kolom. */
  isiBaris(r: number): [number, SelRingan][] {
    const m = this.baris.get(r);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }

  /** Nomor baris yang berisi, urut naik. */
  nomorBaris(): number[] {
    return [...this.baris.keys()].sort((a, b) => a - b);
  }

  get jumlahBaris(): number {
    return this.baris.size;
  }
}

function lepas(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function teksT(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] != null ? lepas(m[1]) : "";
  return out;
}

/** Geser rujukan RELATIF dalam rumus sejauh (dr, dc) – terjemahan rumus bersama. */
export function geserRumus(rumus: string, dr: number, dc: number): string {
  if (dr === 0 && dc === 0) return rumus;
  // Bagian dalam tanda kutip ganda tidak disentuh.
  return rumus
    .split(/("(?:[^"]|"")*")/)
    .map((bagian, i) =>
      i % 2 === 1
        ? bagian
        : bagian.replace(
            /((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(!])/g,
            (cocok, sheet: string | undefined, dk: string, kol: string, db: string, brs: string, pos: number, semua: string) => {
              const sebelum = semua[pos - 1];
              if (!sheet && sebelum && /[\w.]/.test(sebelum)) return cocok;
              const c = dk ? kolomKeAngka(kol) : kolomKeAngka(kol) + dc;
              const r = db ? Number(brs) : Number(brs) + dr;
              if (c < 1 || r < 1) return cocok;
              return `${sheet ?? ""}${dk}${angkaKeKolom(c)}${db}${r}`;
            },
          ),
    )
    .join("");
}

export class BukuRingan {
  private readonly cache = new Map<string, SheetRingan | null>();
  private shared: string[] | null = null;

  private constructor(
    private readonly zip: JSZip,
    readonly daftar: (InfoSheet & { path: string | null })[],
  ) {}

  static async buka(buf: Buffer | ArrayBuffer): Promise<BukuRingan> {
    const zip = await JSZip.loadAsync(buf);
    const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
    const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
    const target = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`.replace(/xl\/\.\.\//, ""));
    }
    const daftar: (InfoSheet & { path: string | null })[] = [];
    // Bentuk elemen sama longgarnya dengan pembaca daftar sheet impor
    // (`<sheet …></sheet>` juga sah) – DECISIONS 664.
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const nama = lepas(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
      const rid = /\b[A-Za-z_][\w.-]*:id="([^"]*)"/.exec(m[0])?.[1] ?? "";
      const state = /\bstate="([^"]*)"/.exec(m[0])?.[1] ?? "visible";
      daftar.push({ nama, tersembunyi: state !== "visible", path: target.get(rid) ?? null });
    }
    return new BukuRingan(zip, daftar);
  }

  cari(nama: string): InfoSheet | null {
    const t = nama.trim().toLowerCase();
    const s = this.daftar.find((x) => x.nama === nama) ?? this.daftar.find((x) => x.nama.trim().toLowerCase() === t);
    return s ? { nama: s.nama, tersembunyi: s.tersembunyi } : null;
  }

  private async sharedStrings(): Promise<string[]> {
    if (this.shared) return this.shared;
    const xml = (await this.zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
    this.shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => teksT(m[1]!));
    return this.shared;
  }

  async muat(nama: string): Promise<SheetRingan | null> {
    const info = this.daftar.find((x) => x.nama === nama) ?? this.daftar.find((x) => x.nama.trim().toLowerCase() === nama.trim().toLowerCase());
    if (!info?.path) return null;
    if (this.cache.has(info.nama)) return this.cache.get(info.nama)!;
    let hasil: SheetRingan | null = null;
    try {
      const xml = await this.zip.file(info.path)?.async("string");
      if (xml) hasil = new SheetRingan(info.nama, info.tersembunyi, await this.urai(xml));
    } catch {
      hasil = null;
    }
    this.cache.set(info.nama, hasil);
    return hasil;
  }

  private async urai(xml: string): Promise<Map<number, Map<number, SelRingan>>> {
    const ss = await this.sharedStrings();
    const peta = new Map<number, Map<number, SelRingan>>();
    const induk = new Map<string, { f: string; c: number; r: number }>();
    const anak: { c: number; r: number; si: string }[] = [];
    const awalData = xml.indexOf("<sheetData");
    const data = awalData >= 0 ? xml.slice(awalData) : xml;
    for (const m of data.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atr = m[1]!;
      const isi = m[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(atr)?.[1];
      const a = ref ? bacaAlamat(ref) : null;
      if (!a) continue;
      const t = /\bt="([^"]*)"/.exec(atr)?.[1] ?? "n";
      const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(isi);
      let f: string | null = null;
      if (fm) {
        const fa = fm[1] ?? "";
        const teks = fm[2] != null ? lepas(fm[2]) : null;
        const si = /\bsi="(\d+)"/.exec(fa)?.[1];
        if (/\bt="shared"/.test(fa) && si != null) {
          if (teks && teks.trim() !== "") {
            induk.set(si, { f: teks, c: a.c, r: a.r });
            f = teks;
          } else anak.push({ c: a.c, r: a.r, si });
        } else if (teks) f = teks;
      }
      const vRaw = /<v>([\s\S]*?)<\/v>/.exec(isi)?.[1];
      let v: number | string | null = null;
      if (t === "s" && vRaw != null) v = ss[Number(vRaw)] ?? null;
      else if (t === "inlineStr") v = teksT(isi);
      else if (t === "str" || t === "e") v = vRaw != null ? lepas(vRaw) : null;
      else if (t === "b") v = vRaw === "1" ? "TRUE" : "FALSE";
      else if (vRaw != null) {
        const n = Number(vRaw);
        v = Number.isFinite(n) ? n : null;
      }
      if (typeof v === "string" && v.trim() === "") v = null;
      if (v == null && f == null && !fm) continue;
      let baris = peta.get(a.r);
      if (!baris) peta.set(a.r, (baris = new Map()));
      baris.set(a.c, { v, f });
    }
    for (const x of anak) {
      const i = induk.get(x.si);
      if (!i) continue;
      const sel = peta.get(x.r)?.get(x.c);
      if (sel) sel.f = geserRumus(i.f, x.r - i.r, x.c - i.c);
    }
    return peta;
  }
}

export { alamat };
