/**
 * RIWAYAT PENYERAHAN LAPORAN HARIAN — ATURAN MURNI (DECISIONS 406).
 *
 * Permintaan user 2026-08-21: *"pada laporan harian informasi yang diutamakan
 * adalah apakah sudah diupload ke drive atau ke whatsap."*
 *
 * Itu memang pertanyaan yang benar-benar ditanyakan orang di depan layar ini.
 * Laporan harian yang sudah difinalkan tapi tidak pernah sampai ke Drive atau
 * grup WhatsApp = pekerjaan yang tidak terhitung oleh yang memeriksa. Sebelum
 * ini keterangannya ada, tapi TERSEMBUNYI di dalam menu (`hint` pada pilihan
 * "Kirim ke WhatsApp"): harus dibuka satu per satu, tiga puluh kali, untuk
 * menjawab satu pertanyaan.
 *
 * ---
 *
 * ### Yang DICATAT sistem, dan yang TIDAK
 *
 * Ini batas yang menentukan isi layarnya, jadi ditulis di sini supaya tidak
 * pelan-pelan dilanggar:
 *
 * | Kejadian              | Sumber                                   |
 * |-----------------------|------------------------------------------|
 * | Kirim WhatsApp        | `DailyReport.waSentAt` + `waSentById`    |
 * | Upload Drive          | `GDriveUpload` (log append-only)         |
 * | Unduh PDF             | `audit_logs` aksi `report.pdf_unduh`     |
 * | **Dibuka / dilihat**  | **tidak dicatat di mana pun**            |
 * | **Dicetak**           | **tidak dicatat, dan tidak bisa**        |
 *
 * Dua baris terakhir sengaja TIDAK diadakan. "Dibuka Nx" butuh pencatatan
 * pada setiap render halaman, dan halaman cetak dijangkau lewat `<Link>` yang
 * di-prefetch peramban — angkanya akan naik untuk kunjungan yang tidak pernah
 * terjadi. Yang lebih parah, "Terakhir dicetak" hanya bisa berarti "halaman
 * cetak dibuka": tak ada satu pun cara memastikan kertasnya keluar. Angka yang
 * tampak pasti padahal tebakan lebih buruk daripada kolom yang kosong.
 *
 * Karena itu kepingan riwayat hanya muncul kalau ADA catatannya. Tidak ada
 * "0x" untuk yang tidak pernah dicatat — nol yang tidak pernah dihitung adalah
 * kebohongan yang rapi.
 */

/** Satu baris log upload Drive untuk satu laporan (`GDriveUpload`). */
export type LogDrive = {
  status: string;
  createdAt: Date;
  fileName: string;
  webLink: string | null;
  error: string | null;
};

export type DriveSukses = {
  /** Berapa BERKAS berbeda yang ada di Drive untuk hari itu (PDF + foto). */
  berkas: number;
  /** Unggahan sukses terakhir. */
  pada: Date;
  /** Tautan berkas PDF-nya bila Drive mengembalikannya. */
  tautan: string | null;
};

export type DriveGagal = { pada: Date; pesan: string | null };

/**
 * Ringkas log Drive satu laporan.
 *
 * Kegagalan hanya dilaporkan bila ia LEBIH BARU daripada sukses terakhir.
 * Kegagalan yang sudah disusul keberhasilan adalah sejarah, bukan masalah yang
 * masih menunggu — memasang lencana merah untuknya membuat orang mengulang
 * unggahan yang sebenarnya sudah beres.
 */
export function ringkasDrive(logs: LogDrive[]): {
  sukses: DriveSukses | null;
  gagal: DriveGagal | null;
} {
  let pada: Date | null = null;
  let tautan: string | null = null;
  const berkas = new Set<string>();
  let gagal: DriveGagal | null = null;

  for (const l of logs) {
    if (l.status === "sukses") {
      berkas.add(l.fileName);
      if (!pada || l.createdAt > pada) pada = l.createdAt;
      // Tautan yang ditawarkan = PDF laporannya, bukan foto yang kebetulan
      // terunggah paling akhir.
      if (!tautan && l.webLink && /\.pdf$/i.test(l.fileName)) tautan = l.webLink;
    } else if (!gagal || l.createdAt > gagal.pada) {
      gagal = { pada: l.createdAt, pesan: l.error };
    }
  }

  const sukses = pada ? { berkas: berkas.size, pada, tautan } : null;
  return { sukses, gagal: gagal && (!pada || gagal.pada > pada) ? gagal : null };
}

export type StatusKirim = "lengkap" | "sebagian" | "belum";

/**
 * Sudah sampai ke mana laporan ini.
 *
 * Drive dan WhatsApp TIDAK saling menggantikan: Drive itu arsip yang diperiksa
 * KKP, WhatsApp itu kabar ke orang. Satu terisi tidak membuat yang lain selesai,
 * jadi keadaannya tiga, bukan dua.
 */
export function statusKirim(x: { drive: boolean; wa: boolean }): StatusKirim {
  if (x.drive && x.wa) return "lengkap";
  return x.drive || x.wa ? "sebagian" : "belum";
}

export type RingkasKirim = {
  total: number;
  drive: number;
  wa: number;
  /** Belum sampai ke Drive MAUPUN WhatsApp – ini yang perlu dikerjakan. */
  belum: number;
};

export function ringkasKirim(rows: { drive: boolean; wa: boolean }[]): RingkasKirim {
  return {
    total: rows.length,
    drive: rows.filter((r) => r.drive).length,
    wa: rows.filter((r) => r.wa).length,
    belum: rows.filter((r) => statusKirim(r) === "belum").length,
  };
}
