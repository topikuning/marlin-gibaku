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

import { bacaRupiahTeks } from "./parser";

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
  // Rupiah bertulisan (`1.250.000`, `Rp 1.250.000,-`) – dibaca parser (DECISIONS 700).
  if (bacaRupiahTeks(s) !== undefined) return "teks rupiah berformat";
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

const objek = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

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

/* ── Hubungan antar angka (DECISIONS 690) ────────────────────────────────── */

export type HubunganAngka = {
  a: string;
  b: string;
  /** Baris yang kedua nilainya terbaca. */
  diperiksa: number;
  /** Baris yang selisihnya ≤ 0,01. */
  sama: number;
};

export type LaporanHubungan = {
  baris: number;
  hubungan: HubunganAngka[];
  /** Kurva yang nilai terakhirnya tidak sama dengan angka mana pun – calon jalur yang belum dikenal (mis. Relatif). */
  kurvaTanpaPadanan: string[];
};

/** Field angka tunggal yang dibandingkan. Semuanya bukan data pribadi. */
const SKALAR_HUBUNGAN = [
  "progres_final",
  "progres_pelaksana",
  "target_fisik",
  "deviasi",
  "realisasi_pengawas",
  "realisasi_pelaksana",
  "current_week",
  "max_weeks",
  "last_realisasi_m",
  "last_pelaksana_m",
  "estimasi_pengerjaan",
] as const;

function angkaLepas(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+([.,]\d+)?$/.test(v.trim())) return Number(v.trim().replace(",", "."));
  return null;
}

function kurvaLepas(v: unknown): (number | null)[] | null {
  let isi = v;
  if (typeof v === "string") {
    try {
      isi = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return Array.isArray(isi) ? isi.map(angkaLepas) : null;
}

/**
 * Besaran turunan satu baris, bertanda sumber dan jenisnya.
 *
 * - `nilai` (persen, rupiah) hanya dibandingkan dengan `nilai`.
 * - `hitungan` (nomor minggu, panjang kurva) hanya dibandingkan dengan
 *   hitungan yang berasal dari FIELD tunggal (current_week, max_weeks, …):
 *   panjang kurva A = panjang kurva B hampir selalu benar dan tidak membuktikan
 *   apa pun, dan pasangan semacam itu menenggelamkan yang penting.
 * - Besaran dari sumber yang sama tidak dibandingkan satu sama lain.
 */
type Besaran = { nama: string; sumber: string; jenis: "nilai" | "hitungan"; dariField: boolean; nilai: number };

const SKALAR_HITUNGAN = new Set<string>([
  "current_week",
  "max_weeks",
  "last_realisasi_m",
  "last_pelaksana_m",
  "estimasi_pengerjaan",
]);

function besaranBaris(b: Record<string, unknown>): Besaran[] {
  const out: Besaran[] = [];
  const tambah = (
    nama: string,
    sumber: string,
    jenis: Besaran["jenis"],
    nilai: number | null | undefined,
    dariField = false,
  ) => {
    if (nilai != null && Number.isFinite(nilai)) out.push({ nama, sumber, jenis, dariField, nilai });
  };
  for (const f of SKALAR_HUBUNGAN) tambah(f, f, SKALAR_HITUNGAN.has(f) ? "hitungan" : "nilai", angkaLepas(b[f]), true);
  const pf = angkaLepas(b.progres_final);
  const pp = angkaLepas(b.progres_pelaksana);
  const tf = angkaLepas(b.target_fisik);
  if (pf != null && tf != null) tambah("progres_final − target_fisik", "selisih_final", "nilai", pf - tf);
  if (pp != null && tf != null) tambah("progres_pelaksana − target_fisik", "selisih_pelaksana", "nilai", pp - tf);
  // Calon "Relatif" (DECISIONS 693): progres RELATIF terhadap rencana minggu ini.
  if (pf != null && tf != null && tf > 0)
    tambah("progres_final ÷ target_fisik × 100", "rasio_final", "nilai", (pf / tf) * 100);
  if (pp != null && tf != null && tf > 0)
    tambah("progres_pelaksana ÷ target_fisik × 100", "rasio_pelaksana", "nilai", (pp / tf) * 100);

  if (Array.isArray(b.sarpras)) {
    let bobot = 0;
    let bp = 0;
    let br = 0;
    let ada = false;
    for (const s of b.sarpras) {
      if (!objek(s)) continue;
      const w = angkaLepas(s.bobot);
      if (w == null) continue;
      ada = true;
      bobot += w;
      bp += (w * (angkaLepas(s.progres) ?? 0)) / 100;
      br += (w * (angkaLepas(s.realisasi_kumulatif) ?? 0)) / 100;
    }
    if (ada) {
      tambah("Σ sarpras.bobot", "sarpras", "nilai", bobot);
      tambah("Σ bobot × progres sarpras ÷ 100", "sarpras", "nilai", bp);
      tambah("Σ bobot × realisasi_kumulatif sarpras ÷ 100", "sarpras", "nilai", br);
      if (bobot > 0) tambah("Σ bobot × progres sarpras ÷ Σ bobot", "sarpras", "nilai", (bp * 100) / bobot);
    }
  }

  const minggu = angkaLepas(b.current_week);
  for (const [nama, v] of Object.entries(b)) {
    if (!nama.startsWith("kurva_")) continue;
    const k = kurvaLepas(v);
    if (!k) continue;
    const terisi = k.filter((x): x is number => x != null);
    tambah(`${nama}: panjang`, nama, "hitungan", k.length);
    tambah(`${nama}: jumlah terisi`, nama, "hitungan", terisi.length);
    if (terisi.length) {
      tambah(`${nama}: nilai terakhir`, nama, "nilai", terisi[terisi.length - 1]);
      tambah(
        `${nama}: jumlah semua nilai`,
        nama,
        "nilai",
        terisi.reduce((s, x) => s + x, 0),
      );
    }
    if (minggu != null && minggu >= 1) {
      tambah(`${nama}[minggu berjalan]`, nama, "nilai", k[minggu - 1] ?? null);
      if (minggu >= 2) tambah(`${nama}[minggu lalu]`, nama, "nilai", k[minggu - 2] ?? null);
    }
  }
  return out;
}

function bolehDibandingkan(x: Besaran, y: Besaran): boolean {
  if (x.sumber === y.sumber || x.jenis !== y.jenis) return false;
  return x.jenis === "nilai" || x.dariField || y.dariField;
}

/**
 * Pasangan besaran yang nilainya SAMA di sebagian besar baris – bukti makna
 * field dari data, bukan dari namanya. Hanya nama dan hitungan yang keluar,
 * tidak pernah nilainya.
 */
export function cekHubunganAngka(body: unknown, opsi: { ambang?: number; maks?: number } = {}): LaporanHubungan {
  const ambang = opsi.ambang ?? 0.6;
  const data = objek(body) && Array.isArray(body.data) ? body.data.filter(objek) : [];
  const perBaris = data.map(besaranBaris);

  // Besaran yang nilainya SAMA di semua baris (mis. kurva adendum yang kosong
  // di semua lokasi) cocok dengan apa saja yang juga konstan – bukan bukti.
  const ragam = new Map<string, Set<number>>();
  for (const bs of perBaris) {
    for (const x of bs) {
      const set = ragam.get(x.nama) ?? new Set<number>();
      set.add(x.nilai);
      ragam.set(x.nama, set);
    }
  }
  const berragam = (nama: string) => (ragam.get(nama)?.size ?? 0) >= 2;

  const hitung = new Map<string, HubunganAngka>();
  for (const besaran of perBaris) {
    const pakai = besaran.filter((x) => berragam(x.nama));
    for (let i = 0; i < pakai.length; i++) {
      for (let j = i + 1; j < pakai.length; j++) {
        const x = pakai[i];
        const y = pakai[j];
        // Nol = nol (kurva kosong, adendum yang tidak ada) bukan bukti apa pun.
        if (!bolehDibandingkan(x, y) || (x.nilai === 0 && y.nilai === 0)) continue;
        const [a, b] = x.nama < y.nama ? [x.nama, y.nama] : [y.nama, x.nama];
        const kunci = `${a}\u0000${b}`;
        const h = hitung.get(kunci) ?? { a, b, diperiksa: 0, sama: 0 };
        h.diperiksa++;
        if (Math.abs(x.nilai - y.nilai) <= 0.01 + 1e-9) h.sama++;
        hitung.set(kunci, h);
      }
    }
  }
  const minimal = Math.max(3, Math.ceil(data.length * 0.3));
  const hubungan = [...hitung.values()]
    .filter((h) => h.diperiksa >= minimal && h.sama / h.diperiksa >= ambang)
    .sort((p, q) => q.sama / q.diperiksa - p.sama / p.diperiksa || q.diperiksa - p.diperiksa || p.a.localeCompare(q.a));

  const namaKurva = new Set(
    perBaris.flatMap((bs) => bs.filter((x) => x.nama.endsWith(": nilai terakhir")).map((x) => x.sumber)),
  );
  const berpadanan = new Set<string>();
  for (const h of hubungan) {
    for (const sisi of [h.a, h.b]) {
      if (sisi.endsWith(": nilai terakhir")) berpadanan.add(sisi.replace(": nilai terakhir", ""));
    }
  }
  return {
    baris: data.length,
    hubungan: hubungan.slice(0, opsi.maks ?? 80),
    kurvaTanpaPadanan: [...namaKurva].filter((k) => !berpadanan.has(k)).sort(),
  };
}
