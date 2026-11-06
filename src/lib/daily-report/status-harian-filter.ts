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
  status: "draft" | "dikirim" | "perlu_koreksi" | "disetujui" | "final" | null;
  drive: { status: "sukses" | "gagal" | null };
  waSentAt: Date | null;
  packageId: string;
  packageName: string;
};

export const FILTER_LAPORAN = ["semua", "belum", "proses", "final"] as const;
export const FILTER_DRIVE = ["semua", "belum", "sudah", "gagal"] as const;
export const FILTER_WA = ["semua", "belum", "sudah"] as const;

export type FilterLaporan = (typeof FILTER_LAPORAN)[number];
export type FilterDrive = (typeof FILTER_DRIVE)[number];
export type FilterWa = (typeof FILTER_WA)[number];

export type FilterStatusHarian = {
  /**
   * id paket; "" = semua paket. Permintaan user 2026-11-06: papan "hanya
   * menampilkan lokasi, aku tidak bisa menemukan jika ingin satu paket".
   * Kolom nama paket tetap tidak kembali ke tabel (user 2026-08-06, "gak
   * penting itu nama paket!") – yang dibutuhkan saringannya.
   */
  paket: string;
  /** slug lokasi; "" = semua lokasi. */
  lokasi: string;
  laporan: FilterLaporan;
  drive: FilterDrive;
  wa: FilterWa;
};

export const FILTER_KOSONG: FilterStatusHarian = {
  paket: "",
  lokasi: "",
  laporan: "semua",
  drive: "semua",
  wa: "semua",
};

/** Baca filter dari query string; nilai tak dikenal jatuh ke "semua" (bukan galat). */
export function bacaFilter(sp: {
  paket?: string;
  lokasi?: string;
  laporan?: string;
  drive?: string;
  wa?: string;
}): FilterStatusHarian {
  const laporan = FILTER_LAPORAN.find((v) => v === sp.laporan) ?? "semua";
  const drive = FILTER_DRIVE.find((v) => v === sp.drive) ?? "semua";
  const wa = FILTER_WA.find((v) => v === sp.wa) ?? "semua";
  return { paket: sp.paket?.trim() || "", lokasi: sp.lokasi?.trim() || "", laporan, drive, wa };
}

export function adaFilterAktif(f: FilterStatusHarian): boolean {
  return f.paket !== "" || f.lokasi !== "" || f.laporan !== "semua" || f.drive !== "semua" || f.wa !== "semua";
}

/**
 * Saring baris papan status.
 *
 * "belum" pada Drive mencakup yang BELUM PERNAH DICOBA maupun yang GAGAL —
 * keduanya sama-sama berarti berkasnya tidak ada di Drive, dan itulah yang
 * ditanyakan. Yang gagal tetap bisa dipisahkan lewat filter "gagal" tersendiri,
 * karena tindak lanjutnya berbeda: yang belum dicoba tinggal diunggah,
 * sedangkan yang gagal perlu dilihat dulu sebabnya.
 *
 * "proses" pada Laporan mencakup SEMUA status antara (draft/dikirim/
 * perlu_koreksi/disetujui): bagi yang mengawasi, semuanya sama-sama "sudah ada
 * laporannya, tapi belum tuntas". Yang membedakan tindak lanjutnya sudah
 * terbaca di kolom "Laporan" sendiri.
 */
export function saringBaris<T extends BarisTersaring>(
  rows: T[],
  f: FilterStatusHarian,
): T[] {
  return rows.filter((r) => {
    if (f.paket && r.packageId !== f.paket) return false;
    if (f.lokasi && r.slug !== f.lokasi) return false;
    if (f.laporan === "belum" && r.status !== null) return false;
    if (f.laporan === "final" && r.status !== "final") return false;
    if (f.laporan === "proses" && (r.status === null || r.status === "final")) return false;
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
  if (next.paket) q.set("paket", next.paket);
  if (next.lokasi) q.set("lokasi", next.lokasi);
  if (next.laporan !== "semua") q.set("laporan", next.laporan);
  if (next.drive !== "semua") q.set("drive", next.drive);
  if (next.wa !== "semua") q.set("wa", next.wa);
  return `/laporan/status-harian?${q.toString()}`;
}

/**
 * Pilihan paket untuk pemilih: satu per paket yang punya lokasi di papan ini,
 * urut nama, dengan jumlah lokasinya – supaya pilihan yang kosong tidak ada
 * dan yang kecil terlihat kecil.
 */
export function opsiPaket(rows: Pick<BarisTersaring, "packageId" | "packageName">[]): { value: string; label: string }[] {
  const per = new Map<string, { nama: string; n: number }>();
  for (const r of rows) {
    const x = per.get(r.packageId) ?? { nama: r.packageName, n: 0 };
    x.n++;
    per.set(r.packageId, x);
  }
  return [...per]
    .sort((a, b) => a[1].nama.localeCompare(b[1].nama, "id", { numeric: true }))
    .map(([value, x]) => ({ value, label: `${x.nama} · ${x.n} lokasi` }));
}

/**
 * Angka kartu di atas papan. Dipakai `getStatusHarian` (seluruh lokasi) dan
 * halaman (satu paket, bila paket dipilih) – satu rumus, bukan dua.
 */
export function ringkasStatus(rows: BarisTersaring[]) {
  return {
    total: rows.length,
    belumAda: rows.filter((r) => r.status == null).length,
    masihDraft: rows.filter((r) => r.status === "draft").length,
    sudahFinal: rows.filter((r) => r.status === "final").length,
    sudahDrive: rows.filter((r) => r.drive.status === "sukses").length,
    sudahWa: rows.filter((r) => r.waSentAt != null).length,
  };
}
