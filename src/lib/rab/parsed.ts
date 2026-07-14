/**
 * Tipe hasil parse RAB/HPS — PERSIS mengikuti bentuk JSON di seed-data/*.json
 * (output scripts/generate_seed.py). snake_case dipertahankan agar file seed
 * bisa diimport langsung tanpa mapping.
 */

export type ParsedRabItem = {
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  tkdn_ratio: number | null;
  /** Kode induk (null untuk item level-1). Ada di seed JSON; opsional saat parse. */
  parent_code?: string | null;
  children: ParsedRabItem[];
};

export type ParsedRabSubcategory = {
  code: string;
  name: string;
  total_value: number;
  items: ParsedRabItem[];
};

export type ParsedRabCategory = {
  roman: string;
  name: string;
  total_value: number;
  subcategories: ParsedRabSubcategory[];
  direct_items: ParsedRabItem[];
};

/** Metadata lokasi. Dari xlsx HPS sebagian besar tidak terbaca → nullable. */
export type ParsedRabMeta = {
  slug: string | null;
  village: string | null;
  regency: string | null;
  province: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  contract_number: string | null;
  contractor: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type ParsedRab = {
  meta: ParsedRabMeta;
  project: string;
  /** Teks lokasi mentah dari sheet (mis. "KEDUNG MUTIH, DEMAK"). */
  location_name_raw?: string | null;
  province_raw?: string | null;
  year: number | null;
  /** Grand total (jumlah total_value semua kategori, hasil sumLeaves). */
  total: number;
  categories: ParsedRabCategory[];
};
