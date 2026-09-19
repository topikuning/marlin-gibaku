/**
 * TEMA DECK 16:9 — registri MURNI (tanpa "server-only"): dipakai renderer PDF,
 * komponen pratinjau, formulir, dan unit test.
 *
 * Permintaan user 2026-09-19: *"paparan saat ini poin-poin yang ditampilkan
 * sudah mirip seperti yang aku mau, tapi desain layout masih monoton (cuma satu
 * desain) aku butuh beberapa variasi."*
 *
 * Yang divariasikan hanya RUPA: palet, bentuk sampul, gaya judul, selang
 * gelap/terang, sudut kartu. Isi slide (`susunSlides`) dan setiap angka di
 * dalamnya TIDAK tahu tema — dijaga uji: susunan slide identik untuk semua tema.
 */

export const TEMA_DECK = ["mataram", "terang", "bakau", "merah_putih"] as const;
export type TemaDeckKey = (typeof TEMA_DECK)[number];
export const TEMA_DECK_DEFAULT: TemaDeckKey = "mataram";

/** Bentuk SAMPUL. */
export type GayaSampul =
  /** Latar gelap penuh, meta strip di bawah (contoh Mataram, DECISIONS 417). */
  | "strip_bawah"
  /** Panel warna di sisi kiri (±38% lebar), judul di panel terang kanan. */
  | "blok_kiri"
  /** Pita warna tipis di atas, judul besar di tengah bidang terang. */
  | "pita_atas"
  /** Judul di pusat, bingkai garis, meta sebagai baris kecil di bawah. */
  | "pusat";

/** Gaya JUDUL slide isi. */
export type GayaJudul =
  /** Garis bawah warna aksen (contoh Mataram). */
  | "garis_bawah"
  /** Pita vertikal warna aksen di kiri judul. */
  | "pita_kiri"
  /** Blok latar warna primer selebar slide, judul putih di dalamnya. */
  | "blok";

export type PaletDeck = {
  /** Latar slide gelap (dipakai bila `berselang`). */
  gelap: string;
  /** Kartu di atas latar gelap. */
  gelapKartu: string;
  /** Warna primer: judul, pita, blok. */
  primer: string;
  /** Warna aksen: angka, chip, garis judul, bar. */
  aksen: string;
  /** Aksen tua – teks aksen di atas latar terang. */
  aksenTua: string;
  /** Latar slide terang. */
  terang: string;
  /** Kartu di atas latar terang. */
  kartuTerang: string;
  putih: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  garis: string;
  hijau: string;
  hijauSoft: string;
  biru: string;
  oranye: string;
  merah: string;
  merahSoft: string;
};

export type TemaDeck = {
  key: TemaDeckKey;
  label: string;
  /** Satu kalimat untuk Combobox pemilih tema. */
  deskripsi: string;
  palet: PaletDeck;
  sampul: GayaSampul;
  judul: GayaJudul;
  /** Slide gelap/terang berselang (true) atau seluruhnya terang (false). */
  berselang: boolean;
  /** Radius sudut kartu (pt di PDF, px di pratinjau). 0 = kotak. */
  sudutKartu: number;
};

const BERSAMA = {
  putih: "#ffffff",
  hijau: "#16a34a",
  hijauSoft: "#e7f6ec",
  biru: "#3b82f6",
  oranye: "#f59e0b",
  merah: "#e11d48",
  merahSoft: "#fde7ec",
} as const;

export const TEMA: Record<TemaDeckKey, TemaDeck> = {
  /** Navy + cyan berselang — desain asli mengikuti contoh Mataram. */
  mataram: {
    key: "mataram",
    label: "Navy Mataram",
    deskripsi: "Gelap navy beraksen cyan, slide gelap/terang berselang – desain asli.",
    palet: {
      ...BERSAMA,
      gelap: "#0e1726",
      gelapKartu: "#162032",
      primer: "#0e1726",
      aksen: "#0ec1ce",
      aksenTua: "#0a9aa5",
      terang: "#f4f6f9",
      kartuTerang: "#ffffff",
      ink: "#1f2937",
      inkMuted: "#5b6472",
      inkFaint: "#9aa3af",
      garis: "#e3e7ee",
    },
    sampul: "strip_bawah",
    judul: "garis_bawah",
    berselang: true,
    sudutKartu: 8,
  },
  /** Seluruhnya terang, pita biru di kiri judul — untuk proyektor redup / cetak. */
  terang: {
    key: "terang",
    label: "Terang Bersih",
    deskripsi: "Seluruh slide terang, judul berpita biru – nyaman dicetak dan di proyektor redup.",
    palet: {
      ...BERSAMA,
      gelap: "#1e3a5f",
      gelapKartu: "#264a75",
      primer: "#1e3a5f",
      aksen: "#2563eb",
      aksenTua: "#1d4ed8",
      terang: "#ffffff",
      kartuTerang: "#f5f7fb",
      ink: "#111827",
      inkMuted: "#4b5563",
      inkFaint: "#9ca3af",
      garis: "#e5e7eb",
    },
    sampul: "pita_atas",
    judul: "pita_kiri",
    berselang: false,
    sudutKartu: 4,
  },
  /** Hijau bakau + amber berselang, sampul panel kiri. */
  bakau: {
    key: "bakau",
    label: "Hijau Bakau",
    deskripsi: "Hijau tua beraksen amber, sampul berpanel kiri, slide berselang.",
    palet: {
      ...BERSAMA,
      gelap: "#0b3d2e",
      gelapKartu: "#124b39",
      primer: "#0b3d2e",
      aksen: "#f5b400",
      aksenTua: "#b98600",
      terang: "#f6f8f4",
      kartuTerang: "#ffffff",
      ink: "#14261f",
      inkMuted: "#4f6359",
      inkFaint: "#93a39b",
      garis: "#dde5df",
    },
    sampul: "blok_kiri",
    judul: "blok",
    berselang: true,
    sudutKartu: 0,
  },
  /** Putih, blok merah–navy ala instansi; tanpa slide gelap. */
  merah_putih: {
    key: "merah_putih",
    label: "Merah Putih Instansi",
    deskripsi: "Putih dengan blok merah dan navy bergaya instansi, judul di pusat sampul.",
    palet: {
      ...BERSAMA,
      gelap: "#1b2a4a",
      gelapKartu: "#24365d",
      primer: "#1b2a4a",
      aksen: "#c8102e",
      aksenTua: "#9f0c25",
      terang: "#ffffff",
      kartuTerang: "#f8f9fb",
      ink: "#111827",
      inkMuted: "#4b5563",
      inkFaint: "#9ca3af",
      garis: "#e5e7eb",
    },
    sampul: "pusat",
    judul: "blok",
    berselang: false,
    sudutKartu: 2,
  },
};

/** Tema dari kunci apa pun; yang tak dikenal / kosong jatuh ke bawaan. */
export function temaDeck(key: string | null | undefined): TemaDeck {
  return key && (TEMA_DECK as readonly string[]).includes(key) ? TEMA[key as TemaDeckKey] : TEMA[TEMA_DECK_DEFAULT];
}

/** Daftar untuk Combobox pemilih tema. */
export const PILIHAN_TEMA_DECK = TEMA_DECK.map((k) => ({
  value: k,
  label: TEMA[k].label,
  deskripsi: TEMA[k].deskripsi,
}));
