import type { DailyReportStatus } from "@/generated/prisma/enums";
import {
  TAMPIL_STATUS,
  lolosSaringHarian,
  type Nada,
  type SaringHarian,
} from "./hari-ini-ringkas";

/**
 * KALENDER PELAKSANAAN HARIAN — MURNI, tanpa I/O dan tanpa React
 * (DECISIONS 340).
 *
 * Halaman ini dulu hanya menampilkan **14 hari terakhir**. Untuk kontrak 22
 * minggu itu berarti 90% riwayatnya tidak punya alamat sama sekali: tanggal
 * yang terlewat bulan lalu tidak bisa ditemukan, tidak bisa ditambal, dan tidak
 * bisa dibuktikan pernah kosong. Permintaan user 2026-08-17: kalender, dan
 * *"tujuan utamanya, agar tidak hanya menampilkan 14 hari terakhir"*.
 *
 * ### Kosong itu ada TIGA macam — dan menyatukannya membuat kalender berbohong
 *
 * Selama jendelanya cuma 14 hari, "tidak ada laporan" hampir selalu berarti
 * satu hal: ada yang lalai. Begitu jendelanya seluruh kontrak, arti itu pecah:
 *
 * - **kosong** — dalam masa kontrak, harinya sudah lewat, laporannya tidak ada.
 *   INI satu-satunya yang berarti "ada yang harus ditambal".
 * - **luar_kontrak** — sebelum SPMK atau sesudah masa kontrak berakhir. Tidak
 *   ada yang lalai; pekerjaannya memang belum/tidak boleh berjalan. Ini
 *   penerusan aturan yang sama dengan minggu 0 pada kurva-S (DECISIONS 202).
 * - **belum_tiba** — hari yang belum terjadi.
 *
 * Kalau ketiganya dicat sama, membuka bulan depan menampilkan 30 hari "belum
 * ada laporan" — angka yang menakutkan, salah, dan tidak bisa ditindaklanjuti.
 * Karena itu **penyebut ringkasan hanya menghitung `kosong` + `ada`**: hari
 * yang belum boleh atau belum bisa dilaporkan tidak pernah menjadi bagian dari
 * "sekian dari sekian".
 *
 * ### Status TIDAK PERNAH hanya warna
 *
 * Kosakata status dipinjam UTUH dari `hari-ini-ringkas.ts` (`TAMPIL_STATUS`),
 * bukan ditulis ulang. Dua kosakata untuk satu status adalah cara paling mudah
 * membuat strip 7 hari dan kalender menyebut hal yang sama dengan kata yang
 * berbeda — dan tidak ada yang akan menyadarinya sampai seseorang
 * membandingkan dua layar.
 */

/** Kunci bulan "YYYY-MM". */
export type BulanKey = string;

export type KeadaanHari = "ada" | "kosong" | "luar_kontrak" | "belum_tiba";

export type SelKalender = {
  dateKey: string;
  /** Tanggal 1..31 untuk dicetak di sel. */
  tanggal: number;
  /** false = hari titipan dari bulan tetangga (pengisi baris). */
  bulanIni: boolean;
  keadaan: KeadaanHari;
  status: DailyReportStatus | null;
  itemCount: number;
  fotoCount: number;
  /** Kata pendek — dibaca, bukan ditebak dari warna. */
  kata: string;
  /**
   * Kata SANGAT pendek (≤7 huruf) untuk sel sempit di ponsel.
   *
   * Sengaja tetap KATA, bukan huruf tunggal: di layar 390px satu sel selebar
   * ±44px, dan "·" untuk *di luar kontrak* maupun *belum tiba* membuat dua
   * fakta berbeda tampil identik — persis kegagalan yang dilarang aturan
   * "status tidak pernah hanya warna". Seluruh nilainya wajib berbeda.
   */
  singkat: string;
  nada: Nada;
  hariIni: boolean;
};

export type DataHari = {
  status: DailyReportStatus | null;
  itemCount: number;
  fotoCount: number;
};

const KOSONG_TAMPIL: Record<
  Exclude<KeadaanHari, "ada">,
  { kata: string; singkat: string; nada: Nada }
> = {
  kosong: { kata: "Belum ada", singkat: "Belum", nada: "neutral" },
  // Bukan kelalaian: pekerjaannya memang belum/tidak boleh berjalan.
  luar_kontrak: { kata: "Di luar kontrak", singkat: "Luar", nada: "neutral" },
  belum_tiba: { kata: "Belum tiba", singkat: "Nanti", nada: "neutral" },
};

/** Seluruh kata pendek berbeda — dijamin di sini, bukan diandalkan penulisnya. */
export function singkatUnik(): boolean {
  const semua = [
    ...Object.values(TAMPIL_STATUS).map((t) => t.kata),
    ...Object.values(KOSONG_TAMPIL).map((t) => t.singkat),
  ];
  return new Set(semua).size === semua.length;
}

/* ------------------------------------------------------------------ */
/* Aritmetika tanggal — UTC murni, TIDAK PERNAH zona waktu mesin        */
/* ------------------------------------------------------------------ */

/**
 * Seluruh berkas ini bekerja pada string "YYYY-MM-DD" dan `Date.UTC`.
 *
 * Memakai `new Date("2026-08-01")` lalu `getDate()` membaca tanggalnya di zona
 * MESIN: di server UTC hasilnya benar, di laptop WIB juga benar, tetapi di zona
 * barat (mis. runner CI di UTC−7) tanggal 1 terbaca 31 — kalendernya bergeser
 * satu hari penuh tanpa galat apa pun. Cacat itu tidak akan pernah terlihat
 * dari Jakarta.
 */
function bagi(dateKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateKey.split("-").map((v) => Number.parseInt(v, 10));
  return { y, m, d };
}

function kunci(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Bulan dari sebuah dateKey ("2026-08-17" → "2026-08"). */
export function bulanDari(dateKey: string): BulanKey {
  return dateKey.slice(0, 7);
}

/** Geser bulan sebanyak `delta` (boleh negatif); melewati batas tahun dengan benar. */
export function geserBulan(bulan: BulanKey, delta: number): BulanKey {
  const [y, m] = bulan.split("-").map((v) => Number.parseInt(v, 10));
  const total = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Jumlah hari dalam bulan — lewat UTC, jadi tahun kabisat ikut benar. */
export function jumlahHari(bulan: BulanKey): number {
  const [y, m] = bulan.split("-").map((v) => Number.parseInt(v, 10));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Indeks kolom hari pertama bulan, **Senin = 0**.
 *
 * `getUTCDay()` memakai Minggu = 0. Menyalinnya apa adanya menggeser seluruh
 * kalender satu kolom — setiap tanggal jatuh di hari yang salah, dan tidak ada
 * galat yang terbit. Pergeseran itu baru ketahuan kalau ada yang mencocokkan
 * tanggal dengan nama harinya.
 */
export function offsetSenin(bulan: BulanKey): number {
  const [y, m] = bulan.split("-").map((v) => Number.parseInt(v, 10));
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

export const NAMA_HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

export function judulBulan(bulan: BulanKey): string {
  const [y, m] = bulan.split("-").map((v) => Number.parseInt(v, 10));
  return `${NAMA_BULAN[m - 1]} ${y}`;
}

/* ------------------------------------------------------------------ */
/* Batas navigasi                                                      */
/* ------------------------------------------------------------------ */

export type BatasBulan = { min: BulanKey; max: BulanKey };

/**
 * Bulan terjauh yang boleh dijangkau tombol ‹ dan ›.
 *
 * Invarian yang harus dijaga: **setiap bulan yang memuat data WAJIB terjangkau**
 * — itu justru seluruh alasan halaman ini diubah. Batas yang terlalu ketat
 * mengembalikan cacat yang sedang diperbaiki, hanya dengan bentuk yang lebih
 * meyakinkan: kalendernya terlihat lengkap, padahal riwayatnya terpotong.
 *
 * Karena itu batasnya adalah gabungan, bukan hanya masa kontrak:
 *   min = paling awal dari (mulai kontrak, laporan paling lama)
 *   max = paling akhir dari (bulan ini, laporan paling baru)
 *
 * Laporan di luar masa kontrak memang tidak semestinya ada, tapi impor rekap
 * Excel bisa menghasilkannya. Data yang terlanjur ada harus bisa DILIHAT untuk
 * bisa diperbaiki; menyembunyikannya hanya membuat kesalahannya awet.
 */
export function batasBulan(opts: {
  hariIniKey: string;
  mulaiKontrak: string | null;
  laporanPertama: string | null;
  laporanTerakhir: string | null;
}): BatasBulan {
  const ini = bulanDari(opts.hariIniKey);
  const kandidatMin = [opts.mulaiKontrak, opts.laporanPertama]
    .filter((v): v is string => !!v)
    .map(bulanDari);
  const kandidatMax = [opts.laporanTerakhir].filter((v): v is string => !!v).map(bulanDari);
  const min = [...kandidatMin, ini].reduce((a, b) => (a < b ? a : b));
  const max = [...kandidatMax, ini].reduce((a, b) => (a > b ? a : b));
  // Data yang lebih tua dari batas bawah tetap menang: min tidak boleh > max.
  return { min: min < max ? min : max, max };
}

/** Jepit bulan ke dalam batas — nilai di luar batas TIDAK menghasilkan galat. */
export function jepitBulan(bulan: BulanKey, batas: BatasBulan): BulanKey {
  if (bulan < batas.min) return batas.min;
  if (bulan > batas.max) return batas.max;
  return bulan;
}

/** Baca "?bulan=" dari URL; bentuk tak sah jatuh ke `fallback`, bukan galat. */
export function bacaBulan(raw: string | undefined, fallback: BulanKey): BulanKey {
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return fallback;
  return raw;
}

/* ------------------------------------------------------------------ */
/* Penyusun kalender                                                   */
/* ------------------------------------------------------------------ */

function keadaanHari(opts: {
  dateKey: string;
  ada: boolean;
  hariIniKey: string;
  mulaiKontrak: string | null;
  akhirKontrak: string | null;
}): KeadaanHari {
  if (opts.ada) return "ada";
  // Urutannya penting: laporan yang TERLANJUR ADA di luar masa kontrak tetap
  // ditampilkan sebagai "ada" (dicek di atas) supaya bisa diperbaiki.
  if (opts.mulaiKontrak && opts.dateKey < opts.mulaiKontrak) return "luar_kontrak";
  if (opts.akhirKontrak && opts.dateKey > opts.akhirKontrak) return "luar_kontrak";
  if (opts.dateKey > opts.hariIniKey) return "belum_tiba";
  return "kosong";
}

/**
 * Susun sel satu bulan, Senin di kolom pertama, lengkap dengan hari titipan
 * dari bulan tetangga supaya barisnya rata.
 *
 * Selalu mengembalikan kelipatan 7 sel.
 */
export function susunKalender(opts: {
  bulan: BulanKey;
  hariIniKey: string;
  mulaiKontrak: string | null;
  akhirKontrak: string | null;
  data: ReadonlyMap<string, DataHari>;
}): SelKalender[] {
  const [y, m] = opts.bulan.split("-").map((v) => Number.parseInt(v, 10));
  const hari = jumlahHari(opts.bulan);
  const depan = offsetSenin(opts.bulan);

  const sel: SelKalender[] = [];

  const titipan = (bulan: BulanKey, tanggal: number): SelKalender => {
    const { y: ty, m: tm } = bagi(`${bulan}-01`);
    const dateKey = kunci(ty, tm, tanggal);
    return {
      dateKey,
      tanggal,
      bulanIni: false,
      keadaan: "luar_kontrak",
      status: null,
      itemCount: 0,
      fotoCount: 0,
      kata: "",
      singkat: "",
      nada: "neutral",
      hariIni: false,
    };
  };

  const sebelum = geserBulan(opts.bulan, -1);
  const hariSebelum = jumlahHari(sebelum);
  for (let i = depan; i > 0; i--) sel.push(titipan(sebelum, hariSebelum - i + 1));

  for (let d = 1; d <= hari; d++) {
    const dateKey = kunci(y, m, d);
    const isi = opts.data.get(dateKey);
    const keadaan = keadaanHari({
      dateKey,
      ada: !!isi,
      hariIniKey: opts.hariIniKey,
      mulaiKontrak: opts.mulaiKontrak,
      akhirKontrak: opts.akhirKontrak,
    });
    // Kosakata dipinjam utuh dari strip 7 hari — bukan ditulis ulang.
    const t = isi?.status ? TAMPIL_STATUS[isi.status] : KOSONG_TAMPIL[keadaan as Exclude<KeadaanHari, "ada">];
    sel.push({
      dateKey,
      tanggal: d,
      bulanIni: true,
      keadaan,
      status: isi?.status ?? null,
      itemCount: isi?.itemCount ?? 0,
      fotoCount: isi?.fotoCount ?? 0,
      kata: t.kata,
      // Untuk status, kata pendeknya SUDAH pendek (Final/Setuju/Kirim/…).
      singkat: "singkat" in t ? t.singkat : t.kata,
      nada: t.nada,
      hariIni: dateKey === opts.hariIniKey,
    });
  }

  const sesudah = geserBulan(opts.bulan, 1);
  let n = 1;
  while (sel.length % 7 !== 0) sel.push(titipan(sesudah, n++));
  return sel;
}

/**
 * Bentuk DAFTAR: seluruh rentang yang terjangkau, bukan satu bulan.
 *
 * Inilah jawaban paling langsung atas *"jangan hanya 14 hari terakhir"* —
 * kalender menunjukkan satu bulan dengan enak dipindai, daftar menunjukkan
 * SELURUHNYA sekaligus dan bisa diurut/disaring.
 *
 * Dua jenis baris sengaja DIBUANG karena hanya menjadi kebisingan:
 *
 * - hari yang **belum tiba** — tidak ada yang bisa dilakukan padanya;
 * - hari **di luar masa kontrak yang memang kosong** — bukan kelalaian.
 *
 * Hari di luar kontrak yang TERLANJUR punya laporan tetap ikut: data yang salah
 * harus terlihat untuk bisa diperbaiki. Jumlah yang dibuang dikembalikan supaya
 * UI bisa menyebutnya — daftar yang dipangkas diam-diam terbaca sebagai daftar
 * lengkap.
 */
export function susunDaftar(opts: {
  min: BulanKey;
  max: BulanKey;
  hariIniKey: string;
  mulaiKontrak: string | null;
  akhirKontrak: string | null;
  data: ReadonlyMap<string, DataHari>;
}): { baris: SelKalender[]; disembunyikan: number } {
  const baris: SelKalender[] = [];
  let disembunyikan = 0;
  // Batas keras: kalau min/max ternyata terbalik atau jaraknya tak masuk akal,
  // berhenti — halaman tidak boleh menggantung karena satu tanggal aneh.
  for (let b = opts.min, n = 0; b <= opts.max && n < 240; b = geserBulan(b, 1), n++) {
    for (const s of susunKalender({ ...opts, bulan: b })) {
      if (!s.bulanIni) continue;
      if (s.keadaan === "belum_tiba" || (s.keadaan === "luar_kontrak" && !s.status)) {
        disembunyikan += 1;
        continue;
      }
      baris.push(s);
    }
  }
  return { baris, disembunyikan };
}

/**
 * Apakah sel ini lolos saringan status?
 *
 * Membungkus `lolosSaringHarian` dengan satu tambahan yang wajib: hari **di
 * luar kontrak** dan hari yang **belum tiba** tidak pernah cocok dengan
 * saringan status apa pun — termasuk "Belum ada".
 *
 * Tanpa itu, menekan "Belum ada" pada bulan depan akan menyorot 30 hari yang
 * belum terjadi seolah-olah semuanya tertinggal. Saringan yang menyorot hal
 * yang salah lebih buruk daripada tidak ada saringan: ia terlihat seperti
 * jawaban.
 */
export function lolosSelSaring(sel: SelKalender, saring: SaringHarian): boolean {
  if (saring === "semua") return true;
  if (sel.keadaan === "luar_kontrak" || sel.keadaan === "belum_tiba") return false;
  return lolosSaringHarian(sel.status, saring);
}

/* ------------------------------------------------------------------ */
/* Ringkasan                                                           */
/* ------------------------------------------------------------------ */

export type RingkasKalender = {
  /**
   * PENYEBUT: hari yang memang seharusnya punya laporan (dalam masa kontrak &
   * sudah lewat/hari ini). Hari di luar kontrak dan hari yang belum tiba TIDAK
   * ikut — memasukkannya membuat bulan depan terbaca "30 hari terlewat".
   */
  wajib: number;
  belumAda: number;
  draft: number;
  perluKoreksi: number;
  dikirim: number;
  selesai: number;
  /** Hari yang tidak menagih laporan — disebut supaya tidak terbaca hilang. */
  luarKontrak: number;
  belumTiba: number;
};

export function ringkasKalender(sel: SelKalender[]): RingkasKalender {
  const r: RingkasKalender = {
    wajib: 0,
    belumAda: 0,
    draft: 0,
    perluKoreksi: 0,
    dikirim: 0,
    selesai: 0,
    luarKontrak: 0,
    belumTiba: 0,
  };
  for (const s of sel) {
    if (!s.bulanIni) continue;
    if (s.keadaan === "luar_kontrak") {
      r.luarKontrak += 1;
      continue;
    }
    if (s.keadaan === "belum_tiba") {
      r.belumTiba += 1;
      continue;
    }
    r.wajib += 1;
    if (s.status === null) r.belumAda += 1;
    else if (s.status === "draft") r.draft += 1;
    else if (s.status === "perlu_koreksi") r.perluKoreksi += 1;
    else if (s.status === "dikirim") r.dikirim += 1;
    else r.selesai += 1;
  }
  return r;
}
