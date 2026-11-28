/**
 * PENGURAI ITEM RAB → KOMPONEN RAPL LEWAT TEMPLAT (DECISIONS 801) – murni.
 *
 * Ditulis ulang dari prototipe referensi user (`eng.py` `decompose`). Satu
 * item RAB menjadi daftar komponen (bahan, upah, alat, jasa, biaya umum)
 * beserta KOEFISIEN per satuan item – jumlahnya dikali volume oleh pemakai.
 *
 * Soal harga, dua hal dibedakan dan tidak pernah dicampur:
 * - `hargaAcuan` = estimasi harga pasar dari katalog referensi (Sulut, Nov
 *   2026). BELUM terverifikasi pemasok; dipakai hanya sebagai rujukan, atau
 *   lewat alur persetujuan HSD – tidak pernah diam-diam jadi harga.
 * - `faktorHargaRab` = komponen yang di referensi diperkirakan dari harga
 *   satuan RAB itu sendiri (barang jadi, ongkos kirim, biaya resmi): harga
 *   perkiraan = harga satuan RAB × faktor. Juga hanya rujukan.
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
  hargaAcuan: number;
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
  /** Estimasi katalog – rujukan, bukan harga dipakai. */
  hargaAcuan: number | null;
  /** Harga perkiraan = harga satuan RAB × faktor (rujukan). */
  faktorHargaRab: number | null;
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

/** Harga acuan perlengkapan K3 (`K3P` referensi) – kata pertama yang cocok. */
const HARGA_K3: readonly [string, number][] = [
  ["sepatu", 180000],
  ["topi pelindung", 55000],
  ["p3k", 3200000],
  ["papan nama", 650000],
  ["jalur evakuasi", 350000],
  ["apar", 480000],
  ["rompi", 35000],
  ["rambu", 55000],
  ["masker", 4000],
  ["pernapasan", 4000],
  ["sarung tangan", 8000],
  ["rambuncis", 80000],
  ["lampu darurat", 65000],
  ["pembatas", 90000],
  ["bendera", 35000],
];

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
    hargaAcuan: s.hargaAcuan,
    faktorHargaRab: null,
  };
}

function khusus(
  kategori: KategoriRapl,
  kelompok: string,
  nama: string,
  satuan: string,
  harga: { acuan?: number; faktor?: number },
): KomponenTemplat {
  return {
    kunci: null,
    kategori,
    kelompok,
    nama,
    satuan,
    koefisien: 1,
    hargaAcuan: harga.acuan ?? null,
    faktorHargaRab: harga.faktor ?? null,
  };
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
    const acuan = HARGA_K3.find(([k]) => s.includes(k))?.[1];
    return {
      templat,
      komponen: [
        khusus("Bahan", "Material K3 dan Perlengkapan", namaTampil(uraian), satuan, acuan ? { acuan } : { faktor: 0.8 }),
      ],
    };
  }
  if (templat === "FIX") {
    let kategori: KategoriRapl = "Jasa, Subkon dan Biaya Resmi";
    if (/sewa rumah|listrik kerja/.test(s)) kategori = "Biaya Umum Lapangan";
    if (/bulldozer|roller|excavator|mixer|stamper|mesin las/.test(s)) kategori = "Alat dan Angkutan";
    const nama =
      kategori === "Alat dan Angkutan" ? `Mobilisasi dan demobilisasi ${namaTampil(uraian).toLowerCase()}` : namaTampil(uraian);
    return {
      templat,
      komponen: [khusus(kategori, kategori.startsWith("Jasa") ? "Biaya Resmi" : "Paket", nama, satuan, { faktor: 1 })],
    };
  }
  if (templat === "FB") {
    if (s.includes("panel distribusi kawasan")) return { templat: "lvmdp", komponen: dariTemplat("lvmdp", uraian) };
    if (s.includes("tempat sampah"))
      return {
        templat,
        komponen: [
          khusus("Bahan", "Komponen Jadi dan Pengadaan", "Tempat sampah portable 1100 liter (Krisbow)", satuan, { acuan: 3600000 }),
          khusus("Alat dan Angkutan", "Angkutan", "Ongkos kirim tempat sampah ke lokasi", satuan, { acuan: 450000 }),
        ],
      };
    if (s.includes("pengiriman bahan"))
      return {
        templat,
        komponen: [
          khusus("Alat dan Angkutan", "Angkutan", "Ongkos kirim bahan ke lokasi", satuan, { faktor: 0.55 }),
          khusus("Upah", "Tenaga Kerja", "Tenaga perakitan di lokasi", satuan, { faktor: 0.25 }),
        ],
      };
    const barang = induk ? namaTampil(induk).slice(0, 50).toLowerCase() : "paket";
    return {
      templat,
      komponen: [khusus("Alat dan Angkutan", "Angkutan", `Ongkos kirim barang ke lokasi (${barang})`, satuan, { faktor: 0.75 })],
    };
  }
  // GEN – barang jadi/pekerjaan yang tidak dikenali templat mana pun.
  const nama =
    s.trim() === "pengadaan barang" && induk ? `Pengadaan ${namaTampil(induk).slice(0, 60)}` : namaTampil(uraian);
  return {
    templat: "GEN",
    komponen: [khusus("Bahan", "Komponen Jadi dan Pengadaan", nama, satuan, { faktor: 0.82 })],
  };
}
