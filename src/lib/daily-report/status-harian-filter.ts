/**
 * SARINGAN PAPAN STATUS LAPORAN HARIAN — modul murni.
 *
 * Permintaan user 2026-08-06:
 *
 *   *"dimana filter kalau aku ingin langsung ke lokasi tertentu, aku ingin
 *   tahu mana yang belum upload ke drive, mana yang sudah laporan wa."*
 *
 * Papan ini menampilkan SELURUH lokasi aktif untuk satu tanggal. Pada skala 83
 * lokasi, "mana yang belum naik ke Drive" berarti membaca 83 baris satu per
 * satu dan mengingat-ingat — pekerjaan yang justru hendak dihapus papan ini.
 * Jejaknya sudah ada di tiap baris sejak DECISIONS 262; yang belum ada adalah
 * cara MENYARINGNYA.
 *
 * Aturannya ditulis di sini, bukan di JSX, karena ini logika yang bisa salah
 * diam-diam: saringan yang keliru tidak menerbitkan galat apa pun — ia hanya
 * menyembunyikan lokasi yang seharusnya ditindak, dan itu persis kegagalan yang
 * paling mahal di papan pengawasan.
 */

/** Bentuk minimal yang dibutuhkan saringan — `StatusHarianRow` memenuhinya. */
export type BarisTersaring = {
  slug: string;
  drive: { status: "sukses" | "gagal" | null };
  waSentAt: Date | null;
};

export const FILTER_DRIVE = ["semua", "belum", "sudah", "gagal"] as const;
export const FILTER_WA = ["semua", "belum", "sudah"] as const;

export type FilterDrive = (typeof FILTER_DRIVE)[number];
export type FilterWa = (typeof FILTER_WA)[number];

export type FilterStatusHarian = {
  /** slug lokasi; "" = semua lokasi. */
  lokasi: string;
  drive: FilterDrive;
  wa: FilterWa;
};

export const FILTER_KOSONG: FilterStatusHarian = { lokasi: "", drive: "semua", wa: "semua" };

/** Baca filter dari query string; nilai tak dikenal jatuh ke "semua" (bukan galat). */
export function bacaFilter(sp: {
  lokasi?: string;
  drive?: string;
  wa?: string;
}): FilterStatusHarian {
  const drive = FILTER_DRIVE.find((v) => v === sp.drive) ?? "semua";
  const wa = FILTER_WA.find((v) => v === sp.wa) ?? "semua";
  return { lokasi: sp.lokasi?.trim() || "", drive, wa };
}

export function adaFilterAktif(f: FilterStatusHarian): boolean {
  return f.lokasi !== "" || f.drive !== "semua" || f.wa !== "semua";
}

/**
 * Saring baris papan status.
 *
 * "belum" pada Drive mencakup yang BELUM PERNAH DICOBA maupun yang GAGAL —
 * keduanya sama-sama berarti berkasnya tidak ada di Drive, dan itulah yang
 * ditanyakan. Yang gagal tetap bisa dipisahkan lewat filter "gagal" tersendiri,
 * karena tindak lanjutnya berbeda: yang belum dicoba tinggal diunggah,
 * sedangkan yang gagal perlu dilihat dulu sebabnya.
 */
export function saringBaris<T extends BarisTersaring>(
  rows: T[],
  f: FilterStatusHarian,
): T[] {
  return rows.filter((r) => {
    if (f.lokasi && r.slug !== f.lokasi) return false;
    if (f.drive === "sudah" && r.drive.status !== "sukses") return false;
    if (f.drive === "belum" && r.drive.status === "sukses") return false;
    if (f.drive === "gagal" && r.drive.status !== "gagal") return false;
    if (f.wa === "sudah" && r.waSentAt == null) return false;
    if (f.wa === "belum" && r.waSentAt != null) return false;
    return true;
  });
}

/** Bangun query string yang mempertahankan tanggal + filter lain. */
export function tautFilter(
  dateKey: string,
  f: FilterStatusHarian,
  ubah: Partial<FilterStatusHarian>,
): string {
  const next = { ...f, ...ubah };
  const q = new URLSearchParams({ tanggal: dateKey });
  if (next.lokasi) q.set("lokasi", next.lokasi);
  if (next.drive !== "semua") q.set("drive", next.drive);
  if (next.wa !== "semua") q.set("wa", next.wa);
  return `/laporan/status-harian?${q.toString()}`;
}
