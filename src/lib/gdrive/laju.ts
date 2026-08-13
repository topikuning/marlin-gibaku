/**
 * ATURAN LAJU unggah Drive — MURNI (tanpa DB, tanpa jaringan, tanpa jam).
 *
 * Google memblokir LEDAKAN, bukan jumlah total. 83 lokasi yang difinalisasi
 * beruntun sore hari bisa berarti ribuan berkas dalam hitungan menit kalau
 * setiap finalisasi mengunggah di tempat; yang sama persis dicicil sepanjang
 * hari tidak menyentuh batas mana pun. Karena itu semua angka pengendali laju
 * dikumpulkan di sini, bisa diuji tanpa menyentuh Drive sungguhan.
 *
 * Dua jenis kegagalan dibedakan, dan pembedaan itu yang paling penting di modul
 * ini:
 *
 *  - **Ditahan laju** (429, 403 rateLimitExceeded, 5xx) — bukan salah
 *    pekerjaannya. Pekerjaan didorong mundur TANPA menambah hitungan percobaan.
 *    Kalau ini ikut dihitung, satu sore yang sibuk akan membuat laporan yang
 *    sebenarnya sehat menyerah permanen hanya karena Google sedang menyuruh
 *    pelan-pelan.
 *  - **Salah beneran** (folder tidak ada, token dicabut, berkas tak terbaca) —
 *    mengulang tidak akan menyembuhkannya. Hitungan percobaan naik, dan setelah
 *    `MAKS_PERCOBAAN` pekerjaan itu MENYERAH supaya berhenti membebani antrean
 *    dan muncul sebagai sesuatu yang harus diperbaiki orang.
 *
 * Yang menentukan golongan adalah STATUS HTTP dari Drive. Kegagalan yang tidak
 * punya status sama sekali — paket belum punya folder, R2 tak terbaca, render
 * PDF melempar, jaringan putus — dihitung **salah beneran**, dan itu pilihan
 * yang disengaja: menganggapnya "ditahan laju" berarti pekerjaan yang tidak
 * akan pernah sembuh mengulang selamanya TANPA pernah muncul sebagai macet,
 * sambil menghentikan sisa putaran setiap kali. Gangguan jaringan sesaat tetap
 * pulih sendiri — 5 percobaan terbentang lebih dari sehari lewat mundur
 * bertahap.
 */

/** Jeda antar berkas dalam satu putaran. ~3 berkas/detik — jauh di bawah batas Drive. */
export const JEDA_ANTAR_BERKAS_MS = 350;

/**
 * Batas berkas per putaran. Backlog besar sengaja DICICIL lintas putaran, bukan
 * dikejar sekaligus: antrean yang tersisa akan diambil putaran berikutnya.
 */
export const MAKS_BERKAS_PER_PUTARAN = 240;

/**
 * Anggaran waktu satu putaran. Rute cron memasang `maxDuration = 300` detik;
 * berhenti di 3 menit menyisakan ruang supaya putaran selalu sempat menulis
 * hasilnya alih-alih dipotong di tengah unggahan.
 */
export const ANGGARAN_WAKTU_MS = 180_000;

/** Pekerjaan yang ditarik satu putaran (satu pekerjaan = 1 PDF + n foto). */
export const MAKS_PEKERJAAN_PER_PUTARAN = 40;

/** Setelah sekian kegagalan NYATA (bukan tertahan laju), pekerjaan menyerah. */
export const MAKS_PERCOBAAN = 5;

/**
 * Pekerjaan berstatus `jalan` lebih lama dari ini dianggap menggantung — proses
 * mati di tengah putaran — dan boleh diambil lagi. Tanpa ini, satu restart di
 * saat yang salah membuat barisnya terkunci selamanya.
 */
export const BATAS_MENGGANTUNG_MS = 30 * 60_000;

/** Mundur bertahap untuk kegagalan NYATA: 15 mnt → 1 j → 4 j → 12 j → 24 j. */
const MUNDUR_GAGAL_MS = [15 * 60_000, 60 * 60_000, 4 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

/** Mundur saat DITAHAN LAJU — pendek, karena penyebabnya sementara. */
const MUNDUR_LAJU_MS = 10 * 60_000;

/** Batas atas penghormatan `Retry-After` — jangan tertidur berhari-hari. */
const MAKS_RETRY_AFTER_MS = 6 * 3_600_000;

export type JenisGalat = "laju" | "nyata";

/**
 * Golongkan kegagalan dari status HTTP Drive. Tanpa status = "salah beneran" —
 * alasannya di kepala berkas, dan itu bagian yang paling mudah salah di modul
 * ini.
 */
export function jenisGalat(status: number | null | undefined, pesan?: string | null): JenisGalat {
  if (status == null) return "nyata";
  if (status === 429) return "laju";
  if (status >= 500) return "laju";
  // 403 dipakai Drive untuk DUA hal yang sangat berbeda: kuota terlampaui
  // (sementara) dan hak akses kurang (permanen). Yang membedakan hanya alasan
  // di badan respons.
  if (status === 403) {
    const p = (pesan ?? "").toLowerCase();
    const kuota =
      p.includes("ratelimit") ||
      p.includes("rate limit") ||
      p.includes("quota") ||
      p.includes("userratelimitexceeded") ||
      p.includes("backenderror");
    return kuota ? "laju" : "nyata";
  }
  return "nyata";
}

/** Baca `Retry-After` (detik atau tanggal HTTP) → milidetik. Null bila tak ada/ tak masuk akal. */
export function retryAfterMs(nilai: string | null | undefined, sekarang: number): number | null {
  const v = (nilai ?? "").trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const ms = Number(v) * 1000;
    return ms > 0 ? Math.min(ms, MAKS_RETRY_AFTER_MS) : null;
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const ms = t - sekarang;
  return ms > 0 ? Math.min(ms, MAKS_RETRY_AFTER_MS) : null;
}

export type Mundur = {
  /** Kapan paling cepat boleh dicoba lagi. */
  nextAttemptAt: Date;
  /** Hitungan percobaan SESUDAH kegagalan ini. */
  attempts: number;
  /** true = sudah tidak akan dicoba lagi oleh penjadwal. */
  menyerah: boolean;
};

/**
 * Hitung mundur berikutnya setelah satu kegagalan.
 *
 * `attemptsSebelum` adalah hitungan SEBELUM kegagalan ini. Tertahan laju tidak
 * menaikkannya — lihat catatan di kepala berkas.
 */
export function hitungMundur(input: {
  jenis: JenisGalat;
  attemptsSebelum: number;
  sekarang: Date;
  retryAfterMs?: number | null;
}): Mundur {
  const { jenis, attemptsSebelum, sekarang } = input;
  const t = sekarang.getTime();

  if (jenis === "laju") {
    // `Retry-After` dari Google didahulukan: ia tahu kapan kuotanya pulih,
    // tebakan kita tidak.
    const jeda = input.retryAfterMs && input.retryAfterMs > 0 ? input.retryAfterMs : MUNDUR_LAJU_MS;
    return { nextAttemptAt: new Date(t + jeda), attempts: attemptsSebelum, menyerah: false };
  }

  const attempts = attemptsSebelum + 1;
  if (attempts >= MAKS_PERCOBAAN) {
    return { nextAttemptAt: new Date(t), attempts, menyerah: true };
  }
  const jeda = MUNDUR_GAGAL_MS[Math.min(attempts - 1, MUNDUR_GAGAL_MS.length - 1)];
  return { nextAttemptAt: new Date(t + jeda), attempts, menyerah: false };
}

/** Masih boleh mengunggah berkas lagi di putaran ini? */
export function masihAdaJatah(pakai: { berkas: number; mulai: number; sekarang: number }): boolean {
  return (
    pakai.berkas < MAKS_BERKAS_PER_PUTARAN && pakai.sekarang - pakai.mulai < ANGGARAN_WAKTU_MS
  );
}
