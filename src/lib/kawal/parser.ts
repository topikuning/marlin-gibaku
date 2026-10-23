import { z } from "zod";

/**
 * PARSER KETAT RESPONS KAWAL `/api/knmp/locations` (DECISIONS 690).
 *
 * Bentuknya dibuktikan dari uji sambungan ke Kawal sungguhan (2026-10-18:
 * 96 baris × 110 field), bukan ditebak. Aturannya:
 *
 * - Yang diambil HANYA field di bawah. Sisanya – nomor HP, nama personel,
 *   `*_user_id`, `token_id`, CCTV, gambar – tidak pernah keluar dari fungsi
 *   ini, jadi tidak mungkin tersimpan.
 * - Field yang dipakai HILANG dari respons, atau tipenya BERUBAH, = gagal keras
 *   untuk seluruh tarikan. Tidak ada yang disimpan setengah. Endpoint ini tidak
 *   berdokumen; perubahan diam-diam harus terdengar, bukan ditoleransi.
 * - Nilai KOSONG (null / teks kosong) boleh: lokasi baru di Kawal wajar belum
 *   punya SPMK atau kurva.
 * - Angka boleh datang sebagai angka atau teks angka – Kawal sendiri memakai
 *   keduanya (mis. `nilai_lokasi` angka, `nilai_add1_kontrak_penyedia` teks).
 *   Rupiah boleh berformat (`1.250.000`, `Rp 1.250.000,-`) – DECISIONS 700.
 * - SATU pengecualian dari "gagal keras": `nilai` sarana berupa teks yang
 *   bukan angka sama sekali disimpan kosong dan DICATAT (DECISIONS 700). Field
 *   itu tidak dipakai di layar mana pun, dan satu sarana dari 893 tidak boleh
 *   menahan seluruh 96 lokasi.
 *
 * Murni, tanpa jaringan dan basis data.
 */

/** Nama kurva di MARLIN → nama field di Kawal. */
export const KURVA_KAWAL = {
  rencanaKumulatif: "kurva_rencana_kumulatif",
  realisasiKumulatif: "kurva_realisasi_kumulatif",
  pelaksanaKumulatif: "kurva_pelaksana_kumulatif",
  rencanaMingguan: "kurva_rencana_mingguan",
  realisasiMingguan: "kurva_realisasi_mingguan",
  pelaksanaMingguan: "kurva_pelaksana_mingguan",
  // Enam kurva berikut dikirim sebagai TEKS JSON. Maknanya belum terbukti
  // (dugaan: k = kontrak, r = realisasi, a1–a3 = adendum); disimpan supaya
  // jalur "Relatif" bisa dibuktikan dari data, bukan dari namanya.
  k: "kurva_k_json",
  r: "kurva_r_json",
  a1: "kurva_a1_json",
  a2: "kurva_a2_json",
  a3: "kurva_a3_json",
  pelaksana: "kurva_pelaksana_json",
} as const;

export type NamaKurva = keyof typeof KURVA_KAWAL;
export type Kurva = Record<NamaKurva, (number | null)[]>;

/** Kurva yang wajib ada. Sisanya boleh hilang (dianggap kosong) – belum dipakai di layar. */
const KURVA_WAJIB = new Set<NamaKurva>(["rencanaKumulatif", "realisasiKumulatif", "pelaksanaKumulatif"]);

export type SaranaKawal = {
  kawalItemId: number;
  sarprasId: number | null;
  nama: string;
  jenis: string | null;
  nilai: bigint | null;
  status: number | null;
  bobot: number | null;
  progresPct: number | null;
  realisasiKumulatif: number | null;
};

export type BarisKawal = {
  kawalId: number;
  namaKnmp: string;
  desa: string | null;
  kecamatan: string | null;
  kabupaten: string;
  provinsi: string | null;
  tahap: number | null;
  kategori: number | null;
  penyedia: string | null;
  noKontrak: string | null;
  /** YYYY-MM-DD */
  tglKontrak: string | null;
  noSpmk: string | null;
  mulai: string | null;
  selesai: string | null;
  estimasiHari: number | null;
  nilaiKontrak: bigint | null;
  nilaiLokasi: bigint | null;
  nilaiAdd1: bigint | null;
  nilaiAdd2: bigint | null;
  nilaiAdd3: bigint | null;
  statusKontrak: string | null;
  latitude: number | null;
  longitude: number | null;
  actualPct: number | null;
  pelaksanaPct: number | null;
  targetPct: number | null;
  deviasiPct: number | null;
  realisasiPengawasPct: number | null;
  realisasiPelaksanaPct: number | null;
  weekNo: number | null;
  maxWeeks: number | null;
  lastActualWeek: number | null;
  lastPelaksanaWeek: number | null;
  kurva: Kurva;
  remarkKondisiUmum: string | null;
  remarkHambatan: string | null;
  remarkSaranInstruksi: string | null;
  sarana: SaranaKawal[];
};

/* ── Penyusun skema ──────────────────────────────────────────────────────── */

const ANGKA_TEKS = /^-?\d+([.,]\d+)?$/;

function keAngka(s: string): number {
  return Number(s.replace(",", "."));
}

/** Angka, teks angka, null, atau teks kosong (→ null). Selain itu: tipe berubah. */
const angka = z.union([z.number(), z.string(), z.null()]).transform((v, ctx) => {
  if (v === null) return null;
  if (typeof v === "number") {
    if (Number.isFinite(v)) return v;
    ctx.addIssue({ code: "custom", message: "angka tidak sah" });
    return z.NEVER;
  }
  const s = v.trim();
  if (s === "") return null;
  if (ANGKA_TEKS.test(s)) return keAngka(s);
  ctx.addIssue({ code: "custom", message: "harus angka" });
  return z.NEVER;
});

const bulat = angka.transform((v, ctx) => {
  if (v === null) return null;
  if (Number.isInteger(v)) return v;
  ctx.addIssue({ code: "custom", message: "harus bilangan bulat" });
  return z.NEVER;
});

/**
 * Teks rupiah → angka; `undefined` = tidak terbaca. Selain teks angka biasa,
 * diterima format tulisan rupiah yang ISINYA sama (DECISIONS 700): awalan
 * `Rp`/`IDR`, ekor `,-`, titik ribuan (`1.250.000,50`), koma ribuan
 * (`1,250,000`). Teks angka biasa dibaca lebih dulu, jadi `12,5` tetap 12,5.
 */
export function bacaRupiahTeks(teksMentah: string): number | undefined {
  const s = teksMentah
    .trim()
    .replace(/^(rp\.?|idr)\s*/i, "")
    .replace(/[,.]-$/, "")
    .replace(/\s+/g, "");
  if (ANGKA_TEKS.test(s)) return keAngka(s);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  return undefined;
}

/** Rupiah: dibulatkan ke rupiah utuh, disimpan BigInt. */
const rupiah = z.union([z.number(), z.string(), z.null()]).transform((v, ctx) => {
  if (v === null) return null;
  if (typeof v === "number") {
    if (Number.isFinite(v)) return BigInt(Math.round(v));
    ctx.addIssue({ code: "custom", message: "angka tidak sah" });
    return z.NEVER;
  }
  if (v.trim() === "") return null;
  const n = bacaRupiahTeks(v);
  if (n !== undefined) return BigInt(Math.round(n));
  ctx.addIssue({ code: "custom", message: "harus angka" });
  return z.NEVER;
});

const teks = z.union([z.string(), z.null()]).transform((v) => {
  if (v === null) return null;
  const s = v.trim();
  return s === "" ? null : s;
});

const teksWajib = z.string().transform((v, ctx) => {
  const s = v.trim();
  if (s) return s;
  ctx.addIssue({ code: "custom", message: "tidak boleh kosong" });
  return z.NEVER;
});

/**
 * Tanggal YYYY-MM-DD (boleh berekor jam). `0000-00-00` – nilai kosong khas
 * aplikasi PHP – dibaca kosong. Format lain = tipe berubah.
 */
const tanggal = z.union([z.string(), z.null()]).transform((v, ctx) => {
  if (v === null) return null;
  const s = v.trim();
  if (s === "" || s.startsWith("0000-00-00")) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!Number.isNaN(d.getTime()) && d.getUTCDate() === Number(m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  ctx.addIssue({ code: "custom", message: "harus tanggal YYYY-MM-DD" });
  return z.NEVER;
});

const unsurKurva = z.union([z.number(), z.string(), z.null()]).transform((v, ctx) => {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (s === "") return null;
  if (ANGKA_TEKS.test(s)) return keAngka(s);
  ctx.addIssue({ code: "custom", message: "isi kurva harus angka" });
  return z.NEVER;
});

/** Kurva: array, ATAU teks JSON berisi array (pola `kurva_*_json`). Kosong → []. */
const kurva = z.union([z.array(z.unknown()), z.string(), z.null()]).transform((v, ctx) => {
  let isi: unknown = v;
  if (v === null) return [];
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return [];
    try {
      isi = JSON.parse(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "teks kurva bukan JSON" });
      return z.NEVER;
    }
    if (isi === null) return [];
  }
  const hasil = z.array(unsurKurva).safeParse(isi);
  if (hasil.success) return hasil.data;
  ctx.addIssue({ code: "custom", message: "kurva harus array angka" });
  return z.NEVER;
});

const bentukSarana = z.object({
  id: bulat,
  sarpras_id: bulat,
  nama_sarpras: teksWajib,
  jenis_sarpras: teks,
  nilai: rupiah,
  status: bulat,
  bobot: angka,
  progres: angka,
  realisasi_kumulatif: angka,
});

const sarana = bentukSarana.transform((s, ctx): SaranaKawal => {
  if (s.id === null) {
    ctx.addIssue({ code: "custom", message: "id sarana kosong", path: ["id"] });
    return z.NEVER;
  }
  return {
    kawalItemId: s.id,
    sarprasId: s.sarpras_id,
    nama: s.nama_sarpras,
    jenis: s.jenis_sarpras,
    nilai: s.nilai,
    status: s.status,
    bobot: s.bobot,
    progresPct: s.progres,
    realisasiKumulatif: s.realisasi_kumulatif,
  };
});

const objek = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Nama tipe untuk pesan masalah – tidak pernah nilainya. */
function namaTipe(v: unknown): string {
  if (v === undefined) return "tidak ada";
  if (v === null) return "null";
  if (Array.isArray(v)) return "daftar";
  if (typeof v === "string") return "teks";
  if (typeof v === "number") return "angka";
  if (typeof v === "boolean") return "benar/salah";
  return typeof v === "object" ? "objek" : typeof v;
}

/** Objek berkunci nomor yang semua isinya objek → daftar isinya (urut kunci). */
function objekBernomor(v: unknown): unknown[] | null {
  if (!objek(v)) return null;
  const kunci = Object.keys(v);
  if (!kunci.every((k) => /^\d+$/.test(k))) return null;
  const isi = Object.values(v);
  return isi.every(objek) ? isi : null;
}

/**
 * `sarpras` sebagai daftar mentah. Selain array, diterima tiga bentuk yang
 * ISINYA SAMA (DECISIONS 695) – bukan pelonggaran makna:
 * - objek berkunci nomor (`{"0": {...}, "2": {...}}`): array PHP yang kuncinya
 *   bolong di-encode sebagai objek, khas `filter()` tanpa `values()`;
 * - teks JSON berisi daftar (pola yang sama dengan `kurva_*_json`);
 * - teks kosong = tidak ada sarana, sama dengan null.
 * `null` = tidak ada sarana; `undefined` = bentuk lain (tipe berubah).
 */
export function daftarSarpras(v: unknown): unknown[] | null | undefined {
  if (v === null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    let isi: unknown;
    try {
      isi = JSON.parse(s);
    } catch {
      return undefined;
    }
    if (isi === null) return null;
    return Array.isArray(isi) ? isi : (objekBernomor(isi) ?? undefined);
  }
  return objekBernomor(v) ?? undefined;
}

/** Nilai di dalam `mentah` menurut path masalah zod – untuk menyebut tipenya. */
function nilaiDi(mentah: unknown, path: PropertyKey[]): unknown {
  let v = mentah;
  for (const k of path) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<PropertyKey, unknown>)[k];
  }
  return v;
}

/** Sebab satu masalah: pesan sendiri, atau "tipenya berubah (sekarang …)". */
function sebabMasalah(iss: z.core.$ZodIssue, mentah: unknown): string {
  return iss.code === "custom" ? iss.message : `tipenya berubah (sekarang ${namaTipe(nilaiDi(mentah, iss.path))})`;
}

/**
 * Daftar sarana. Diparse SATU per SATU, bukan lewat `z.union`: union zod
 * melipat semua masalah di dalam daftar menjadi satu "sarpras: tipenya
 * berubah" – nama kosong di satu sarana tidak bisa dibedakan dari bentuk
 * daftar yang berubah (tarikan 2026-10-22 gagal persis begitu).
 */
const daftarSarana = z.unknown().transform((v, ctx): SaranaKawal[] => {
  const daftar = daftarSarpras(v);
  if (daftar === undefined) {
    ctx.addIssue({ code: "custom", message: `tipenya berubah (sekarang ${namaTipe(v)})` });
    return z.NEVER;
  }
  if (daftar === null) return [];
  const hasil: SaranaKawal[] = [];
  let rusak = false;
  daftar.forEach((s, i) => {
    const r = sarana.safeParse(s);
    if (r.success) {
      hasil.push(r.data);
      return;
    }
    rusak = true;
    const id = objek(s) && typeof s.id === "number" ? ` (id ${s.id})` : "";
    for (const iss of r.error.issues) {
      const field = iss.path.map(String).join(".");
      ctx.addIssue({
        code: "custom",
        message: `sarana ke-${i + 1}${id}${field ? `, ${field}` : ""} ${sebabMasalah(iss, s)}`,
      });
    }
  });
  return rusak ? z.NEVER : hasil;
});

const kolomKurva = Object.fromEntries(
  (Object.entries(KURVA_KAWAL) as [NamaKurva, string][]).map(([nama, field]) => [
    field,
    KURVA_WAJIB.has(nama) ? kurva : kurva.optional(),
  ]),
);

/**
 * Satu baris lokasi. `z.object` membuang field yang tidak disebut – itulah
 * pagar data pribadi. Field yang disebut TANPA `.optional()` wajib ADA di
 * respons (boleh kosong).
 */
const bentukBaris = z.object({
  id: bulat,
  nama_knmp: teksWajib,
  desa_kelurahan: teks,
  kecamatan: teks,
  nama_kabupaten: teksWajib,
  nama_provinsi: teks,
  tahap: bulat,
  kategori_knmp: bulat,
  penyedia: teks,
  no_kontrak_penyedia: teks,
  tgl_kontrak_penyedia: tanggal,
  no_spmk_penyedia: teks,
  start_date_penyedia: tanggal,
  end_date_penyedia: tanggal,
  estimasi_pengerjaan: bulat,
  nilai_kontrak_penyedia: rupiah,
  nilai_lokasi: rupiah,
  nilai_add1_kontrak_penyedia: rupiah,
  nilai_add2_kontrak_penyedia: rupiah,
  nilai_add3_kontrak_penyedia: rupiah,
  status_kontrak: teks,
  latitude: angka,
  longitude: angka,
  progres_final: angka,
  progres_pelaksana: angka,
  target_fisik: angka,
  deviasi: angka,
  realisasi_pengawas: angka.optional(),
  realisasi_pelaksana: angka.optional(),
  current_week: bulat,
  max_weeks: bulat,
  last_realisasi_m: bulat,
  last_pelaksana_m: bulat.optional(),
  remark_kondisi_umum: teks,
  remark_hambatan: teks,
  remark_saran_instruksi: teks,
  sarpras: daftarSarana,
  ...kolomKurva,
});

const baris = bentukBaris.transform((b, ctx): BarisKawal => {
  if (b.id === null) {
    ctx.addIssue({ code: "custom", message: "id kosong", path: ["id"] });
    return z.NEVER;
  }
  const k = b as unknown as Record<string, (number | null)[] | undefined>;
  const kurvaBaris = Object.fromEntries(
    (Object.entries(KURVA_KAWAL) as [NamaKurva, string][]).map(([nama, field]) => [nama, k[field] ?? []]),
  ) as Kurva;
  return {
    kawalId: b.id,
    namaKnmp: b.nama_knmp,
    desa: b.desa_kelurahan,
    kecamatan: b.kecamatan,
    kabupaten: b.nama_kabupaten,
    provinsi: b.nama_provinsi,
    tahap: b.tahap,
    kategori: b.kategori_knmp,
    penyedia: b.penyedia,
    noKontrak: b.no_kontrak_penyedia,
    tglKontrak: b.tgl_kontrak_penyedia,
    noSpmk: b.no_spmk_penyedia,
    mulai: b.start_date_penyedia,
    selesai: b.end_date_penyedia,
    estimasiHari: b.estimasi_pengerjaan,
    nilaiKontrak: b.nilai_kontrak_penyedia,
    nilaiLokasi: b.nilai_lokasi,
    nilaiAdd1: b.nilai_add1_kontrak_penyedia,
    nilaiAdd2: b.nilai_add2_kontrak_penyedia,
    nilaiAdd3: b.nilai_add3_kontrak_penyedia,
    statusKontrak: b.status_kontrak,
    latitude: b.latitude,
    longitude: b.longitude,
    actualPct: b.progres_final,
    pelaksanaPct: b.progres_pelaksana,
    targetPct: b.target_fisik,
    deviasiPct: b.deviasi,
    realisasiPengawasPct: b.realisasi_pengawas ?? null,
    realisasiPelaksanaPct: b.realisasi_pelaksana ?? null,
    weekNo: b.current_week,
    maxWeeks: b.max_weeks,
    lastActualWeek: b.last_realisasi_m,
    lastPelaksanaWeek: b.last_pelaksana_m ?? null,
    kurva: kurvaBaris,
    remarkKondisiUmum: b.remark_kondisi_umum,
    remarkHambatan: b.remark_hambatan,
    remarkSaranInstruksi: b.remark_saran_instruksi,
    sarana: b.sarpras,
  };
});

const respons = z.object({ data: z.array(z.unknown()) });

/** Field yang wajib ADA (boleh kosong) – yang menolak `undefined`. */
function fieldWajib(bentuk: z.ZodObject): string[] {
  return Object.entries(bentuk.shape)
    .filter(([, skema]) => !(skema as z.ZodType).safeParse(undefined).success)
    .map(([nama]) => nama);
}
const WAJIB_BARIS = fieldWajib(bentukBaris);
const WAJIB_SARANA = fieldWajib(bentukSarana);

/** Field wajib yang tidak ada di satu baris, termasuk di dalam `sarpras`. */
function fieldHilang(mentah: Record<string, unknown>): string[] {
  const hilang = WAJIB_BARIS.filter((f) => !(f in mentah));
  const sarpras = daftarSarpras(mentah.sarpras);
  if (sarpras) {
    const diSarana = new Set<string>();
    for (const s of sarpras) {
      if (objek(s)) for (const f of WAJIB_SARANA) if (!(f in s)) diSarana.add(`sarpras[].${f}`);
    }
    hilang.push(...diSarana);
  }
  return hilang;
}

export type HasilParse =
  | {
      ok: true;
      baris: BarisKawal[];
      /** Yang diterima dengan penyesuaian (DECISIONS 700) – disebut, tanpa nilainya. */
      catatan: string[];
    }
  | { ok: false; masalah: string[] };

/**
 * `nilai` sarana berupa teks yang bukan rupiah sama sekali → kosong + catatan
 * (DECISIONS 700). Dikerjakan SEBELUM skema ketat, supaya semua field lain –
 * termasuk tipe `nilai` yang berubah jadi objek/daftar – tetap diperiksa
 * seketat biasa. Catatan hanya menyebut letaknya, tidak pernah isinya.
 */
function longgarkanNilaiSarana(
  mentah: Record<string, unknown>,
  label: string,
): { mentah: Record<string, unknown>; catatan: string[] } {
  const daftar = daftarSarpras(mentah.sarpras);
  if (!daftar) return { mentah, catatan: [] };
  const catatan: string[] = [];
  const baru = daftar.map((s, i) => {
    if (!objek(s) || typeof s.nilai !== "string") return s;
    if (s.nilai.trim() === "" || bacaRupiahTeks(s.nilai) !== undefined) return s;
    const id = typeof s.id === "number" ? ` (id ${s.id})` : "";
    catatan.push(`${label}: nilai sarana ke-${i + 1}${id} bukan angka – disimpan kosong.`);
    return { ...s, nilai: null };
  });
  return catatan.length ? { mentah: { ...mentah, sarpras: baru }, catatan } : { mentah, catatan };
}

/** Batas masalah yang dilaporkan – sisanya diringkas jumlahnya. */
const MASALAH_MAKS = 8;

/**
 * Parse seluruh respons. Satu baris saja yang rusak = seluruh tarikan ditolak.
 *
 * Pesan masalah hanya menyebut NOMOR BARIS, id Kawal, dan NAMA field – tidak
 * pernah nilainya, karena pesan ini disimpan dan tampil di layar.
 */
export function parseResponsKawal(body: unknown): HasilParse {
  const atas = respons.safeParse(body);
  if (!atas.success) return { ok: false, masalah: ["Respons Kawal tidak memuat daftar data lokasi."] };

  const hasil: BarisKawal[] = [];
  const masalah: string[] = [];
  const catatan: string[] = [];
  let lebih = 0;
  const catat = (m: string) => {
    if (masalah.length < MASALAH_MAKS) masalah.push(m);
    else lebih++;
  };
  const idTerlihat = new Set<number>();

  atas.data.data.forEach((mentah, i) => {
    const label = `Baris ${i + 1}${objek(mentah) && typeof mentah.id === "number" ? ` (id Kawal ${mentah.id})` : ""}`;
    if (!objek(mentah)) {
      catat(`${label}: bukan data lokasi.`);
      return;
    }
    // Field yang HILANG dilaporkan sebagai hilang, bukan sebagai "tipe salah":
    // keduanya butuh tindakan berbeda dari orang yang membacanya.
    const hilang = fieldHilang(mentah);
    if (hilang.length) {
      catat(`${label}: field ${hilang.join(", ")} tidak ada.`);
      return;
    }
    const longgar = longgarkanNilaiSarana(mentah, label);
    const r = baris.safeParse(longgar.mentah);
    if (!r.success) {
      for (const iss of r.error.issues) {
        const field = iss.path.map(String).join(".") || "(baris)";
        catat(`${label}, field ${field}: ${sebabMasalah(iss, mentah)}.`);
      }
      return;
    }
    if (idTerlihat.has(r.data.kawalId)) {
      catat(`${label}: id Kawal ${r.data.kawalId} muncul dua kali.`);
      return;
    }
    idTerlihat.add(r.data.kawalId);
    hasil.push(r.data);
    catatan.push(...longgar.catatan);
  });
  if (lebih > 0) masalah.push(`…dan ${lebih} masalah lain.`);
  if (masalah.length) return { ok: false, masalah };
  const ringkasCatatan =
    catatan.length > MASALAH_MAKS
      ? [...catatan.slice(0, MASALAH_MAKS), `…dan ${catatan.length - MASALAH_MAKS} catatan lain.`]
      : catatan;
  return { ok: true, baris: hasil, catatan: ringkasCatatan };
}
