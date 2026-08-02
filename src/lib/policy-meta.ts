/**
 * Bentuk & label kebijakan pengendalian — TANPA `server-only`.
 *
 * Dipisah dari `policy.ts` karena kartu setelan di halaman Sistem adalah
 * komponen KLIEN: mengimpor modul ber-`server-only` dari sana membuat
 * `next build` gagal, dan itu tidak tertangkap `typecheck` maupun `lint` —
 * hanya build yang menegakkan batas server/klien. DECISIONS 219.
 *
 * Isinya sengaja hanya tipe dan teks: tidak ada satu pun akses DB di sini.
 */

export type Policy = {
  approverMustDiffer: boolean;
  finalizerMustDiffer: boolean;
  requirePhotoGps: boolean;
};

export const POLICY_DEFAULTS: Policy = {
  approverMustDiffer: false,
  finalizerMustDiffer: false,
  requirePhotoGps: false,
};

/** Label + penjelasan untuk halaman Sistem — satu sumber, jangan diketik ulang di UI. */
export const POLICY_META: Record<
  keyof Policy,
  { label: string; deskripsi: string; dampak: string }
> = {
  approverMustDiffer: {
    label: "Penyetuju laporan harian harus orang lain",
    deskripsi:
      "Laporan tidak bisa disetujui oleh orang yang mengirimnya sendiri. Ini prinsip empat mata: yang mencatat pekerjaan bukan yang mengesahkannya.",
    dampak:
      "Kalau di satu lokasi hanya ada satu orang yang aktif, laporannya akan tertahan sampai ada orang kedua yang menyetujui.",
  },
  finalizerMustDiffer: {
    label: "Pemfinal laporan harian harus orang lain",
    deskripsi:
      "Laporan tidak bisa difinalkan oleh orang yang menyetujuinya. Finalisasi membekukan angka untuk dicetak, jadi ia langkah pengesahan terakhir.",
    dampak: "Butuh minimal tiga orang berbeda dalam satu rantai: pengirim, penyetuju, pemfinal.",
  },
  requirePhotoGps: {
    label: "Foto laporan wajib ber-GPS perangkat",
    deskripsi:
      "Unggahan foto ditolak bila perangkat tidak mengirim koordinat. Tanpa ini, foto tanpa GPS tetap diterima dan dicap memakai titik proyek sebagai cadangan.",
    dampak:
      "Pelapor yang menolak izin lokasi di browser tidak akan bisa mengunggah foto sampai izinnya diberikan.",
  },
};

