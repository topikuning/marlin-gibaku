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

/** Rupiah: dibulatkan ke rupiah utuh, disimpan BigInt. */
const rupiah = angka.transform((v) => (v === null ? null : BigInt(Math.round(v))));

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
  sarpras: z.union([z.array(sarana), z.null()]),
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
    sarana: b.sarpras ?? [],
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

const objek = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Field wajib yang tidak ada di satu baris, termasuk di dalam `sarpras`. */
function fieldHilang(mentah: Record<string, unknown>): string[] {
  const hilang = WAJIB_BARIS.filter((f) => !(f in mentah));
  if (Array.isArray(mentah.sarpras)) {
    const diSarana = new Set<string>();
    for (const s of mentah.sarpras) {
      if (objek(s)) for (const f of WAJIB_SARANA) if (!(f in s)) diSarana.add(`sarpras[].${f}`);
    }
    hilang.push(...diSarana);
  }
  return hilang;
}

export type HasilParse = { ok: true; baris: BarisKawal[] } | { ok: false; masalah: string[] };

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
    const r = baris.safeParse(mentah);
    if (!r.success) {
      for (const iss of r.error.issues) {
        const field = iss.path.map(String).join(".") || "(baris)";
        const sebab = iss.code === "custom" ? iss.message : "tipenya berubah";
        catat(`${label}, field ${field}: ${sebab}.`);
      }
      return;
    }
    if (idTerlihat.has(r.data.kawalId)) {
      catat(`${label}: id Kawal ${r.data.kawalId} muncul dua kali.`);
      return;
    }
    idTerlihat.add(r.data.kawalId);
    hasil.push(r.data);
  });
  if (lebih > 0) masalah.push(`…dan ${lebih} masalah lain.`);
  return masalah.length ? { ok: false, masalah } : { ok: true, baris: hasil };
}
