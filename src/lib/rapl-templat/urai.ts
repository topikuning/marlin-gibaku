/**
 * PENGURAI ITEM RAB → KOMPONEN RAPL LEWAT TEMPLAT (DECISIONS 801) – murni.
 *
 * Ditulis ulang dari prototipe referensi user (`eng.py` `decompose`). Satu
 * item RAB menjadi daftar komponen (bahan, upah, alat, jasa, biaya umum)
 * beserta KOEFISIEN per satuan item – jumlahnya dikali volume oleh pemakai.
 *
 * TANPA HARGA (koreksi user 2026-11-28, DECISIONS 805): harga di prototipe
 * referensi (katalog Sulut, harga K3, faktor dari harga satuan RAB) adalah
 * contoh untuk proyek itu, bukan acuan. Mesin ini hanya mengurai ITEM; harga
 * ditentukan per lokasi oleh MARLIN sendiri.
 */
import { klasifikasiItem } from "./klasifikasi";
import SUMBER_DAYA from "./sumber-daya.json";
import TEMPLAT from "./templat.json";

export type KategoriRapl =
  | "Bahan"
  | "Upah"
  | "Alat dan Angkutan"
  | "Jasa, Subkon dan Biaya Resmi"
  | "Biaya Umum Lapangan";

/**
 * Kategori templat → kategori komponen RAPL MARLIN (`bahan`/`upah`/`alat`
 * yang sudah dipakai analisa kontrak & AHSP; `jasa` dan `umum` baru).
 */
export function kategoriRaplMarlin(k: KategoriRapl): string {
  switch (k) {
    case "Bahan":
      return "bahan";
    case "Upah":
      return "upah";
    case "Alat dan Angkutan":
      return "alat";
    case "Jasa, Subkon dan Biaya Resmi":
      return "jasa";
    case "Biaya Umum Lapangan":
      return "umum";
  }
}

export const URUTAN_KATEGORI_RAPL: readonly KategoriRapl[] = [
  "Bahan",
  "Upah",
  "Alat dan Angkutan",
  "Jasa, Subkon dan Biaya Resmi",
  "Biaya Umum Lapangan",
];

export type SumberDaya = {
  kunci: string;
  nama: string;
  satuan: string;
  kategori: KategoriRapl;
  kelompok: string;
};

export type KomponenTemplat = {
  /** Kunci katalog sumber daya; null = komponen khusus item ini (barang jadi, biaya resmi). */
  kunci: string | null;
  kategori: KategoriRapl;
  kelompok: string;
  nama: string;
  satuan: string;
  /** Per satuan item RAB. */
  koefisien: number;
};

export type HasilUrai = {
  /** Id templat, atau K3 / FIX / FB / GEN. */
  templat: string;
  komponen: KomponenTemplat[];
};

const KATALOG: ReadonlyMap<string, SumberDaya> = new Map(
  (SUMBER_DAYA as unknown as SumberDaya[]).map((s) => [s.kunci, s]),
);
const DAFTAR_TEMPLAT = TEMPLAT as unknown as Record<string, [string, number | null][]>;

export function sumberDaya(kunci: string): SumberDaya | undefined {
  return KATALOG.get(kunci);
}
export function semuaSumberDaya(): SumberDaya[] {
  return [...KATALOG.values()];
}

/** Besi beton sesuai diameter di uraian (`rb2` referensi). Tanpa angka: D10. */
export function besiMenurutUraian(uraian: string): string {
  const m = /(?:ø|\bd)\s?(\d+)/.exec(uraian.toLowerCase());
  const n = m ? Number(m[1]) : 10;
  return n <= 6 ? "d6" : n <= 8 ? "d8" : n <= 10 ? "d10" : n <= 13 ? "d13" : n <= 16 ? "d16" : "d25";
}

/** Pipa PVC sesuai ukuran di uraian (`pvc2` referensi). Tanpa ukuran: 2". */
export function pvcMenurutUraian(uraian: string): string {
  const s = uraian.toLowerCase().replaceAll('"', " inch");
  if (s.includes("1 ½") || s.includes("1 1/2")) return "pvc15";
  if (s.includes("3/4") || s.includes("¾")) return "pvc075";
  if (s.includes("½") || s.includes("1/2")) return "pvc05";
  for (const [k, pola] of [
    ["pvc1", /\b1 ?inch/],
    ["pvc2", /\b2 ?inch/],
    ["pvc3", /\b3 ?inch/],
    ["pvc4", /\b4 ?inch/],
  ] as const)
    if (pola.test(s)) return k;
  return "pvc2";
}

/** Nama tampil: tanpa "Pekerjaan"/"Pek." di depan, huruf pertama besar (`prettify`). */
export function namaTampil(uraian: string): string {
  const d = uraian.trim().replace(/\s+/g, " ").replace(/^~+/, "").trim().replace(/^(pekerjaan|pek\.)\s+/i, "");
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function dariKatalog(kunci: string, koefisien: number): KomponenTemplat {
  const s = KATALOG.get(kunci);
  if (!s) throw new Error(`Sumber daya "${kunci}" tidak ada di katalog RAPL.`);
  return {
    kunci,
    kategori: s.kategori,
    kelompok: s.kelompok,
    nama: s.nama,
    satuan: s.satuan,
    koefisien,
  };
}

function khusus(kategori: KategoriRapl, kelompok: string, nama: string, satuan: string): KomponenTemplat {
  return { kunci: null, kategori, kelompok, nama, satuan, koefisien: 1 };
}

function dariTemplat(id: string, uraian: string): KomponenTemplat[] {
  return (DAFTAR_TEMPLAT[id] ?? []).flatMap(([kunci, koef]) => {
    if (koef == null || koef <= 0) return [];
    const k = kunci === "@rb" ? besiMenurutUraian(uraian) : kunci === "@pvc" ? pvcMenurutUraian(uraian) : kunci;
    // Penanda yang tidak dikenal (`@nyy` di templat yang tidak pernah dipilih
    // pengenal) dilewati, bukan ditebak.
    if (k.startsWith("@")) return [];
    return [dariKatalog(k, koef)];
  });
}

export function adaTemplat(id: string): boolean {
  return id in DAFTAR_TEMPLAT;
}

/**
 * Urai satu item RAB. `induk` = judul kelompok tepat di atas item (dipakai
 * "Pengadaan barang" dan ongkos kirim yang menyebut barangnya).
 */
export function uraiItem(item: { uraian: string; satuan: string; induk?: string }): HasilUrai {
  const { uraian, satuan } = item;
  const induk = item.induk ?? "";
  const templat = klasifikasiItem(uraian, satuan, induk);
  if (templat in DAFTAR_TEMPLAT) return { templat, komponen: dariTemplat(templat, uraian) };

  const s = uraian.toLowerCase();
  if (templat === "K3") {
    return { templat, komponen: [khusus("Bahan", "Material K3 dan Perlengkapan", namaTampil(uraian), satuan)] };
  }
  if (templat === "FIX") {
    let kategori: KategoriRapl = "Jasa, Subkon dan Biaya Resmi";
    if (/sewa rumah|listrik kerja/.test(s)) kategori = "Biaya Umum Lapangan";
    if (/bulldozer|roller|excavator|mixer|stamper|mesin las/.test(s)) kategori = "Alat dan Angkutan";
    const nama =
      kategori === "Alat dan Angkutan" ? `Mobilisasi dan demobilisasi ${namaTampil(uraian).toLowerCase()}` : namaTampil(uraian);
    return {
      templat,
      komponen: [khusus(kategori, kategori.startsWith("Jasa") ? "Biaya Resmi" : "Paket", nama, satuan)],
    };
  }
  if (templat === "FB") {
    if (s.includes("panel distribusi kawasan")) return { templat: "lvmdp", komponen: dariTemplat("lvmdp", uraian) };
    if (s.includes("tempat sampah"))
      return {
        templat,
        komponen: [
          khusus("Bahan", "Komponen Jadi dan Pengadaan", "Tempat sampah portable 1100 liter", satuan),
          khusus("Alat dan Angkutan", "Angkutan", "Ongkos kirim tempat sampah ke lokasi", satuan),
        ],
      };
    if (s.includes("pengiriman bahan"))
      return {
        templat,
        komponen: [
          khusus("Alat dan Angkutan", "Angkutan", "Ongkos kirim bahan ke lokasi", satuan),
          khusus("Upah", "Tenaga Kerja", "Tenaga perakitan di lokasi", satuan),
        ],
      };
    const barang = induk ? namaTampil(induk).slice(0, 50).toLowerCase() : "paket";
    return {
      templat,
      komponen: [khusus("Alat dan Angkutan", "Angkutan", `Ongkos kirim barang ke lokasi (${barang})`, satuan)],
    };
  }
  // GEN – barang jadi/pekerjaan yang tidak dikenali templat mana pun.
  const nama =
    s.trim() === "pengadaan barang" && induk ? `Pengadaan ${namaTampil(induk).slice(0, 60)}` : namaTampil(uraian);
  return {
    templat: "GEN",
    komponen: [khusus("Bahan", "Komponen Jadi dan Pengadaan", nama, satuan)],
  };
}
