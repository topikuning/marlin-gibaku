import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import { KATALOG_BERKAS_TERMIN, butirBerkas, namaButir, type LaporanMarlin, type StatusButir } from "./katalog";

/**
 * "SIAPKAN BERKAS TERMIN n" – aturan murni (DECISIONS 721): periode laporan
 * termin, dan daftar pekerjaan unggah ke folder TERMIN n di Drive.
 *
 * Satu pekerjaan = satu berkas, diunggah ke SATU ATAU LEBIH folder (laporan
 * mingguan masuk "7. Laporan Mingguan" dan "BERKAS DOKUMEN TEKNIS / 6. Laporan
 * Mingguan" – dibuat sekali, bukan dua kali).
 */

/** "buang" = versi MARLIN yang sudah di Drive tapi kini digantikan (DECISIONS 722). */
export type JenisPekerjaanTermin = "berkas" | LaporanMarlin | "buang";

export type PekerjaanTermin = {
  terminKe: number;
  jenis: JenisPekerjaanTermin;
  /** Nomor minggu/bulan laporan periodik; minggu prestasi untuk Kurva S; null untuk yang lain. */
  nomor: number | null;
  /** Butir katalog yang foldernya diisi berkas ini. */
  kode: readonly string[];
  /**
   * Jenis "berkas": `d<uuid>` dokumen atau `s<uuid>` surat. Jenis "buang":
   * refKey pekerjaan lama yang berkas Drive-nya dibuang ke Sampah.
   */
  sumber: string | null;
  locationId: string | null;
};

/* ── Periode laporan termin ─────────────────────────────────────────────── */

export type RentangMinggu = { awal: number; akhir: number };

export type HasilRentang =
  | { ok: true; rentang: RentangMinggu }
  /** `terminKe` = termin yang progres konsultannya perlu diisi/dibetulkan. */
  | { ok: false; alasan: string; terminKe: number };

/**
 * Termin tidak terikat nomor minggu (ketetapan user 2026-10-31): laporannya
 * dari minggu SESUDAH prestasi termin sebelumnya sampai minggu prestasi termin
 * ini tercapai, menurut laporan konsultan yang diisi di Termin & Surat.
 */
export function rentangMingguTermin(
  terminKe: number,
  prestasi: readonly { terminKe: number; mingguKe: number }[],
): HasilRentang {
  const ini = prestasi.find((p) => p.terminKe === terminKe);
  if (!ini) {
    return { ok: false, alasan: `Progres laporan konsultan termin ${terminKe} belum diisi.`, terminKe };
  }
  if (terminKe === 1) return { ok: true, rentang: { awal: 1, akhir: ini.mingguKe } };
  const sebelum = prestasi.find((p) => p.terminKe === terminKe - 1);
  if (!sebelum) {
    return {
      ok: false,
      alasan: `Progres laporan konsultan termin ${terminKe - 1} belum diisi, jadi minggu awal laporan termin ${terminKe} belum diketahui.`,
      terminKe: terminKe - 1,
    };
  }
  if (sebelum.mingguKe >= ini.mingguKe) {
    return {
      ok: false,
      alasan: `Minggu prestasi termin ${terminKe} (minggu ke-${ini.mingguKe}) tidak sesudah termin ${terminKe - 1} (minggu ke-${sebelum.mingguKe}).`,
      terminKe,
    };
  }
  return { ok: true, rentang: { awal: sebelum.mingguKe + 1, akhir: ini.mingguKe } };
}

/* ── Rencana pekerjaan ──────────────────────────────────────────────────── */

const LAPORAN_PER_LOKASI: readonly LaporanMarlin[] = ["kurva_s", "mingguan", "harian", "bulanan", "dokumentasi"];

/**
 * Pekerjaan unggah satu termin.
 *
 * - Butir yang sudah ADA (dokumen, unggahan, surat) disalin apa adanya.
 * - Laporan MARLIN dibuat untuk folder yang BELUM diisi orang: Kurva S sekali
 *   per paket; laporan mingguan & harian per lokasi per minggu di rentang;
 *   bulanan per lokasi per bulan yang beririsan; dokumentasi per lokasi.
 * - Yang belum ada di MARLIN (berkas pihak lain, surat belum dibuat) tidak ikut.
 */
export function rencanaBerkasTermin(input: {
  terminKe: number;
  baris: readonly {
    kode: string;
    status: StatusButir;
    sumber: readonly ({ dokumenId: string } | { suratId: string })[];
    /** Status per lokasi untuk butir per lokasi (DECISIONS 725). */
    lokasi?: readonly { locationId: string; status: StatusButir }[] | null;
  }[];
  lokasi: readonly string[];
  rentang: RentangMinggu;
  bulan: readonly number[];
}): PekerjaanTermin[] {
  const { terminKe } = input;
  const perKode = new Map(input.baris.map((b) => [b.kode, b]));
  const hasil: PekerjaanTermin[] = [];

  // Semua berkas yang memenuhi butir disalin – unggahan sendiri bisa beberapa
  // (scan bertanda tangan per minggu, per lokasi). Statusnya tidak dilihat:
  // butir per lokasi yang baru satu desanya berisi versi sendiri belum "ada",
  // tapi berkas desa itu tetap ikut. Butir duplikat BERKAS DOKUMEN TEKNIS
  // tidak diisi ulang (DECISIONS 725).
  for (const b of input.baris) {
    if (butirBerkas(b.kode)?.cukupDi) continue;
    for (const x of b.sumber) {
      const sumber = "dokumenId" in x ? `d${x.dokumenId}` : `s${x.suratId}`;
      hasil.push({ terminKe, jenis: "berkas", nomor: null, kode: [b.kode], sumber, locationId: null });
    }
  }

  /**
   * Lokasi yang laporan `l`-nya dibuat MARLIN. MARLIN membantu, tidak memaksa
   * (ketetapan user 2026-10-31): lokasi yang sudah diisi versi sendiri
   * (dicetak, diteken, dipindai) tidak diberi versi MARLIN – per lokasi, bukan
   * per paket (DECISIONS 725).
   */
  const lokasiLaporan = (l: LaporanMarlin): { kode: string[]; lokasi: string[] } => {
    const butir = KATALOG_BERKAS_TERMIN.find((k) => k.laporan === l && !k.cukupDi);
    if (!butir) return { kode: [], lokasi: [] };
    const b = perKode.get(butir.kode);
    if (b?.status === "ada") return { kode: [butir.kode], lokasi: [] };
    const terisi = new Set((b?.lokasi ?? []).filter((x) => x.status === "ada").map((x) => x.locationId));
    return { kode: [butir.kode], lokasi: input.lokasi.filter((id) => !terisi.has(id)) };
  };

  const minggu: number[] = [];
  for (let m = input.rentang.awal; m <= input.rentang.akhir; m++) minggu.push(m);
  for (const jenis of LAPORAN_PER_LOKASI) {
    const { kode, lokasi } = lokasiLaporan(jenis);
    // Pola berkas yang lolos (TERMIN 1 CV. Putera Fahlevi):
    // - Kurva S per lokasi s.d. minggu prestasi ("TS MINGGU 1-7 <DESA>");
    // - Laporan Mingguan hanya minggu prestasi per lokasi;
    // - Laporan Harian tiap minggu di rentang (pilihan user, DECISIONS 721);
    // - Laporan Bulanan tiap bulan yang beririsan; dokumentasi per lokasi.
    const nomor: (number | null)[] =
      jenis === "kurva_s" || jenis === "mingguan"
        ? [input.rentang.akhir]
        : jenis === "dokumentasi"
          ? [null]
          : jenis === "bulanan"
            ? [...input.bulan]
            : minggu;
    for (const locationId of lokasi) {
      for (const n of nomor) hasil.push({ terminKe, jenis, nomor: n, kode, sumber: null, locationId });
    }
  }
  return hasil;
}

/* ── Kunci & periode di antrean ─────────────────────────────────────────── */

export const KIND_BERKAS_TERMIN = "berkas_termin";

/**
 * Identitas pekerjaan di antrean. TIDAK memuat daftar folder dan berkas
 * sumber: menekan ulang sesudah dokumen diganti memperbarui baris yang sama.
 */
export function refKeyPekerjaanTermin(packageId: string, p: PekerjaanTermin): string {
  if (p.jenis === "buang") return `buang>${p.sumber}`;
  // Berkas: satu baris per butir per berkas sumber. Kurva S satu per termin –
  // minggu prestasinya isi, bukan identitas.
  const isi = p.jenis === "berkas" ? `${p.kode[0]}>${p.sumber}` : p.jenis === "kurva_s" ? "" : (p.nomor ?? "");
  return `${packageId}:t${p.terminKe}:${p.jenis}:${isi}:${p.locationId ?? "-"}`;
}

/** Awalan `periode` semua pekerjaan termin `n` – dipakai menyaring antrean. */
export function awalanPeriodeTermin(terminKe: number): string {
  return `${terminKe}|`;
}

/** Yang dikerjakan, dalam satu kolom `periode`: "1|mingguan|7|7+T6|". */
export function periodePekerjaanTermin(p: PekerjaanTermin): string {
  return [p.terminKe, p.jenis, p.nomor ?? "", p.kode.join("+"), p.sumber ?? ""].join("|");
}

const JENIS: readonly JenisPekerjaanTermin[] = ["berkas", "kurva_s", "mingguan", "harian", "bulanan", "dokumentasi", "buang"];

/**
 * Pekerjaan lama yang tidak lagi termasuk rencana dan berkasnya sudah naik:
 * versi MARLIN yang perlu dibuang dari folder termin supaya tidak terkirim
 * bersama/menggantikan scan bertanda tangan. Hanya laporan buatan MARLIN –
 * salinan unggahan orang tidak pernah dibuang otomatis.
 */
export function pekerjaanBuang(
  lama: readonly { refKey: string; periode: string; locationId: string | null; status: string }[],
  kunciRencana: ReadonlySet<string>,
): PekerjaanTermin[] {
  const hasil: PekerjaanTermin[] = [];
  for (const r of lama) {
    if (r.status !== "sukses" || kunciRencana.has(r.refKey)) continue;
    const p = uraiPeriodeTermin(r.periode, r.locationId);
    if (!p || p.jenis === "berkas" || p.jenis === "buang") continue;
    hasil.push({ terminKe: p.terminKe, jenis: "buang", nomor: p.nomor, kode: p.kode, sumber: r.refKey, locationId: r.locationId });
  }
  return hasil;
}

export function uraiPeriodeTermin(periode: string, locationId: string | null): PekerjaanTermin | null {
  const [t, jenis, nomor, kode, sumber, ...lebih] = periode.split("|");
  const terminKe = Number(t);
  if (lebih.length || !Number.isInteger(terminKe) || terminKe < 1) return null;
  if (!JENIS.includes(jenis as JenisPekerjaanTermin)) return null;
  const n = nomor === "" || nomor === undefined ? null : Number(nomor);
  if (n !== null && (!Number.isInteger(n) || n < 1)) return null;
  const daftar = (kode ?? "").split("+").filter(Boolean);
  if (!daftar.length || daftar.some((k) => !butirBerkas(k))) return null;
  return {
    terminKe,
    jenis: jenis as JenisPekerjaanTermin,
    nomor: n,
    kode: daftar,
    sumber: sumber || null,
    locationId,
  };
}

/** Nama berkas laporan MARLIN di folder termin. */
export function namaLaporanTermin(p: PekerjaanTermin, nama: { lokasi: string | null; paket: string }): string {
  const lokasi = nama.lokasi ?? nama.paket;
  switch (p.jenis) {
    case "kurva_s":
      return `Kurva S Minggu 1-${p.nomor ?? ""} - ${lokasi}.pdf`;
    case "mingguan":
      return `Laporan Mingguan Minggu ke-${p.nomor} - ${lokasi}.pdf`;
    case "harian":
      return `Laporan Harian Minggu ke-${p.nomor} - ${lokasi}.pdf`;
    case "bulanan":
      return `Laporan Bulanan Bulan ke-${p.nomor} - ${lokasi}.pdf`;
    case "dokumentasi":
      return `Dokumentasi Sarana Prasarana - ${lokasi}.pdf`;
    case "berkas":
    case "buang":
      return "";
  }
}

/** Label singkat untuk layar ("Laporan mingguan minggu ke-7"). */
export function labelPekerjaanTermin(p: PekerjaanTermin): string {
  switch (p.jenis) {
    case "kurva_s":
      return p.nomor ? `Kurva S s.d. minggu ke-${p.nomor}` : "Kurva S";
    case "mingguan":
      return `Laporan mingguan minggu ke-${p.nomor}`;
    case "harian":
      return `Laporan harian minggu ke-${p.nomor}`;
    case "bulanan":
      return `Laporan bulanan bulan ke-${p.nomor}`;
    case "dokumentasi":
      return "Dokumentasi sarana prasarana";
    case "berkas": {
      const b = butirBerkas(p.kode[0]);
      return b ? namaButir(b) : p.kode[0];
    }
    case "buang": {
      // Jenis laporan lamanya dikenali dari butir foldernya (7/T6 = mingguan, dst).
      const asal = butirBerkas(p.kode[0])?.laporan;
      return `${asal ? labelPekerjaanTermin({ ...p, jenis: asal }) : "Laporan MARLIN"} – versi MARLIN dibuang ke Sampah Drive`;
    }
  }
}

/* ── Lima surat penyedia dari tombol Siapkan berkas (DECISIONS 724) ──────── */

/**
 * Tanggal AWAL surat yang belum dibuat, dihitung dari hari H (bawaan: hari
 * ini): permohonan pemeriksaan H, BA pembahasan H+1, permohonan pembayaran,
 * invoice, kwitansi H+2 – urutan alur KKP. Isian awal saja: orang mengubahnya
 * sesuai kenyataan sebelum menekan tombol.
 */
export const HARI_SESUDAH_H: Record<JenisSuratPenyedia, number> = {
  permohonan_pemeriksaan: 0,
  ba_pembahasan_kemajuan: 1,
  permohonan_pembayaran: 2,
  invoice: 2,
  kwitansi: 2,
};

/** "YYYY-MM-DD" + `hari` hari, tetap sebagai kunci tanggal (tanpa zona). */
export function tanggalSuratAwal(jenis: JenisSuratPenyedia, hariH: string): string {
  const [y, m, d] = hariH.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + HARI_SESUDAH_H[jenis])).toISOString().slice(0, 10);
}

/** Butir katalog surat `jenis` (9a, 9b, 10a, 10b, 10c). */
export function kodeSurat(jenis: JenisSuratPenyedia): string {
  return KATALOG_BERKAS_TERMIN.find((b) => b.surat === jenis)!.kode;
}

/**
 * Subfolder per lokasi di dalam folder butir, mengikuti berkas yang lolos
 * (DECISIONS 725): "7. Laporan Mingguan/<DESA>" dan "8. Dokumentasi Pekerjaan
 * Per Item/DOKUMENTASI - <DESA>". Butir per lokasi lainnya datar, dengan nama
 * desa di nama berkasnya.
 */
export function subfolderLokasi(kode: string, lokasi: string | null): string[] {
  if (!lokasi) return [];
  const besar = lokasi.toUpperCase();
  if (kode === "7") return [besar];
  if (kode === "8") return [`DOKUMENTASI - ${besar}`];
  return [];
}

/** Nama berkas salinan dokumen satu lokasi: nama desa ditambahkan bila belum ada. */
export function namaDenganLokasi(namaBerkas: string, lokasi: string | null): string {
  if (!lokasi || namaBerkas.toLowerCase().includes(lokasi.toLowerCase())) return namaBerkas;
  return `${lokasi} - ${namaBerkas}`;
}
