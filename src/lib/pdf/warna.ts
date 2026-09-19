import type { TemaDeck } from "@/lib/paparan/tema";

/**
 * WARNA TURUNAN TEMA DECK — modul MURNI (tanpa "server-only").
 *
 * Palet tema (`lib/paparan/tema.ts`) hanya memuat warna POKOK. Warna
 * sekunder — abu label di latar gelap, garis pemisah, latar kepala tabel,
 * latar chip — DITURUNKAN dari warna pokok dengan hue yang sama supaya satu
 * tema terasa satu wajah, dan supaya menambah tema baru cukup mengisi palet
 * pokoknya.
 *
 * Dipakai renderer PDF (lewat deck-primitives) DAN pratinjau React: keduanya
 * membaca turunan yang sama, jadi warna di layar = warna di PDF. Modul ini
 * terpisah dari deck-primitives karena pratinjau tidak boleh mengimpor
 * pdfkit.
 *
 * Untuk navy Mataram, angka saturasi/terang di bawah dipilih supaya hasilnya
 * sama dengan hex tetap desain asli (DECISIONS 417) sampai 1–2 satuan.
 */

type Rgb = [number, number, number];
type Hsl = [number, number, number];

function hexKeRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbKeHex([r, g, b]: Rgb): string {
  const k = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${k(r)}${k(g)}${k(b)}`;
}

function rgbKeHsl([r, g, b]: Rgb): Hsl {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslKeRgb([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: Rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/** Warna se-hue dengan `dasar`, saturasi `s` dan terang `l` (0..1). */
export function nada(dasar: string, s: number, l: number): string {
  const [h] = rgbKeHsl(hexKeRgb(dasar));
  return rgbKeHex(hslKeRgb([h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))]));
}

/** Campur `a` ke arah `b` sejauh `t` (0 = a, 1 = b). */
export function campur(a: string, b: string, t: number): string {
  const A = hexKeRgb(a);
  const B = hexKeRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbKeHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** Luminansi relatif (WCAG) 0..1. */
export function luminansi(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexKeRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Warna teks yang terbaca di atas `latar`: putih untuk latar gelap, tinta untuk terang. */
export function teksPekat(latar: string, tinta = "#1f2937"): string {
  return luminansi(latar) < 0.35 ? "#ffffff" : tinta;
}

export type TurunanTema = {
  /** Teks sekunder di latar gelap (sub judul, label kartu). */
  teksRedupGelap: string;
  /** Teks paling samar di latar gelap (baris kontrak, penutup). */
  teksSamarGelap: string;
  /** Teks utama di latar gelap. */
  teksGelap: string;
  /** Garis/hiasan di latar gelap (lingkaran, pemisah kepala foto). */
  garisGelap: string;
  /** Footer di latar gelap. */
  footerGelap: string;
  /** Pemisah "|" pada meta strip gelap. */
  pemisahGelap: string;
  /** Latar kepala tabel di slide terang. */
  aksenSoft: string;
  /** Latar sorot (mis. minggu terakhir pada statistik kurva). */
  aksenSorot: string;
  /** Garis penanda vertikal "Minggu Ini". */
  garisPenanda: string;
  /** Trek bar kosong di slide terang. */
  trekBar: string;
  /** Garis rencana putus-putus di kurva. */
  garisRencana: string;
};

/** Seluruh warna sekunder satu tema, diturunkan dari paletnya. */
export function turunanTema(tema: TemaDeck): TurunanTema {
  const p = tema.palet;
  return {
    teksRedupGelap: nada(p.gelap, 0.24, 0.65),
    teksSamarGelap: nada(p.gelap, 0.18, 0.465),
    teksGelap: p.putih,
    garisGelap: nada(p.gelap, 0.35, 0.21),
    footerGelap: nada(p.gelap, 0.24, 0.34),
    pemisahGelap: nada(p.gelap, 0.25, 0.32),
    aksenSoft: nada(p.aksen, 0.53, 0.94),
    aksenSorot: nada(p.aksen, 0.68, 0.95),
    garisPenanda: nada(p.aksen, 0.64, 0.85),
    trekBar: nada(p.primer, 0.24, 0.89),
    garisRencana: nada(p.primer, 0.16, 0.76),
  };
}

/**
 * Pasangan latar+teks chip dari satu warna dasar: di latar terang = latar
 * lembut + teks warna dasarnya; di latar gelap = latar pekat + teks terang,
 * keduanya se-hue dengan dasarnya.
 */
export function warnaChip(dasar: string, gelap: boolean): { latar: string; teks: string } {
  return gelap
    ? { latar: nada(dasar, 0.37, 0.17), teks: nada(dasar, 1, 0.77) }
    : { latar: nada(dasar, 0.7, 0.94), teks: dasar };
}
