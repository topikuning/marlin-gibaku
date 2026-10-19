/**
 * SELISIH PROGRES MARLIN vs KAWAL (DECISIONS 689, 691). Murni.
 *
 * Angka MARLIN datang dari calculation layer (`getLocationsProgress`), angka
 * Kawal dari snapshot tarikan terbaru – keduanya APA ADANYA. Di sini hanya
 * selisihnya, arahnya, dan tingkatnya. Komponen dan PDF dilarang menghitung
 * ulang; mereka membaca hasil fungsi ini.
 *
 * Ketetapan user: *"bandingkan progress marlin dan kawal (tarikan data
 * terupdate) sesimple itu"* – progres MARLIN saat ini dibandingkan dengan
 * progres Kawal dari tarikan terbaru, tanpa syarat bertahan sekian minggu.
 */

/** Ambang brief 2026-10-18: |selisih| ≥ 5 pp tinggi, ≥ 10 pp kritis. */
export const AMBANG_TINGGI_PP = 5;
export const AMBANG_KRITIS_PP = 10;

export type TingkatSelisih = "wajar" | "tinggi" | "kritis" | "tidak_dinilai";
export type ArahSelisih = "marlin_lebih_tinggi" | "kawal_lebih_tinggi" | "sama";

export type Perbandingan = {
  /** MARLIN − Kawal, poin persen; null bila salah satu tidak ada. */
  selisihPp: number | null;
  arah: ArahSelisih | null;
  tingkat: TingkatSelisih;
};

/**
 * `mingguKawal` = `current_week` Kawal. Pagar minggu-0: lokasi yang belum
 * mulai menurut Kawal tidak dinilai – nol lawan nol bukan kabar baik, dan
 * angka kecil lawan nol bukan masalah.
 */
export function bandingkanProgres(
  marlinPct: number | null,
  kawalPct: number | null,
  mingguKawal: number | null,
): Perbandingan {
  if (marlinPct == null || kawalPct == null || !Number.isFinite(marlinPct) || !Number.isFinite(kawalPct)) {
    return { selisihPp: null, arah: null, tingkat: "tidak_dinilai" };
  }
  const selisihPp = Math.round((marlinPct - kawalPct) * 100) / 100;
  const arah: ArahSelisih =
    Math.abs(selisihPp) < 0.005 ? "sama" : selisihPp > 0 ? "marlin_lebih_tinggi" : "kawal_lebih_tinggi";
  if (mingguKawal == null || mingguKawal < 1) return { selisihPp, arah, tingkat: "tidak_dinilai" };
  const besar = Math.abs(selisihPp);
  const tingkat: TingkatSelisih = besar >= AMBANG_KRITIS_PP ? "kritis" : besar >= AMBANG_TINGGI_PP ? "tinggi" : "wajar";
  return { selisihPp, arah, tingkat };
}

export const LABEL_ARAH: Record<ArahSelisih, string> = {
  marlin_lebih_tinggi: "MARLIN lebih tinggi",
  kawal_lebih_tinggi: "Kawal lebih tinggi",
  sama: "sama",
};

/**
 * Yang perlu dilakukan berbeda menurut arahnya – itu sebabnya arah selalu
 * ditulis, bukan hanya besarnya.
 */
export const SARAN_ARAH: Record<ArahSelisih, string> = {
  marlin_lebih_tinggi:
    "Laporan MARLIN di depan pengawas. Tanyakan ke pengawas apakah pekerjaan yang sudah dilaporkan sudah ia periksa dan masukkan ke Kawal.",
  kawal_lebih_tinggi:
    "Pengawas mencatat lebih banyak dari laporan MARLIN. Periksa apakah ada laporan harian yang belum dikirim atau volume yang belum diisi.",
  sama: "Angka MARLIN dan Kawal sejalan.",
};

export const TONE_TINGKAT: Record<TingkatSelisih, "success" | "warning" | "danger" | "neutral"> = {
  wajar: "success",
  tinggi: "warning",
  kritis: "danger",
  tidak_dinilai: "neutral",
};

export const LABEL_TINGKAT: Record<TingkatSelisih, string> = {
  wajar: "Wajar",
  tinggi: `Selisih ≥ ${AMBANG_TINGGI_PP} pp`,
  kritis: `Selisih ≥ ${AMBANG_KRITIS_PP} pp`,
  tidak_dinilai: "Belum dinilai",
};

/** "+4,25 pp" / "−3,10 pp" – tanda selalu ditulis supaya arah terbaca dari angkanya. */
export function formatSelisihPp(pp: number): string {
  const tanda = pp > 0 ? "+" : pp < 0 ? "−" : "";
  return `${tanda}${Math.abs(pp).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pp`;
}
