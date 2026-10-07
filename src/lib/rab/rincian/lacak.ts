import type { BukuRingan, SheetRingan } from "./xlsx-ringan";
import { uraiAnalisa, type UraiAnalisa } from "./analisa";
import { alamat, angkaKeKolom, bacaAlamat, rujukanDalam, rujukanTunggal, type Rujukan } from "./rumus";

/**
 * PELACAK RINCIAN: dari sel volume / harga satuan di sheet RAB ke sheet yang
 * menjadi dasarnya (backup volume, Resume Analisa → ANALISA → Bahan & Upah).
 *
 * ### Kenapa lewat rumus, bukan nama
 *
 * Di berkas KKP, kolom volume sheet RAB berisi rumus yang menunjuk langsung ke
 * sel di sheet backup volume (`='7. Vol Kios 3x4'!M14`), dan kolom harga
 * satuan menunjuk ke Resume Analisa yang menunjuk ke ANALISA. Rantai itu
 * DITULIS penyusunnya sendiri. Mencocokkan lewat nama item akan menebak hal
 * yang sudah pasti, dan salah pada nama yang sama di bangunan berbeda.
 *
 * Item yang volumenya diketik langsung, atau rumusnya tidak menunjuk sheet
 * lain, TIDAK dicarikan pasangan: statusnya dikatakan apa adanya.
 *
 * ### Batas
 *
 * - Sel penerus (`='Resume Analisa'!D6`) dilompati sampai 6 kali.
 * - Rincian = baris-baris yang menyumbang ke sel ujung, ditelusuri lewat rumus
 *   di sheet yang sama, paling banyak `MAKS_SEL` sel dan `MAKS_BARIS` baris.
 *   Lebih dari itu ditandai `terpotong`, tidak didiamkan.
 * - Kolom dibaca sampai `MAKS_KOLOM`: ada sheet yang `columnCount`-nya 16.384
 *   karena satu sel nyasar di kolom XFD.
 */
const MAKS_LOMPAT = 6;
const MAKS_SEL = 800;
const MAKS_BARIS = 80;
const MAKS_KOLOM = 40;
const MAKS_RENTANG = 400;

export type SelBerkas = { kolom: number; huruf: string; nilai: number | string | null; rumus: string | null };
export type BarisBerkas = { sheet: string; baris: number; sel: SelBerkas[] };
export type TitikSel = { sheet: string; sel: string; tersembunyi: boolean; nilai: number | null };

export type StatusJejak =
  /** Rumus sel RAB menunjuk sheet lain dan rinciannya terbaca. */
  | "tertaut"
  /** Sel RAB berisi angka yang diketik (atau rumus konstanta, mis. `=5*10`). */
  | "angka_langsung"
  /** Sel RAB kosong. */
  | "kosong"
  /** Rumus menunjuk sheet yang tidak ada / tidak bisa dibaca, atau nama terdefinisi. */
  | "tidak_terbaca";

export type JejakSel = {
  status: StatusJejak;
  nilaiRab: number | null;
  rumusRab: string | null;
  /** Sel ujung yang menyimpan rincian. */
  sumber: TitikSel[];
  /** Sel penerus yang dilompati (mis. baris Resume Analisa). */
  perantara: TitikSel[];
  /** Baris rincian di sheet ujung, urut sheet lalu baris. */
  baris: BarisBerkas[];
  /** Rujukan dari baris rincian ke sheet lain (mis. harga di Bahan & Upah). */
  rujukanLuar: TitikSel[];
  terpotong: boolean;
  catatan: string | null;
};

export type Kepala = Record<number, string>;

/* ── baca sel ─────────────────────────────────────────────────────────── */

const nilaiSel = (ws: SheetRingan, c: number, r: number) => ws.sel(c, r)?.v ?? null;
const rumusSel = (ws: SheetRingan, c: number, r: number) => {
  const f = ws.sel(c, r)?.f;
  return f != null && f.trim() !== "" ? f : null;
};

export function angka(v: number | string | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bacaBaris(ws: SheetRingan, sheet: string, r: number): BarisBerkas {
  const sel: SelBerkas[] = [];
  for (const [c, x] of ws.isiBaris(r)) {
    if (c > MAKS_KOLOM) break;
    const rumus = x.f != null && x.f.trim() !== "" ? x.f : null;
    if (x.v == null && rumus == null) continue;
    sel.push({ kolom: c, huruf: angkaKeKolom(c), nilai: x.v, rumus });
  }
  return { sheet, baris: r, sel };
}

/** Baris judul kolom terdekat di atas `sebelum` (mis. NO | JENIS PEKERJAAN | PANJANG | …). */
export function kepalaSheet(ws: SheetRingan, sebelum: number): Kepala {
  const KATA = /\b(vol|volume|sat|satuan|panjang|lebar|tinggi|jumlah|uraian|jenis|koef|harga|kode|unit|sisi|bj)\b/i;
  for (let r = sebelum - 1; r >= Math.max(1, sebelum - 120); r--) {
    const teks: Kepala = {};
    let n = 0;
    let cocok = false;
    for (const [c, x] of ws.isiBaris(r)) {
      if (c > MAKS_KOLOM) break;
      if (typeof x.v === "string" && x.f == null) {
        teks[c] = x.v.trim();
        n++;
        if (KATA.test(x.v)) cocok = true;
      }
    }
    if (n >= 3 && cocok) return teks;
  }
  return {};
}

/* ── pelacak ──────────────────────────────────────────────────────────── */

type Ujung = {
  sumber: TitikSel;
  perantara: TitikSel[];
  baris: BarisBerkas[];
  rujukanLuar: TitikSel[];
  terpotong: boolean;
  catatan: string | null;
};

export class Pelacak {
  private readonly memo = new Map<string, Ujung | null>();
  readonly kepala = new Map<string, Kepala>();
  /** Sheet tersembunyi yang ikut dibaca karena dirujuk – disebut di pratinjau. */
  readonly tersembunyiDibaca = new Set<string>();

  constructor(private readonly buku: BukuRingan) {}

  /**
   * Jejak satu sel di sheet RAB. Rujukan ke sel lain di sheet RAB sendiri
   * diikuti sampai 3 langkah (mis. volume item = baris rincian di bawahnya),
   * rujukan ke sheet lain menjadi titik awal pelacakan.
   */
  async lacak(sheetRab: string, kolom: number, baris: number): Promise<JejakSel> {
    const kosong: JejakSel = {
      status: "kosong",
      nilaiRab: null,
      rumusRab: null,
      sumber: [],
      perantara: [],
      baris: [],
      rujukanLuar: [],
      terpotong: false,
      catatan: null,
    };
    const ws = await this.buku.muat(sheetRab);
    if (!ws) return { ...kosong, status: "tidak_terbaca", catatan: `Sheet "${sheetRab}" tidak bisa dibaca.` };
    const nilaiRab = angka(nilaiSel(ws, kolom, baris));
    const rumusRab = rumusSel(ws, kolom, baris);
    if (rumusRab == null) return { ...kosong, status: nilaiRab == null ? "kosong" : "angka_langsung", nilaiRab };

    // Kumpulkan titik awal di sheet lain.
    const awal: { sheet: string; c: number; r: number }[] = [];
    const dilihat = new Set<string>();
    const antre: { f: string; d: number }[] = [{ f: rumusRab, d: 0 }];
    let rumusNama = false;
    while (antre.length > 0 && dilihat.size < 60) {
      const { f, d } = antre.shift()!;
      const refs = rujukanDalam(f);
      if (refs.length === 0 && /\b[A-Za-z_][\w.]*\b(?!\s*[(!])/.test(f.replace(/"(?:[^"]|"")*"/g, "").replace(/\b(TRUE|FALSE)\b/gi, "")))
        rumusNama = true;
      for (const ref of refs) {
        const lain = ref.sheet != null && ref.sheet.trim().toLowerCase() !== sheetRab.trim().toLowerCase();
        for (const [c, r] of selDalam(ref)) {
          if (lain) {
            awal.push({ sheet: ref.sheet!, c, r });
            continue;
          }
          const k = alamat(c, r);
          if (dilihat.has(k) || d >= 3) continue;
          dilihat.add(k);
          const f2 = rumusSel(ws, c, r);
          if (f2) antre.push({ f: f2, d: d + 1 });
        }
      }
    }
    if (awal.length === 0) {
      // `[1]RAB!I78` = rujukan ke BERKAS EXCEL LAIN (tautan eksternal). Nilai
      // terakhirnya tersimpan, tetapi rinciannya ada di berkas yang tidak
      // diunggah – disebut begitu, bukan dikira nama terdefinisi.
      const luar = /\[\d+\]/.test(rumusRab);
      return {
        ...kosong,
        status: rumusNama || luar ? "tidak_terbaca" : "angka_langsung",
        nilaiRab,
        rumusRab,
        catatan: luar
          ? "Rumusnya menunjuk berkas Excel lain yang tidak ikut diunggah – rinciannya tidak bisa dibaca."
          : rumusNama
            ? "Rumusnya memakai nama terdefinisi, bukan alamat sel – tidak diikuti."
            : null,
      };
    }

    const hasil: JejakSel = { ...kosong, status: "tertaut", nilaiRab, rumusRab };
    const sudahBaris = new Set<string>();
    for (const a of awal.slice(0, 40)) {
      const u = await this.ujung(a.sheet, a.c, a.r);
      if (!u) {
        hasil.status = "tidak_terbaca";
        hasil.catatan = `Rumus menunjuk sheet "${a.sheet}" yang tidak ada atau tidak bisa dibaca.`;
        continue;
      }
      hasil.sumber.push(u.sumber);
      hasil.perantara.push(...u.perantara);
      for (const b of u.baris) {
        const k = `${b.sheet}!${b.baris}`;
        if (sudahBaris.has(k)) continue;
        sudahBaris.add(k);
        hasil.baris.push(b);
      }
      hasil.rujukanLuar.push(...u.rujukanLuar);
      hasil.terpotong ||= u.terpotong;
      hasil.catatan ??= u.catatan;
    }
    if (awal.length > 40) {
      hasil.terpotong = true;
      hasil.catatan ??= `Rumus menunjuk ${awal.length} sel di sheet lain; 40 yang pertama dibaca.`;
    }
    return hasil;
  }

  /** Sel ujung + baris rinciannya; hasilnya diingat per sel. */
  async ujung(sheet: string, c: number, r: number): Promise<Ujung | null> {
    const kunci = `${sheet}!${alamat(c, r)}`;
    if (this.memo.has(kunci)) return this.memo.get(kunci)!;
    const hasil = await this.ujungBaru(sheet, c, r);
    this.memo.set(kunci, hasil);
    return hasil;
  }

  private async ujungBaru(sheetAwal: string, c0: number, r0: number): Promise<Ujung | null> {
    let sheet = sheetAwal;
    let c = c0;
    let r = r0;
    const perantara: TitikSel[] = [];
    let ws: SheetRingan | null = null;
    for (let lompat = 0; ; lompat++) {
      const info = this.buku.cari(sheet);
      if (!info) return null;
      sheet = info.nama;
      ws = await this.buku.muat(sheet);
      if (!ws) return null;
      if (info.tersembunyi) this.tersembunyiDibaca.add(sheet);
      const f = rumusSel(ws, c, r);
      const tunggal = f ? rujukanTunggal(f) : null;
      if (!tunggal || lompat >= MAKS_LOMPAT) break;
      perantara.push({ sheet, sel: alamat(c, r), tersembunyi: info.tersembunyi, nilai: angka(nilaiSel(ws, c, r)) });
      sheet = tunggal.sheet ?? sheet;
      c = tunggal.c1;
      r = tunggal.r1;
    }

    // Telusuri sel penyumbang di sheet yang sama.
    const terlihat = new Set<string>();
    const barisSet = new Set<number>([r]);
    const luar: TitikSel[] = [];
    const antre: [number, number][] = [[c, r]];
    let terpotong = false;
    while (antre.length > 0) {
      const [cc, rr] = antre.shift()!;
      const k = alamat(cc, rr);
      if (terlihat.has(k)) continue;
      if (terlihat.size >= MAKS_SEL) {
        terpotong = true;
        break;
      }
      terlihat.add(k);
      const f = rumusSel(ws, cc, rr);
      if (nilaiSel(ws, cc, rr) != null || f != null) barisSet.add(rr);
      if (!f) continue;
      for (const ref of rujukanDalam(f)) {
        const lain = ref.sheet != null && ref.sheet.trim().toLowerCase() !== sheet.trim().toLowerCase();
        if (lain) {
          const t = this.buku.cari(ref.sheet!);
          for (const [lc, lr] of selDalam(ref).slice(0, 20)) {
            luar.push({ sheet: t?.nama ?? ref.sheet!, sel: alamat(lc, lr), tersembunyi: t?.tersembunyi ?? false, nilai: null });
          }
          continue;
        }
        const sel = selDalam(ref);
        if (sel.length > MAKS_RENTANG) terpotong = true;
        for (const [x, y] of sel.slice(0, MAKS_RENTANG)) antre.push([x, y]);
      }
    }

    let daftarBaris = [...barisSet].sort((a, b) => a - b);
    if (daftarBaris.length > MAKS_BARIS) {
      terpotong = true;
      // Yang dipertahankan: baris terdekat dengan sel ujung.
      daftarBaris = daftarBaris
        .sort((a, b) => Math.abs(a - r) - Math.abs(b - r))
        .slice(0, MAKS_BARIS)
        .sort((a, b) => a - b);
    }
    if (!this.kepala.has(sheet)) this.kepala.set(sheet, kepalaSheet(ws!, daftarBaris[0] ?? r));
    const info = this.buku.cari(sheet)!;
    return {
      sumber: { sheet, sel: alamat(c, r), tersembunyi: info.tersembunyi, nilai: angka(nilaiSel(ws, c, r)) },
      perantara,
      baris: daftarBaris.map((b) => bacaBaris(ws!, sheet, b)),
      rujukanLuar: luar,
      terpotong,
      catatan: terpotong ? `Rincian di sheet "${sheet}" lebih panjang dari yang disimpan; yang disimpan baris terdekat.` : null,
    };
  }
}

export type BlokAnalisa = UraiAnalisa & {
  sheet: string;
  barisAwal: number;
  barisAkhir: number;
  tersembunyi: boolean;
  /** Baris Resume Analisa (atau penerus lain) yang menunjuk blok ini. */
  perantara: TitikSel[];
  baris: BarisBerkas[];
  /** Harga satuan pekerjaan menurut analisa (sel yang dirujuk kolom nilai Resume). */
  hargaSatuan: number | null;
  catatan: string | null;
};

const SHEET_ANALISA = /analisa|ahs\b|ahsp/i;
const BUKAN_JALUR = /vol|back\s*-?\s*up|resume|rekap/i;
const MAKS_BLOK = 200;

export type HargaDasar = {
  sheet: string;
  baris: number;
  sel: string;
  tersembunyi: boolean;
  nama: string | null;
  satuan: string | null;
  harga: number | null;
};

export class PelacakAnalisa {
  private readonly memo = new Map<string, BlokAnalisa | null>();
  /** Bahan & upah yang DIPAKAI analisa, kunci `sheet!sel`. */
  readonly hargaDasar = new Map<string, HargaDasar>();

  constructor(
    private readonly buku: BukuRingan,
    private readonly pelacak: Pelacak,
  ) {}

  /**
   * Blok analisa milik item di `baris` sheet RAB.
   *
   * Tautannya dicari dari rumus di BARIS item itu (kolom mana pun – di berkas
   * MC-0 tautannya ada di kolom NILAI TKDN, sedangkan harga satuannya
   * diketik), lalu, bila baris itu meneruskan ke salinan RAB lain (RABX),
   * dari baris salinan itu. Yang dicari: rujukan ke sheet bernama
   * analisa (Resume Analisa / ANALISA).
   */
  async untukBaris(sheetRab: string, baris: number): Promise<BlokAnalisa | null> {
    type Titik = { sheet: string; r: number; c: number };
    const kandidat: Titik[] = [];
    const dilihat = new Set<string>();
    let lapis: { sheet: string; r: number }[] = [{ sheet: sheetRab, r: baris }];
    for (let d = 0; d < 3 && kandidat.length === 0 && lapis.length > 0; d++) {
      const berikut: { sheet: string; r: number }[] = [];
      for (const t of lapis) {
        const k = `${t.sheet}!${t.r}`;
        if (dilihat.has(k)) continue;
        dilihat.add(k);
        const ws = await this.buku.muat(t.sheet);
        if (!ws) continue;
        for (const [c, x] of ws.isiBaris(t.r)) {
          if (c > MAKS_KOLOM) break;
          const f = x.f;
          if (!f) continue;
          for (const ref of rujukanDalam(f)) {
            if (ref.sheet == null) continue;
            const info = this.buku.cari(ref.sheet);
            if (!info || info.nama === t.sheet) continue;
            if (SHEET_ANALISA.test(info.nama)) kandidat.push({ sheet: info.nama, r: ref.r1, c: ref.c1 });
            else if (!BUKAN_JALUR.test(info.nama)) berikut.push({ sheet: info.nama, r: ref.r1 });
          }
        }
      }
      lapis = berikut.slice(0, 10);
    }
    const pilih = kandidat[0];
    if (!pilih) return null;
    return this.blokDariResume(pilih);
  }

  /**
   * Harga satuan tiap baris Resume Analisa → baris itu. Dipakai HANYA untuk
   * item yang barisnya tidak menunjuk analisa lewat rumus (lihat `baca.ts`).
   */
  async indeksHargaResume(): Promise<Map<number, { sheet: string; r: number; c: number }[]>> {
    const indeks = new Map<number, { sheet: string; r: number; c: number }[]>();
    for (const info of this.buku.daftar) {
      if (!/resume/i.test(info.nama) || !SHEET_ANALISA.test(info.nama)) continue;
      const ws = await this.buku.muat(info.nama);
      if (!ws) continue;
      for (const r of ws.nomorBaris()) {
        let harga: number | null = null;
        let kolom = 0;
        let rujukan = 0;
        for (const [c, x] of ws.isiBaris(r)) {
          if (c > MAKS_KOLOM || !x.f) continue;
          const keAnalisa = rujukanDalam(x.f).some((ref) => ref.sheet != null && SHEET_ANALISA.test(ref.sheet));
          if (!keAnalisa) continue;
          rujukan++;
          const n = angka(x.v);
          if (n != null && n >= 1 && (harga == null || n > harga)) {
            harga = n;
            kolom = c;
          }
        }
        if (rujukan < 2 || harga == null) continue;
        const k = Math.round(harga * 100);
        const arr = indeks.get(k) ?? [];
        arr.push({ sheet: info.nama, r, c: kolom });
        indeks.set(k, arr);
      }
    }
    return indeks;
  }

  async blokDariResume(t: { sheet: string; r: number; c: number }): Promise<BlokAnalisa | null> {
    const kunci = `${t.sheet}!${t.r}`;
    if (this.memo.has(kunci)) return this.memo.get(kunci)!;
    const hasil = await this.blokDari(t);
    this.memo.set(kunci, hasil);
    return hasil;
  }

  private async blokDari(t: { sheet: string; r: number; c: number }): Promise<BlokAnalisa | null> {
    const ws = await this.buku.muat(t.sheet);
    if (!ws) return null;
    const infoT = this.buku.cari(t.sheet)!;
    // Baris penunjuk (mis. Resume Analisa): rujukannya ke sheet analisa lain
    // menentukan rentang blok – kode, uraian, harga, dan TKDN masing-masing
    // menunjuk baris berbeda dari blok yang sama.
    const keLain = new Map<string, { r: number; c: number; nilai: number | null }[]>();
    for (const [c, x] of ws.isiBaris(t.r)) {
      if (c > MAKS_KOLOM) break;
      const f = x.f;
      if (!f) continue;
      for (const ref of rujukanDalam(f)) {
        if (ref.sheet == null) continue;
        const info = this.buku.cari(ref.sheet);
        if (!info || info.nama === t.sheet || !SHEET_ANALISA.test(info.nama)) continue;
        const arr = keLain.get(info.nama) ?? [];
        arr.push({ r: ref.r1, c: ref.c1, nilai: angka(x.v) });
        keLain.set(info.nama, arr);
      }
    }
    let sheet = t.sheet;
    let awal: number;
    let akhir: number;
    let hargaSatuan: number | null = null;
    const perantara: TitikSel[] = [];
    let catatan: string | null = null;
    const terbanyak = [...keLain.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (terbanyak && terbanyak[1].length >= 2) {
      perantara.push({ sheet: t.sheet, sel: alamat(t.c, t.r), tersembunyi: infoT.tersembunyi, nilai: null });
      sheet = terbanyak[0];
      const rows = terbanyak[1].map((x) => x.r);
      awal = Math.min(...rows);
      akhir = Math.max(...rows);
      // Harga satuan = nilai terbesar yang dirujuk baris penunjuk (TKDN < 1, kode/uraian teks).
      hargaSatuan = terbanyak[1].map((x) => x.nilai).filter((n): n is number => n != null && n >= 1).sort((a, b) => b - a)[0] ?? null;
    } else {
      // Sheet analisa dirujuk langsung: blok = sel ujung + penyumbangnya.
      const u = await this.pelacak.ujung(t.sheet, t.c, t.r);
      if (!u || u.baris.length === 0) return null;
      sheet = u.sumber.sheet;
      const rows = u.baris.filter((b) => Math.abs(b.baris - t.r) <= MAKS_BLOK).map((b) => b.baris);
      awal = Math.min(...rows);
      akhir = Math.max(...rows);
      hargaSatuan = u.sumber.nilai;
      perantara.push(...u.perantara);
      // Judul blok biasanya satu baris di atas rincian pertama.
      awal = Math.max(1, awal - 1);
    }
    if (akhir - awal > MAKS_BLOK) {
      catatan = `Blok analisa di sheet "${sheet}" lebih dari ${MAKS_BLOK} baris; yang disimpan ${MAKS_BLOK} baris pertama.`;
      akhir = awal + MAKS_BLOK;
    }
    const wsBlok = await this.buku.muat(sheet);
    if (!wsBlok) return null;
    const info = this.buku.cari(sheet)!;
    if (info.tersembunyi) this.pelacak.tersembunyiDibaca.add(sheet);
    const baris: BarisBerkas[] = [];
    for (let r = awal; r <= akhir; r++) {
      const b = bacaBaris(wsBlok, sheet, r);
      if (b.sel.length > 0) baris.push(b);
    }
    const urai = uraiAnalisa(baris);
    for (const k of urai.komponen) {
      if (!k.rujukanHarga) continue;
      const kunci = `${k.rujukanHarga.sheet}!${k.rujukanHarga.sel}`;
      if (this.hargaDasar.has(kunci)) continue;
      const a = bacaAlamat(k.rujukanHarga.sel);
      const u = a ? await this.pelacak.ujung(k.rujukanHarga.sheet, a.c, a.r) : null;
      if (!u) continue;
      const ujungAlamat = bacaAlamat(u.sumber.sel)!;
      const brs = u.baris.find((b) => b.baris === ujungAlamat.r);
      // Nama = teks terdekat di KIRI sel harga; satuan = teks pendek terdekat di kanannya.
      // Bukan "teks terpanjang": kolom keterangan ("HSD Demak 2025 Surat Edaran …")
      // selalu lebih panjang dari nama bahannya.
      const teksSel = (brs?.sel ?? []).filter((x) => typeof x.nilai === "string" && String(x.nilai).trim().length > 0);
      const nama =
        teksSel
          .filter((x) => x.kolom < ujungAlamat.c && String(x.nilai).trim().length > 1)
          .map((x) => String(x.nilai).trim())
          .pop() ?? null;
      const satuan =
        teksSel
          .filter((x) => x.kolom > ujungAlamat.c)
          .map((x) => String(x.nilai).trim())
          .find((x) => x.length <= 12) ?? null;
      this.hargaDasar.set(kunci, {
        sheet: u.sumber.sheet,
        baris: ujungAlamat.r,
        sel: u.sumber.sel,
        tersembunyi: u.sumber.tersembunyi,
        nama,
        satuan,
        harga: u.sumber.nilai,
      });
    }
    return {
      ...urai,
      sheet,
      barisAwal: awal,
      barisAkhir: akhir,
      tersembunyi: info.tersembunyi,
      perantara,
      baris,
      hargaSatuan,
      catatan,
    };
  }
}

function selDalam(ref: Rujukan): [number, number][] {
  const out: [number, number][] = [];
  for (let r = ref.r1; r <= ref.r2; r++) {
    for (let c = ref.c1; c <= ref.c2; c++) {
      out.push([c, r]);
      if (out.length > MAKS_RENTANG) return out;
    }
  }
  return out;
}
