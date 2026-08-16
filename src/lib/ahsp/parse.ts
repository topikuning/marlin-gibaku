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
 *  - **Koefisien TIDAK dikarang.** 435 analisa resmi belum punya komponen
 *    terstruktur; semuanya membawa `analysis_excerpt_id`. Yang begini disimpan
 *    TANPA komponen dan ditandai lewat `excerptId` — bukan diisi angka tebakan.
 *
 * DECISIONS 317.
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
  components: KomponenAhsp[];
};

export type SumberAhsp = {
  code: string;
  name: string;
  subject: string | null;
  schemaVersion: string;
  generatedAt: Date;
  documents: unknown;
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
    },
    entries: unik,
    ringkas: {
      total: unik.length,
      kanonik: unik.filter((e) => !e.perluVerifikasi).length,
      perluVerifikasi: unik.filter((e) => e.perluVerifikasi).length,
      tanpaKomponen,
      komponen,
      bidang,
    },
  };
}
