/**
 * AMBANG DEVIASI BAKU — satu tempat, dipakai peta, tabel, KPI dan chip status.
 *
 * Modul MURNI (tanpa server-only, tanpa DB) supaya bisa diuji langsung dan
 * dipakai baik di Server maupun Client Component.
 *
 * Ini BUKAN calculation layer: modul ini tidak pernah menghitung deviasi.
 * Angkanya tetap datang dari `src/lib/progress.ts` / `progress-calc.ts`
 * (CLAUDE.md §7). Yang dijaga di sini hanya SATU hal — pada nilai berapa
 * sebuah deviasi berubah makna dari "aman" jadi "perlu perhatian" jadi
 * "kritis". Sebelumnya ambang itu tersebar: `-10` sebagai konstanta lokal di
 * `dashboard.ts`, dan "< 0" ditulis langsung di percabangan warna pin. Dua
 * tempat berbeda untuk satu aturan berarti keduanya bisa bergeser sendiri
 * tanpa ada yang sadar, dan peta lalu berselisih dengan tabel di bawahnya.
 *
 * Ambang mengikuti Design System MARLIN §1:
 *
 *     ≥ −1 pp          aman     (hijau)
 *     −1 s.d. −10 pp   perhatian (amber)
 *     < −10 pp         kritis   (merah)
 *
 * PERUBAHAN YANG DISENGAJA: sebelum ini apa pun di bawah 0 langsung amber,
 * jadi lokasi yang meleset 0,2 pp — selisih pembulatan, bukan masalah nyata —
 * tampil dengan bobot visual yang sama dengan yang meleset 9 pp. Zona mati
 * 1 pp membuat warna amber kembali berarti "ada yang perlu dilihat".
 *
 * Satuannya POIN PERSEN (pp) selisih realisasi − rencana, bukan persen relatif.
 */

/** Ambang dalam poin persen. Negatif = tertinggal dari rencana. */
export const AMBANG_DEVIASI = {
  /** Di bawah nilai ini = kritis (merah). */
  kritis: -10,
  /** Di bawah nilai ini = perlu perhatian (amber). Di atasnya = aman. */
  perhatian: -1,
} as const;

/**
 * Nama lama dari `components/ui/stat-delta.tsx`, tempat ambang ini dulu
 * tinggal. Dipertahankan sebagai alias supaya pemanggil lama tidak perlu
 * berubah sekaligus — tetapi ANGKANYA kini cuma ada di satu tempat, yaitu di
 * atas. Ambang yang tinggal di dalam komponen UI juga memaksa kode server
 * (dashboard, antrean tindakan) mengimpor komponen React hanya untuk membaca
 * dua angka; itu sebabnya ia pindah ke lapisan lib.
 */
export const DEVIATION_THRESHOLDS = {
  onTrack: AMBANG_DEVIASI.perhatian,
  warning: AMBANG_DEVIASI.kritis,
} as const;

/** Tingkat keparahan deviasi — urut dari aman ke kritis. */
export type TingkatDeviasi = "aman" | "perhatian" | "kritis";

/**
 * Klasifikasi satu nilai deviasi (pp) ke tingkat keparahan.
 *
 * `null`/`undefined` (lokasi tanpa baseline atau belum mulai) sengaja TIDAK
 * dipaksa jadi "aman" — pemanggil harus memutuskan sendiri, karena "tidak
 * diketahui" bukan "baik-baik saja".
 */
export function tingkatDeviasi(deviasiPp: number): TingkatDeviasi {
  if (deviasiPp < AMBANG_DEVIASI.kritis) return "kritis";
  if (deviasiPp < AMBANG_DEVIASI.perhatian) return "perhatian";
  return "aman";
}

/** Label Indonesia untuk tingkat deviasi — dipakai chip, legend peta, tabel. */
export const LABEL_DEVIASI: Record<TingkatDeviasi, string> = {
  aman: "Sesuai rencana",
  perhatian: "Perlu perhatian",
  kritis: "Kritis",
};

/**
 * Kelas Tailwind chip status per tingkat — token, tanpa hex (CLAUDE.md).
 * Bentuknya pil sesuai Design System (radius 999).
 */
export const KELAS_CHIP_DEVIASI: Record<TingkatDeviasi, string> = {
  aman: "border-success-border bg-success-soft text-success",
  perhatian: "border-warning-border bg-warning-soft text-warning",
  kritis: "border-danger-border bg-danger-soft text-danger",
};

// Formatnya sengaja TIDAK ditaruh di sini: `formatPct` di `@/lib/format` sudah
// memformat poin persen gaya Indonesia (koma desimal, satu desimal). Menambah
// pemformat kedua di modul ini persis mengulang kesalahan yang diperbaiki
// berkas ini — dua sumber untuk satu aturan.
