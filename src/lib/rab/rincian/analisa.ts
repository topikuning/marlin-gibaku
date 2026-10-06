import type { BarisBerkas, SelBerkas } from "./lacak";
import { alamat, rujukanDalam } from "./rumus";

/**
 * URAI SATU BLOK ANALISA menjadi komponen upah / bahan / alat.
 *
 * Murni: masukannya baris-baris blok yang sudah dibaca pelacak. Kolomnya
 * TIDAK diandaikan (D = koefisien, F = harga, …) karena tiap penyusun berbeda.
 * Yang dipakai adalah rumus blok itu sendiri: baris komponen menulis
 * `jumlah = koefisien × harga` (`=D7*F7` atau `=F35*D35`), jadi kolom
 * koefisien, harga, dan jumlah dibaca dari rumus perkalian yang paling sering
 * muncul di blok. Harga yang menunjuk sheet lain (Bahan & Upah) dicatat
 * sumbernya.
 *
 * Yang tidak bisa dipastikan dikembalikan apa adanya sebagai baris; kategori
 * yang tidak dikenali menjadi "lain", bukan ditebak.
 */
export type KategoriKomponen = "upah" | "bahan" | "alat" | "lain";

export type KomponenAnalisa = {
  baris: number;
  kategori: KategoriKomponen;
  nama: string;
  satuan: string | null;
  koefisien: number | null;
  harga: number | null;
  jumlah: number | null;
  /** Rujukan harga ke sheet lain, mis. `'Bahan & Upah'!C$336`. */
  rujukanHarga: { sheet: string; sel: string } | null;
};

export type UraiAnalisa = {
  kode: string | null;
  uraian: string | null;
  komponen: KomponenAnalisa[];
  /** Persen overhead & profit bila tertulis (0,15 = 15%). */
  overhead: number | null;
  kolom: { koefisien: number; harga: number; jumlah: number } | null;
};

const num = (v: SelBerkas["nilai"] | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const teks = (v: SelBerkas["nilai"] | undefined) => (typeof v === "string" ? v.trim() : "");

function kategoriDari(t: string): KategoriKomponen | "berhenti" | null {
  const s = t.toLowerCase();
  if (/overhead|profit|keuntungan|jumlah\s*\(|harga satuan pekerjaan|^jumlah$/.test(s)) return "berhenti";
  if (/\b(upah|tenaga)\b/.test(s)) return "upah";
  if (/\b(bahan|material)\b/.test(s)) return "bahan";
  if (/\b(alat|peralatan)\b/.test(s)) return "alat";
  return null;
}

/** Kolom (koef, harga, jumlah) dari rumus perkalian dua sel sebaris yang paling sering. */
function kolomDariRumus(baris: BarisBerkas[]): UraiAnalisa["kolom"] {
  const hitung = new Map<string, number>();
  for (const b of baris) {
    for (const s of b.sel) {
      if (!s.rumus) continue;
      const m = /^\s*=?\s*\(?\s*\$?([A-Z]{1,3})\$?(\d+)\s*\*\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)?\s*$/i.exec(s.rumus);
      if (!m || Number(m[2]) !== b.baris || Number(m[4]) !== b.baris) continue;
      const a = rujukanDalam(s.rumus);
      if (a.length !== 2) continue;
      const [x, y] = [a[0]!.c1, a[1]!.c1].sort((p, q) => p - q);
      const k = `${x},${y},${s.kolom}`;
      hitung.set(k, (hitung.get(k) ?? 0) + 1);
    }
  }
  let terbaik: string | null = null;
  for (const [k, n] of hitung) if (terbaik == null || n > hitung.get(terbaik)!) terbaik = k;
  if (!terbaik) return null;
  const [koefisien, harga, jumlah] = terbaik.split(",").map(Number) as [number, number, number];
  return { koefisien, harga, jumlah };
}

export function uraiAnalisa(baris: BarisBerkas[]): UraiAnalisa {
  const kolom = kolomDariRumus(baris);
  const pertama = baris[0];

  // Judul blok: teks terpanjang di baris pertama; kode = sel teks/angka pendek di kirinya.
  let uraian: string | null = null;
  let kode: string | null = null;
  if (pertama) {
    let kolUraian = 0;
    for (const s of pertama.sel) {
      const t = teks(s.nilai);
      if (t.length > (uraian?.length ?? 0)) {
        uraian = t;
        kolUraian = s.kolom;
      }
    }
    const kiri = pertama.sel.filter((s) => s.kolom < kolUraian && s.nilai != null).pop();
    if (kiri) {
      const t = typeof kiri.nilai === "number" ? String(kiri.nilai) : teks(kiri.nilai);
      if (t.length > 0 && t.length <= 30) kode = t;
    }
    if (uraian != null && uraian.length < 8) uraian = null;
  }

  const komponen: KomponenAnalisa[] = [];
  let overhead: number | null = null;
  let kategori: KategoriKomponen = "lain";
  for (const b of baris.slice(1)) {
    const byKol = new Map(b.sel.map((s) => [s.kolom, s]));
    // Baris judul kelompok ("A | Upah", "B | Bahan").
    const teksBaris = b.sel.map((s) => teks(s.nilai)).filter(Boolean);
    const adaAngka = b.sel.some((s) => num(s.nilai) != null);
    const kat = teksBaris.map(kategoriDari).find((k) => k != null) ?? null;
    if (kat === "berhenti") {
      if (/overhead|profit|keuntungan/i.test(teksBaris.join(" "))) {
        const p = b.sel.map((s) => num(s.nilai)).find((n) => n != null && n > 0 && n < 1);
        if (p != null) overhead = p;
      }
      continue;
    }
    if (kat && (!adaAngka || teksBaris.length <= 2) && !(kolom && num(byKol.get(kolom.koefisien)?.nilai) != null)) {
      kategori = kat;
      continue;
    }
    if (!kolom) continue;
    const koef = num(byKol.get(kolom.koefisien)?.nilai);
    if (koef == null) continue;
    const nama = b.sel
      .filter((s) => s.kolom < kolom.koefisien)
      .map((s) => teks(s.nilai))
      .filter((t) => t.length > 1)
      .shift();
    if (!nama) continue;
    const satuan =
      b.sel
        .filter((s) => s.kolom > kolom.koefisien && s.kolom < kolom.harga)
        .map((s) => teks(s.nilai))
        .find((t) => t.length > 0) ?? null;
    const selHarga = byKol.get(kolom.harga);
    const luar = selHarga?.rumus ? rujukanDalam(selHarga.rumus).find((r) => r.sheet != null) : undefined;
    komponen.push({
      baris: b.baris,
      kategori,
      nama,
      satuan,
      koefisien: koef,
      harga: num(selHarga?.nilai),
      jumlah: num(byKol.get(kolom.jumlah)?.nilai),
      rujukanHarga: luar
        ? { sheet: luar.sheet!, sel: alamat(luar.c1, luar.r1) }
        : null,
    });
  }
  return { kode, uraian, komponen, overhead, kolom };
}
