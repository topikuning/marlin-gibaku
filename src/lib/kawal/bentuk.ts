/**
 * PETA BENTUK DATA KAWAL KNMP – tanpa nilai (DECISIONS 689).
 *
 * Endpoint `/api/knmp/locations` tidak terdokumentasi. Sebelum parser yang
 * ketat ditulis, bentuknya dibuktikan dari respons sungguhan lewat tombol
 * "Uji sambungan" – dan yang dilaporkan HANYA nama field, tipe, dan hitungan.
 * Nilai tidak pernah keluar dari fungsi ini: respons Kawal memuat nomor HP dan
 * nama personel, dan laporan uji ini tampil di layar.
 *
 * Murni, tanpa jaringan.
 */

/** Field yang akan dipakai sinkron (brief 2026-10-18). Sisanya dibuang saat parse. */
export const FIELD_DIPAKAI = [
  "id",
  "nama_knmp",
  "desa_kelurahan",
  "kecamatan",
  "nama_kabupaten",
  "nama_provinsi",
  "tahap",
  "kategori_knmp",
  "penyedia",
  "no_kontrak_penyedia",
  "tgl_kontrak_penyedia",
  "no_spmk_penyedia",
  "start_date_penyedia",
  "end_date_penyedia",
  "estimasi_pengerjaan",
  "nilai_kontrak_penyedia",
  "nilai_lokasi",
  "nilai_add1_kontrak_penyedia",
  "nilai_add2_kontrak_penyedia",
  "nilai_add3_kontrak_penyedia",
  "status_kontrak",
  "latitude",
  "longitude",
  "progres_final",
  "progres_pelaksana",
  "target_fisik",
  "deviasi",
  "current_week",
  "max_weeks",
  "last_realisasi_m",
  "kurva_rencana_kumulatif",
  "kurva_realisasi_kumulatif",
  "kurva_pelaksana_kumulatif",
  "remark_kondisi_umum",
  "remark_hambatan",
  "remark_saran_instruksi",
  "sarpras",
] as const;

/** Field kurva mingguan (`kurva_*_mingguan`) ikut dipakai, namanya belum pasti. */
export const POLA_KURVA_MINGGUAN = /^kurva_.+_mingguan$/;

/** Nama field yang kemungkinan memuat jalur "Relatif" (Wakil Sah / Penyuluh). */
const POLA_RELATIF = /relatif|penyuluh|wakil/i;

export type HitungTipe = { tipe: string; jumlah: number };
export type BentukField = { nama: string; diisi: number; tipe: HitungTipe[] };

export type BentukData = {
  /** Kunci tingkat atas beserta tipenya, mis. status/count/data. */
  atas: { nama: string; tipe: string }[];
  /** Null bila `data` bukan array. */
  jumlahBaris: number | null;
  field: BentukField[];
  /** Isi array-objek (mis. `sarpras`), per nama field induk. */
  anak: Record<string, BentukField[]>;
  dipakaiHilang: string[];
  kurvaMingguan: string[];
  kandidatRelatif: string[];
};

/** Label tipe SATU nilai – tidak pernah memuat nilainya. */
export function tipeNilai(v: unknown): string {
  if (v === null || v === undefined) return "kosong";
  if (typeof v === "number") return Number.isFinite(v) ? "angka" : "angka tidak sah";
  if (typeof v === "boolean") return "ya/tidak";
  if (Array.isArray(v)) {
    if (v.length === 0) return "array kosong";
    if (v.every((x) => typeof x === "number")) return "array angka";
    if (v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))) return "array objek";
    if (v.every((x) => typeof x === "string")) return "array teks";
    return "array campuran";
  }
  if (typeof v === "object") return "objek";
  if (typeof v !== "string") return typeof v;
  const s = v.trim();
  if (s === "") return "teks kosong";
  if (/^-?\d+([.,]\d+)?$/.test(s)) return "teks angka";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return "teks tanggal (YYYY-MM-DD)";
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(s)) return "teks tanggal (DD/MM/YYYY)";
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      return `teks JSON: ${tipeNilai(JSON.parse(s))}`;
    } catch {
      return "teks berawalan [ atau { (bukan JSON sah)";
    }
  }
  if (/^-?\d+([.]\d+)?(\s*,\s*-?\d+([.]\d+)?)+$/.test(s)) return "teks daftar angka dipisah koma";
  return "teks";
}

function ringkasField(baris: Record<string, unknown>[]): BentukField[] {
  const peta = new Map<string, { diisi: number; tipe: Map<string, number> }>();
  for (const b of baris) {
    for (const [nama, v] of Object.entries(b)) {
      const f = peta.get(nama) ?? { diisi: 0, tipe: new Map<string, number>() };
      const t = tipeNilai(v);
      if (t !== "kosong" && t !== "teks kosong") f.diisi++;
      f.tipe.set(t, (f.tipe.get(t) ?? 0) + 1);
      peta.set(nama, f);
    }
  }
  return [...peta.entries()]
    .map(([nama, f]) => ({
      nama,
      diisi: f.diisi,
      tipe: [...f.tipe.entries()].map(([tipe, jumlah]) => ({ tipe, jumlah })).sort((a, b) => b.jumlah - a.jumlah),
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama));
}

const objek = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Peta bentuk respons Kawal. Tidak melempar; bentuk yang aneh dilaporkan apa adanya. */
export function petakanBentuk(body: unknown): BentukData {
  const atas = objek(body)
    ? Object.entries(body).map(([nama, v]) => ({ nama, tipe: tipeNilai(v) }))
    : [{ nama: "(akar)", tipe: tipeNilai(body) }];
  const data = objek(body) && Array.isArray(body.data) ? body.data : null;
  const baris = (data ?? []).filter(objek);
  const field = ringkasField(baris);

  const anak: Record<string, BentukField[]> = {};
  for (const f of field) {
    if (!f.tipe.some((t) => t.tipe === "array objek")) continue;
    const isi = baris.flatMap((b) => (Array.isArray(b[f.nama]) ? (b[f.nama] as unknown[]) : [])).filter(objek);
    anak[f.nama] = ringkasField(isi);
  }

  const ada = new Set(field.map((f) => f.nama));
  return {
    atas,
    jumlahBaris: data ? data.length : null,
    field,
    anak,
    dipakaiHilang: FIELD_DIPAKAI.filter((n) => !ada.has(n)),
    kurvaMingguan: field.map((f) => f.nama).filter((n) => POLA_KURVA_MINGGUAN.test(n)),
    kandidatRelatif: field.map((f) => f.nama).filter((n) => POLA_RELATIF.test(n)),
  };
}

function tanggalIso(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function angka(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Cocokkah `current_week` dengan "minggu ke-N = 7 hari sejak start_date"?
 * Hasilnya sebaran selisih (current_week − minggu menurut rumus) per baris,
 * dihitung terhadap `hariIni` (tanggal Jakarta, tengah malam UTC). Ini yang
 * menentukan tanggal pembanding di sisi MARLIN; tidak boleh ditebak.
 */
export function cekPenanggalanMinggu(
  body: unknown,
  hariIni: Date,
): { diperiksa: number; tanpaData: number; selisih: { selisih: number; jumlah: number }[] } {
  const data = objek(body) && Array.isArray(body.data) ? body.data.filter(objek) : [];
  const sebaran = new Map<number, number>();
  let tanpaData = 0;
  for (const b of data) {
    const mulai = tanggalIso(b.start_date_penyedia);
    const minggu = angka(b.current_week);
    if (!mulai || minggu == null) {
      tanpaData++;
      continue;
    }
    const hari = Math.floor((hariIni.getTime() - mulai.getTime()) / 86_400_000);
    const menurutRumus = Math.floor(hari / 7) + 1;
    const s = minggu - menurutRumus;
    sebaran.set(s, (sebaran.get(s) ?? 0) + 1);
  }
  return {
    diperiksa: data.length - tanpaData,
    tanpaData,
    selisih: [...sebaran.entries()]
      .map(([selisih, jumlah]) => ({ selisih, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
  };
}
