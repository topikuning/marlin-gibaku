/**
 * Pembaca berkas master AHSP (SE DJBK 47/2026) — MURNI, tanpa db.
 *
 * Berkasnya membawa panduan pemakaiannya sendiri (`ai_usage_guide`), dan
 * beberapa aturannya diterjemahkan langsung jadi bentuk data di sini:
 *
 *  - **Kunci alami = `id`, bukan `kode`.** Berkas resminya memuat kode duplikat
 *    (beberapa analisa berbagi kode dengan uraian/satuan berbeda), dan
 *    panduannya menyuruh memakai id + uraian + satuan. Memakai kode sebagai
 *    kunci akan menggabungkan analisa yang sebenarnya berbeda.
 *  - **`supplemental_records` ditandai `perluVerifikasi`.** Panduannya: "hanya
 *    boleh dipakai sebagai referensi tambahan … dan harus diberi peringatan
 *    verifikasi". Menyimpannya bercampur tanpa penanda akan menghapus peringatan
 *    itu diam-diam.
 *  - **Rujukan halaman ikut disimpan.** Koefisien tanpa jejak ke halaman
 *    dokumen resminya tidak bisa dipertanggungjawabkan saat diperiksa auditor.
 *  - **Koefisien TIDAK dikarang.** 433 analisa resmi belum punya komponen
 *    terstruktur; semuanya membawa `analysis_excerpt_id`. Yang begini disimpan
 *    TANPA komponen dan ditandai lewat `excerptId` — bukan diisi angka tebakan.
 *  - **Lapisan pencocokan ikut dibaca** (skema 2.1.0, DECISIONS 321):
 *    `search.aliases` + `search.keywords` per analisa, dan `matching_engine`
 *    milik berkas. Aturan padanan istilah ("pembesian = penulangan = besi
 *    beton") datang DARI berkasnya, bukan dikarang MARLIN — jadi ia ikut
 *    berganti saat berkasnya diperbarui, dan bisa ditelusuri ke sumbernya.
 *
 * DECISIONS 317, 321.
 */

export type KomponenAhsp = {
  kategori: "upah" | "bahan" | "alat";
  nama: string;
  satuan: string | null;
  koefisien: number;
  urutan: number;
};

export type EntriAhsp = {
  externalId: string;
  kode: string;
  uraian: string;
  satuan: string;
  bidang: string;
  ahspType: string;
  workGroup: string | null;
  divisi: string | null;
  notes: string | null;
  perluVerifikasi: boolean;
  lampiran: string | null;
  tocPdfPage: number | null;
  analysisPdfPage: number | null;
  excerptId: string | null;
  /** `legacy.id` — id analisa yang sama pada terbitan sebelumnya (DECISIONS 323). */
  legacyId: string | null;
  /** `search.aliases` — istilah lapangan yang menunjuk pekerjaan ini. */
  aliases: string[];
  /** `search.keywords` — kata kunci yang sudah dipecah oleh berkasnya. */
  keywords: string[];
  components: KomponenAhsp[];
};

export type SumberAhsp = {
  code: string;
  name: string;
  subject: string | null;
  schemaVersion: string;
  generatedAt: Date;
  documents: unknown;
  /**
   * `matching_engine` apa adanya: padanan istilah, aturan normalisasi, aturan
   * penulangan, dan panduan skor. Disimpan supaya aturan pencocokan selalu
   * seumur dengan berkas koefisiennya — bukan aturan MARLIN yang menua sendiri.
   */
  matchingEngine: unknown;
};

export type MasterAhsp = {
  sumber: SumberAhsp;
  entries: EntriAhsp[];
  /** Angka yang dilaporkan ke user setelah impor — bukan tebakan, hasil hitung. */
  ringkas: {
    total: number;
    kanonik: number;
    perluVerifikasi: number;
    tanpaKomponen: number;
    /** Berapa analisa yang membawa lapisan pencocokan dari berkasnya. */
    punyaAlias: number;
    komponen: { upah: number; bahan: number; alat: number };
    bidang: Record<string, number>;
  };
};

export class AhspParseError extends Error {}

const KATEGORI = new Set(["upah", "bahan", "alat"]);

function teks(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function bilangan(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Daftar string dari berkas, dibersihkan tanpa menambah apa pun. */
function daftarTeks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = teks(x);
    if (t) out.push(t);
  }
  return [...new Set(out)];
}

function bacaKomponen(raw: unknown, urutanCadangan: number): KomponenAhsp | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const kategori = teks(o.kategori);
  const nama = teks(o.nama_material);
  const koef = bilangan(o.koefisien);
  // Komponen tanpa kategori/nama/koefisien tidak bisa dipakai menghitung apa
  // pun. Dibuang di sini, dan jumlah yang dibuang ikut dilaporkan — bukan
  // diselundupkan sebagai baris berkoefisien 0.
  if (!kategori || !KATEGORI.has(kategori) || !nama || koef === null) return null;
  return {
    kategori: kategori as KomponenAhsp["kategori"],
    nama,
    satuan: teks(o.satuan),
    koefisien: koef,
    urutan: bilangan(o.urutan) ?? urutanCadangan,
  };
}

function bacaEntri(raw: unknown, perluVerifikasi: boolean): EntriAhsp | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const externalId = teks(o.id);
  const uraian = teks(o.uraian);
  if (!externalId || !uraian) return null;

  const src = (typeof o.source === "object" && o.source !== null ? o.source : {}) as Record<
    string,
    unknown
  >;
  // `search` hanya ada pada records kanonik; supplemental memang tidak punya
  // dan itu dibiarkan kosong, bukan ditambal dari uraiannya sendiri.
  const cari = (typeof o.search === "object" && o.search !== null ? o.search : {}) as Record<
    string,
    unknown
  >;
  // `legacy` = jejak ke terbitan sebelumnya. Inilah yang memungkinkan padanan
  // manusia tetap tersambung saat basis AHSP diganti (DECISIONS 323); berkas
  // supplemental memakai `legacy_id` datar.
  const lawas = (typeof o.legacy === "object" && o.legacy !== null
    ? (o.legacy as Record<string, unknown>)
    : { id: o.legacy_id }) as Record<string, unknown>;
  const komponenMentah = Array.isArray(o.components) ? o.components : [];
  const components = komponenMentah
    .map((c, i) => bacaKomponen(c, i + 1))
    .filter((c): c is KomponenAhsp => c !== null);

  return {
    externalId,
    kode: teks(o.kode) ?? "—",
    uraian,
    // Satuan "-" dipakai berkas master sebagai penanda "tidak terbaca";
    // dipertahankan apa adanya supaya pembaca tahu itu memang belum pasti.
    satuan: teks(o.satuan) ?? "—",
    bidang: teks(o.bidang) ?? "lainnya",
    ahspType: teks(o.ahsp_type) ?? "—",
    workGroup: teks(o.work_group),
    divisi: teks(o.divisi),
    notes: teks(o.notes),
    perluVerifikasi,
    legacyId: teks(lawas.id),
    aliases: daftarTeks(cari.aliases),
    keywords: daftarTeks(cari.keywords),
    lampiran: teks(src.lampiran),
    tocPdfPage: bilangan(src.toc_pdf_page),
    analysisPdfPage: bilangan(src.analysis_pdf_page),
    excerptId: teks(src.analysis_excerpt_id),
    components,
  };
}

/**
 * Baca berkas master jadi bentuk siap simpan.
 *
 * `code` sumber tidak ada di berkasnya — pemanggil yang menentukan, karena
 * itulah kunci idempoten impor ulang.
 */
export function bacaMasterAhsp(raw: unknown, code: string): MasterAhsp {
  if (typeof raw !== "object" || raw === null) {
    throw new AhspParseError("Berkas AHSP bukan objek JSON.");
  }
  const o = raw as Record<string, unknown>;
  const meta = (typeof o.metadata === "object" && o.metadata !== null ? o.metadata : {}) as Record<
    string,
    unknown
  >;
  const reg = (typeof meta.source_regulation === "object" && meta.source_regulation !== null
    ? meta.source_regulation
    : {}) as Record<string, unknown>;

  const recs = Array.isArray(o.records) ? o.records : [];
  const supp = Array.isArray(o.supplemental_records) ? o.supplemental_records : [];
  if (recs.length === 0) {
    throw new AhspParseError("Berkas AHSP tidak memuat `records` — tidak ada yang bisa diimpor.");
  }

  const entries = [
    ...recs.map((r) => bacaEntri(r, false)),
    ...supp.map((r) => bacaEntri(r, true)),
  ].filter((e): e is EntriAhsp => e !== null);

  // Kunci ganda dibuang, yang PERTAMA menang (records sebelum supplemental):
  // baris kanonik tidak boleh kalah oleh baris yang butuh verifikasi.
  const terlihat = new Set<string>();
  const unik: EntriAhsp[] = [];
  for (const e of entries) {
    if (terlihat.has(e.externalId)) continue;
    terlihat.add(e.externalId);
    unik.push(e);
  }

  const komponen = { upah: 0, bahan: 0, alat: 0 };
  const bidang: Record<string, number> = {};
  let tanpaKomponen = 0;
  for (const e of unik) {
    bidang[e.bidang] = (bidang[e.bidang] ?? 0) + 1;
    if (e.components.length === 0) tanpaKomponen += 1;
    for (const c of e.components) komponen[c.kategori] += 1;
  }

  const dibangkitkan = teks(meta.generated_at);
  const waktu = dibangkitkan ? new Date(dibangkitkan) : new Date(NaN);

  return {
    sumber: {
      code,
      name: teks(reg.name) ?? teks(meta.title) ?? code,
      subject: teks(reg.subject),
      schemaVersion: teks(meta.schema_version) ?? "—",
      generatedAt: Number.isNaN(waktu.getTime()) ? new Date() : waktu,
      documents: meta.source_documents ?? {},
      matchingEngine: o.matching_engine ?? null,
    },
    entries: unik,
    ringkas: {
      total: unik.length,
      kanonik: unik.filter((e) => !e.perluVerifikasi).length,
      perluVerifikasi: unik.filter((e) => e.perluVerifikasi).length,
      tanpaKomponen,
      punyaAlias: unik.filter((e) => e.aliases.length > 0).length,
      komponen,
      bidang,
    },
  };
}
