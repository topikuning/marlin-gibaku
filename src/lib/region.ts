/**
 * Pemetaan provinsi → wilayah besar (kartu "sebaran wilayah" Dashboard
 * Eksekutif). MURNI (tanpa DB) supaya bisa diuji langsung.
 */

// ── Region (provinsi → wilayah besar) ────────────────────────────────────────
export const REGION_ORDER = ["Sumatera", "Jawa", "Kalimantan", "Sulawesi", "Bali & Nusa", "Maluku & Papua"] as const;
/** Ember penampung provinsi yang tidak dikenali — ditampilkan bila terisi. */
export const REGION_OTHER = "Lainnya";

/**
 * `Location.province` adalah teks bebas: diketik manual di form maupun ikut apa
 * adanya dari kolom Excel saat impor master lokasi. Jadi satu provinsi yang sama
 * bisa datang sebagai "Nusa Tenggara Barat", "NUSA TENGGARA BARAT", "NTB", atau
 * "Prov. Bali". Pencocokan tabel PERSIS membuat semuanya jatuh ke "Lainnya" —
 * dan karena "Lainnya" dulu tidak pernah ditampilkan, lokasinya lenyap dari
 * sebaran wilayah walau pin-nya terlihat jelas di peta (temuan 2026-07-27:
 * kartu Jawa 46, sisanya 0, padahal Bali/NTB ada di peta).
 *
 * Normalisasi: huruf kecil, buang tanda baca & kata pengantar ("Provinsi",
 * "Prov.", "Daerah Istimewa"), lalu cocokkan dengan KATA KUNCI pulau sehingga
 * singkatan resmi maupun ejaan alternatif tetap masuk ember yang benar.
 */
const normProvince = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\b(provinsi|propinsi|prov|daerah istimewa|daerah khusus ibukota|dki|di)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Singkatan resmi/umum yang tidak tertangkap kata kunci pulau. */
const PROVINCE_ALIAS: Record<string, string> = {
  ntb: "Bali & Nusa", ntt: "Bali & Nusa", nusra: "Bali & Nusa",
  diy: "Jawa", jogja: "Jawa", yogya: "Jawa", yogyakarta: "Jawa", jabodetabek: "Jawa",
  jabar: "Jawa", jateng: "Jawa", jatim: "Jawa",
  sumut: "Sumatera", sumbar: "Sumatera", sumsel: "Sumatera", babel: "Sumatera", kepri: "Sumatera", nad: "Sumatera",
  kalbar: "Kalimantan", kalteng: "Kalimantan", kalsel: "Kalimantan", kaltim: "Kalimantan", kaltara: "Kalimantan",
  sulut: "Sulawesi", sulteng: "Sulawesi", sulsel: "Sulawesi", sultra: "Sulawesi", sulbar: "Sulawesi",
};

/** Kata kunci → wilayah (urutan diperiksa dari atas). */
const REGION_KEYWORDS: [RegExp, string][] = [
  [/\b(nusa tenggara|bali|lombok|sumbawa|flores|timor)\b/, "Bali & Nusa"],
  [/\b(maluku|papua)\b/, "Maluku & Papua"],
  [/\b(kalimantan|borneo)\b/, "Kalimantan"],
  [/\b(sulawesi|gorontalo|celebes)\b/, "Sulawesi"],
  // "yogya"/"jogja" tanpa batas kata di belakang: menangkap "Yogyakarta",
  // "D.I. Yogyakarta", "Jogjakarta".
  [/\b(jawa|jakarta|banten)\b|\b(jogja|yogya)/, "Jawa"],
  [/\b(sumatera|sumatra|aceh|riau|jambi|bengkulu|lampung|bangka|belitung)\b/, "Sumatera"],
];

export const regionOf = (province: string): string => {
  const p = normProvince(province ?? "");
  if (!p) return REGION_OTHER;
  const alias = PROVINCE_ALIAS[p.replace(/ /g, "")];
  if (alias) return alias;
  for (const [re, region] of REGION_KEYWORDS) if (re.test(p)) return region;
  return REGION_OTHER;
};

