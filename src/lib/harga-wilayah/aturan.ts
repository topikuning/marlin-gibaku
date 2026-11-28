/**
 * ATURAN KATALOG HARGA WILAYAH (DECISIONS 806) – murni, tanpa basis data.
 *
 * Bukan formula angka RAPL: tidak ada rupiah yang dihitung di sini, hanya
 * keputusan tentang data riset (masih segar atau tidak, sumber mana yang sah,
 * bagaimana usulan diterangkan). Biaya tetap dihitung `rapl-calc.ts`.
 */

/** Harga yang lebih tua dari ini diriset ulang sebelum dipakai. */
export const USIA_KATALOG_HARI = 90;
/** Sumber per harga yang disimpan; lebih dari ini tidak menambah keyakinan. */
export const MAKS_SUMBER = 3;
/** Pencarian web paling banyak per putaran (25 sumber daya). */
export const MAKS_PENCARIAN_PER_PUTARAN = 8;

export type MetodeHarga = "web" | "ai" | "lapangan";
export type Keyakinan = "rendah" | "sedang" | "tinggi";
export type SumberHarga = { url: string; judul: string };

export function masihSegar(diperbarui: Date, sekarang: Date, hari = USIA_KATALOG_HARI): boolean {
  return sekarang.getTime() - diperbarui.getTime() <= hari * 86_400_000;
}

/**
 * Bentuk baku alamat untuk dibandingkan: host huruf kecil tanpa `www.`, tanpa
 * pecahan (#), tanpa parameter pelacak, tanpa garis miring penutup. null =
 * bukan alamat http(s).
 */
export function normalUrl(u: string): string | null {
  let x: URL;
  try {
    x = new URL(u.trim());
  } catch {
    return null;
  }
  if (x.protocol !== "http:" && x.protocol !== "https:") return null;
  x.hash = "";
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
  const host = x.hostname.toLowerCase().replace(/^www\./, "");
  const jalan = x.pathname.replace(/\/+$/, "");
  const q = x.searchParams.toString();
  return `${host}${jalan}${q ? `?${q}` : ""}`;
}

export function domain(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return u;
  }
}

/**
 * Sumber yang disebut model DISARING terhadap alamat yang benar-benar muncul
 * di hasil pencarian. Alamat karangan model – yang tidak pernah dikembalikan
 * mesin pencari – dibuang: harga "bersumber" yang sumbernya tidak ada lebih
 * berbahaya daripada estimasi yang mengaku estimasi.
 */
export function verifikasiSumber(
  dariModel: readonly { url: string; judul?: string | null }[],
  ditemukan: ReadonlyMap<string, SumberHarga>,
): SumberHarga[] {
  const hasil: SumberHarga[] = [];
  const sudah = new Set<string>();
  for (const s of dariModel) {
    const n = normalUrl(s.url);
    if (!n || sudah.has(n)) continue;
    const asli = ditemukan.get(n);
    if (!asli) continue;
    sudah.add(n);
    hasil.push({ url: asli.url, judul: (asli.judul || s.judul || domain(asli.url)).slice(0, 200) });
    if (hasil.length >= MAKS_SUMBER) break;
  }
  return hasil;
}

/** Estimasi tanpa sumber tidak boleh mengaku yakin. */
export function batasiKeyakinan(metode: MetodeHarga, k: Keyakinan): Keyakinan {
  if (metode === "ai" && k === "tinggi") return "sedang";
  return k;
}

/** Keterangan satu usulan untuk kolom "Dasar usulan" (≤ 240 huruf). */
export function susunAlasan(a: { alasan: string; metode: MetodeHarga; sumber: readonly SumberHarga[]; diperbarui?: Date | null }): string {
  const ekor =
    a.metode === "web" && a.sumber.length > 0
      ? ` · Sumber: ${[...new Set(a.sumber.map((s) => domain(s.url)))].join(", ")}`
      : a.metode === "ai"
        ? " · Estimasi AI, tanpa sumber web"
        : "";
  const tgl = a.diperbarui ? ` (${a.diperbarui.toISOString().slice(0, 10)})` : "";
  const sisa = 240 - ekor.length - tgl.length;
  const badan = a.alasan.length > sisa ? `${a.alasan.slice(0, Math.max(0, sisa - 1))}…` : a.alasan;
  return `${badan}${ekor}${tgl}`;
}

/** Median bilangan rupiah (dibulatkan ke bawah untuk jumlah genap). */
export function medianRupiah(nilai: readonly bigint[]): bigint | null {
  if (nilai.length === 0) return null;
  const u = [...nilai].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const t = Math.floor(u.length / 2);
  return u.length % 2 === 1 ? u[t]! : (u[t - 1]! + u[t]!) / 2n;
}

/**
 * Harga lokasi lain yang boleh dianggap HARGA LAPANGAN: yang diisi orang.
 * Harga yang asalnya usulan mesin (AI, web, acuan) tidak dihitung – kalau
 * dihitung, estimasi mesin di satu lokasi akan kembali sebagai "bukti
 * lapangan" di lokasi sebelahnya.
 */
export function hargaBuatanOrang(sumber: string | null): boolean {
  if (!sumber) return true;
  return !/usulan ai|harga web|katalog|acuan|perkiraan|lapangan sekabupaten/i.test(sumber);
}

/** Zona waktu IANA per provinsi – untuk lokasi pencarian web. */
export function zonaWaktu(provinsi: string): string {
  const p = provinsi.toLowerCase();
  if (/papua|maluku/.test(p)) return "Asia/Jayapura";
  if (/sulawesi|bali|nusa tenggara|ntb|ntt|kalimantan (selatan|timur|utara)|gorontalo/.test(p)) return "Asia/Makassar";
  return "Asia/Jakarta";
}
