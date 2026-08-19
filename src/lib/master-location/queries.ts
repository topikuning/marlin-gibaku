import "server-only";
import { db } from "@/lib/db";

/**
 * Mitigasi lokasi ganda untuk jalur cepat (bypass): katalog `MasterLocation`
 * bisa memuat lokasi yang SUDAH ada sebagai Location riil (mis. dibuat lewat
 * alur normal di production). Instansiasi master → Location harus mengecualikan
 * yang sudah ada agar tidak dobel.
 *
 * Ada DUA pembanding, sengaja berbeda — jangan ditukar:
 * - `locationKey` (ketat, termasuk kecamatan): katalog ↔ katalog, mis. dedup
 *   baris impor. Kedua sisi berasal dari file yang sama, kecamatan selalu ada.
 * - `existingLocationIndex` (longgar soal kecamatan): katalog ↔ Location RIIL.
 *   Lihat alasannya di atas fungsi itu.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Kunci alami KETAT = provinsi|kabupaten|kecamatan|desa. Katalog ↔ katalog saja. */
export function locationKey(p: {
  province: string;
  regency: string;
  district: string | null;
  village: string;
}): string {
  return [norm(p.province), norm(p.regency), norm(p.district ?? ""), norm(p.village)].join("|");
}

export type LocationIdentity = {
  province: string;
  regency: string;
  district: string | null;
  village: string;
};

/**
 * Pencocokan katalog ↔ Location RIIL. Kunci alami penuh (dgn kecamatan) tidak
 * bisa dipakai di sini: Location riil sering dibuat tanpa kecamatan (kolomnya
 * opsional & baru ada belakangan), sementara baris katalog hampir selalu
 * mengisinya — akibatnya TIDAK ADA yang pernah cocok dan lokasi yang sudah
 * terpakai tetap muncul sebagai "tersedia" (dilaporkan user 2026-07-31: 73 dari
 * 73 baris lolos, 5 di antaranya jelas sudah dipakai).
 *
 * Aturan: provinsi+kabupaten+desa harus sama, DAN kecamatan dianggap cocok bila
 * sama ATAU salah satu sisi kosong. Desa senama di dua kecamatan berbeda (yang
 * dua-duanya terisi) tetap dibedakan — itu memang lokasi yang berbeda.
 *
 * Perbandingan juga ABAI SPASI: nama desa Indonesia ditulis tidak konsisten
 * antar sumber ("Kedungmutih" di katalog vs "Kedung Mutih" di Location riil —
 * kasus nyata di data ini), dan itu desa yang sama.
 */
export type ExistingLocationIndex = {
  has: (p: LocationIdentity) => boolean;
  size: number;
};

/** Normalisasi longgar: huruf kecil, tanpa spasi sama sekali. */
const normLoose = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

function baseKey(p: LocationIdentity): string {
  return [normLoose(p.province), normLoose(p.regency), normLoose(p.village)].join("|");
}

export function buildExistingLocationIndex(locs: LocationIdentity[]): ExistingLocationIndex {
  const byBase = new Map<string, Set<string>>();
  for (const l of locs) {
    const k = baseKey(l);
    const set = byBase.get(k) ?? new Set<string>();
    set.add(normLoose(l.district ?? ""));
    byBase.set(k, set);
  }
  return {
    size: locs.length,
    has(p) {
      const districts = byBase.get(baseKey(p));
      if (!districts) return false;
      const d = normLoose(p.district ?? "");
      return d === "" || districts.has("") || districts.has(d);
    },
  };
}

/** Index Location riil milik org (lintas paket) untuk dicocokkan dgn katalog. */
export async function existingLocationIndex(orgId: string): Promise<ExistingLocationIndex> {
  const locs = await db.location.findMany({
    where: { package: { orgId } },
    select: { province: true, regency: true, district: true, village: true },
  });
  return buildExistingLocationIndex(locs);
}

/* ------------------------------------------------------------------ */
/* Pencegahan lokasi ganda saat menambah manual (DECISIONS 368)         */
/* ------------------------------------------------------------------ */

/**
 * Seberapa yakin sebuah kandidat adalah lokasi yang SAMA.
 *
 * - `persis` — kunci alaminya identik. Ini tidak bisa dibuat lagi: indeks unik
 *   `@@unique([orgId, province, regency, district, village])` akan menolaknya,
 *   dan memang seharusnya.
 * - `mirip` — cocok setelah dinormalkan longgar. Ejaannya berbeda
 *   ("Kedungmutih" vs "Kedung Mutih" — kasus nyata di data ini), atau salah
 *   satu sisi tidak mengisi kecamatan. Basis data akan menerimanya sebagai
 *   baris baru, jadi justru INILAH yang menghasilkan lokasi ganda.
 */
export type KemiripanDuplikat = "persis" | "mirip";

export type KandidatDuplikat = LocationIdentity & {
  id: string;
  /** `katalog` = baris master. `lokasi` = Location riil yang sudah berpaket. */
  sumber: "katalog" | "lokasi";
  /** Nama yang dikenal orang — nama Location riil, atau desa untuk katalog. */
  nama: string;
  kemiripan: KemiripanDuplikat;
};

/** Kecamatan cocok bila sama, ATAU salah satu sisi kosong (lihat catatan atas). */
function kecamatanCocok(a: LocationIdentity, b: LocationIdentity): boolean {
  const x = normLoose(a.district ?? "");
  const y = normLoose(b.district ?? "");
  return x === "" || y === "" || x === y;
}

/**
 * Cari lokasi yang mungkin SAMA dengan yang hendak ditambahkan.
 *
 * Dipakai SEBELUM menyimpan, dan sengaja LEBIH LONGGAR daripada indeks unik di
 * basis data. Indeks unik hanya menangkap yang hurufnya persis sama; yang
 * benar-benar terjadi di lapangan adalah ejaan yang berbeda tipis, dan itu
 * lolos indeks lalu menjadi dua lokasi untuk satu desa yang sama.
 *
 * Katalog DAN Location riil dua-duanya diperiksa: menambah baris katalog untuk
 * desa yang sudah berjalan sebagai proyek adalah bentuk lokasi ganda yang
 * paling merepotkan — angkanya terpecah dua tanpa ada yang sadar.
 */
export function cariDuplikat(
  input: LocationIdentity,
  katalog: (LocationIdentity & { id: string })[],
  lokasiRiil: (LocationIdentity & { id: string; name: string })[],
): KandidatDuplikat[] {
  const kunci = locationKey(input);
  const hasil: KandidatDuplikat[] = [];

  const nilai = (i: LocationIdentity): KemiripanDuplikat | null => {
    if (locationKey(i) === kunci) return "persis";
    if (baseKey(i) === baseKey(input) && kecamatanCocok(i, input)) return "mirip";
    return null;
  };

  for (const k of katalog) {
    const m = nilai(k);
    if (m) hasil.push({ ...k, sumber: "katalog", nama: k.village, kemiripan: m });
  }
  for (const l of lokasiRiil) {
    const m = nilai(l);
    if (m) hasil.push({ ...l, sumber: "lokasi", nama: l.name, kemiripan: m });
  }

  // Yang paling meyakinkan lebih dulu — itu yang menentukan boleh-tidaknya
  // menyimpan, jadi ia tidak boleh tenggelam di bawah daftar yang cuma mirip.
  return hasil.sort((a, b) => (a.kemiripan === b.kemiripan ? 0 : a.kemiripan === "persis" ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* Status katalog                                                      */
/* ------------------------------------------------------------------ */

/**
 * Status satu baris katalog — SELALU turunan, tidak pernah kolom yang disunting
 * (aturan proyek: angka & status agregat wajib derived).
 *
 * Urutan prioritas dipilih dari "apa yang harus dilakukan orang terhadap baris
 * ini", bukan dari kerapian: baris yang sudah terpakai tidak menunggu tindakan
 * apa pun, sementara baris tersedia yang koordinatnya kosong menunggu
 * diperbaiki sebelum dipakai.
 */
export type StatusKatalog = "terpakai" | "sudah_ada" | "perlu_verifikasi" | "tersedia";

export function tanpaKoordinat(m: { latitude: unknown; longitude: unknown }): boolean {
  return m.latitude == null || m.longitude == null;
}

export function statusKatalog(
  m: { assignedLocationId: string | null; latitude: unknown; longitude: unknown },
  adaLokasiRiil: boolean,
): StatusKatalog {
  if (m.assignedLocationId != null) return "terpakai";
  if (adaLokasiRiil) return "sudah_ada";
  if (tanpaKoordinat(m)) return "perlu_verifikasi";
  return "tersedia";
}

export type CatalogItem = {
  id: string;
  province: string;
  regency: string;
  district: string | null;
  village: string;
  candidateVendor: string | null;
};

/**
 * Katalog master yang BENAR-BENAR tersedia untuk bypass: belum terpakai
 * (assignedLocationId null) DAN belum ada Location riil dgn kunci alami sama.
 * `hiddenExistingCount` = jumlah katalog yang disembunyikan karena sudah ada.
 */
export async function getAvailableCatalog(
  orgId: string,
): Promise<{ available: CatalogItem[]; hiddenExistingCount: number }> {
  const [masters, existing] = await Promise.all([
    db.masterLocation.findMany({
      where: { orgId, assignedLocationId: null },
      orderBy: [{ province: "asc" }, { regency: "asc" }, { village: "asc" }],
      select: {
        id: true,
        province: true,
        regency: true,
        district: true,
        village: true,
        candidateVendor: true,
      },
    }),
    existingLocationIndex(orgId),
  ]);
  const available = masters.filter((m) => !existing.has(m));
  return { available, hiddenExistingCount: masters.length - available.length };
}
