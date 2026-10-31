import { KATALOG_BERKAS_TERMIN, butirBerkas, type LaporanMarlin, type StatusButir } from "./katalog";

/**
 * "SIAPKAN BERKAS TERMIN n" – aturan murni (DECISIONS 721): periode laporan
 * termin, dan daftar pekerjaan unggah ke folder TERMIN n di Drive.
 *
 * Satu pekerjaan = satu berkas, diunggah ke SATU ATAU LEBIH folder (laporan
 * mingguan masuk "7. Laporan Mingguan" dan "BERKAS DOKUMEN TEKNIS / 6. Laporan
 * Mingguan" – dibuat sekali, bukan dua kali).
 */

export type JenisPekerjaanTermin = "berkas" | LaporanMarlin;

export type PekerjaanTermin = {
  terminKe: number;
  jenis: JenisPekerjaanTermin;
  /** Nomor minggu/bulan untuk laporan periodik; null untuk yang lain. */
  nomor: number | null;
  /** Butir katalog yang foldernya diisi berkas ini. */
  kode: readonly string[];
  /** Berkas sumber untuk jenis "berkas": `d<uuid>` dokumen, `s<uuid>` surat. */
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

const LAPORAN_PER_LOKASI: readonly LaporanMarlin[] = ["mingguan", "harian", "bulanan", "dokumentasi"];

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
  baris: readonly { kode: string; status: StatusButir; sumber: { dokumenId: string } | { suratId: string } | null }[];
  lokasi: readonly string[];
  rentang: RentangMinggu;
  bulan: readonly number[];
}): PekerjaanTermin[] {
  const { terminKe } = input;
  const status = new Map(input.baris.map((b) => [b.kode, b]));
  const hasil: PekerjaanTermin[] = [];

  for (const b of input.baris) {
    if (b.status !== "ada" || !b.sumber) continue;
    const sumber = "dokumenId" in b.sumber ? `d${b.sumber.dokumenId}` : `s${b.sumber.suratId}`;
    hasil.push({ terminKe, jenis: "berkas", nomor: null, kode: [b.kode], sumber, locationId: null });
  }

  /** Folder laporan `l` yang belum diisi unggahan orang. */
  const kodeLaporan = (l: LaporanMarlin) =>
    KATALOG_BERKAS_TERMIN.filter((k) => k.laporan === l && status.get(k.kode)?.status !== "ada").map((k) => k.kode);

  const kurva = kodeLaporan("kurva_s");
  if (kurva.length) hasil.push({ terminKe, jenis: "kurva_s", nomor: null, kode: kurva, sumber: null, locationId: null });

  const minggu: number[] = [];
  for (let m = input.rentang.awal; m <= input.rentang.akhir; m++) minggu.push(m);
  for (const jenis of LAPORAN_PER_LOKASI) {
    const kode = kodeLaporan(jenis);
    if (!kode.length) continue;
    const nomor: (number | null)[] = jenis === "dokumentasi" ? [null] : jenis === "bulanan" ? [...input.bulan] : minggu;
    for (const locationId of input.lokasi) {
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
  const isi = p.jenis === "berkas" ? p.kode[0] : (p.nomor ?? "");
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

const JENIS: readonly JenisPekerjaanTermin[] = ["berkas", "kurva_s", "mingguan", "harian", "bulanan", "dokumentasi"];

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
      return `Kurva S - ${nama.paket}.pdf`;
    case "mingguan":
      return `Laporan Mingguan Minggu ke-${p.nomor} - ${lokasi}.pdf`;
    case "harian":
      return `Laporan Harian Minggu ke-${p.nomor} - ${lokasi}.pdf`;
    case "bulanan":
      return `Laporan Bulanan Bulan ke-${p.nomor} - ${lokasi}.pdf`;
    case "dokumentasi":
      return `Dokumentasi Sarana Prasarana - ${lokasi}.pdf`;
    case "berkas":
      return "";
  }
}

/** Label singkat untuk layar ("Laporan mingguan minggu ke-7"). */
export function labelPekerjaanTermin(p: PekerjaanTermin): string {
  switch (p.jenis) {
    case "kurva_s":
      return "Kurva S paket";
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
      return b ? `${b.kode}. ${b.jalur[b.jalur.length - 1].replace(/^[a-z0-9]+\.\s*/i, "")}` : p.kode[0];
    }
  }
}
