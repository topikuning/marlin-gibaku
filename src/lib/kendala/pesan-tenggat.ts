/**
 * TEKS PENGINGAT KENDALA LEWAT TENGGAT — MODUL MURNI (DECISIONS 392).
 *
 * Poin 2.3 di `docs/rebuild/PETA_KENDALA.md`: perhitungan "lewat tenggat" sudah
 * ada dan benar, tapi **tidak seorang pun diberi tahu**. Halaman `/kendala`
 * saja tidak menyelesaikan itu – halaman hanya menolong orang yang sudah
 * membukanya, dan yang mengabaikan kendala justru yang tidak membukanya.
 *
 * User memilih **grup paket, ringkas**. Dipisah dari pengirimnya supaya
 * kalimatnya bisa diuji tanpa DB/WAHA: pesan ini masuk ke grup berisi
 * orang-orang nyata, dan kalimat yang menuduh langsung jadi masalah manusia.
 */

export type BarisTenggat = {
  judul: string;
  lokasi: string;
  /** Nama PIC – pengguna MARLIN atau nama bebas. Null = belum ada pemilik. */
  pic: string | null;
  /** Berapa hari tenggatnya sudah lewat (>= 1). */
  lewatHari: number;
};

/** Baris yang ditampilkan utuh; sisanya disebut jumlahnya. */
export const MAKS_BARIS = 5;

/**
 * Sidik jari isi pesan – dipakai penjadwal untuk tidak mengirim daftar yang
 * SAMA berulang-ulang. Hanya identitas kendala yang dihitung, bukan umur
 * keterlambatannya: kalau `lewatHari` ikut, sidiknya berubah tiap hari dan
 * peredamnya tidak pernah bekerja.
 */
export function sidikTenggat(baris: BarisTenggat[], total = baris.length): string {
  /*
   * `total` ikut karena pemanggil hanya membawa POTONGAN teratas: kalau
   * kendala ke-40 ditutup dan kendala ke-41 muncul, daftar teratasnya sama
   * persis dan peredam akan menahan pesan yang seharusnya berubah. Jumlahnya
   * yang menangkap perubahan di luar potongan itu.
   */
  return `${total}\n${[...baris.map((b) => `${b.lokasi}|${b.judul}`)].sort().join("\n")}`;
}

/**
 * Bangun pesan untuk SATU grup paket. `null` = tidak ada yang lewat tenggat,
 * jadi grup TIDAK dikirimi apa pun.
 *
 * Peringatan yang tetap datang saat tidak ada apa-apa akan berhenti dibaca –
 * dan pada saat itulah peringatan yang sungguhan ikut hilang.
 */
export function pesanKendalaTenggat(
  namaPaket: string,
  baris: BarisTenggat[],
  /**
   * Jumlah SEBENARNYA kendala lewat tenggat, bila `baris` sudah dipotong di
   * pemanggil. Tanpa ini, "dan N lainnya" menghitung dari daftar yang sudah
   * terpotong dan menyebut angka yang lebih kecil daripada kenyataan – persis
   * jenis kesalahan yang membuat orang berhenti percaya angka MARLIN.
   */
  total = baris.length,
): string | null {
  if (baris.length === 0) return null;

  const urut = [...baris].sort((a, b) => b.lewatHari - a.lewatHari);
  const tampil = urut.slice(0, MAKS_BARIS);
  const sisa = Math.max(total, urut.length) - tampil.length;

  const daftar = tampil.map((b) => {
    const bagian = [b.judul, b.lokasi];
    // Kendala tanpa pemilik disebut apa adanya. Mengosongkannya membuat baris
    // itu terbaca seperti sudah ada yang menangani.
    bagian.push(b.pic ? `PIC ${b.pic}` : "belum ada PIC");
    bagian.push(`lewat ${b.lewatHari} hari`);
    return `• ${bagian.join(" – ")}`;
  });

  const jumlah = Math.max(total, urut.length);
  const kepala =
    jumlah === 1 ? "1 kendala sudah lewat tenggat:" : `${jumlah} kendala sudah lewat tenggat:`;

  return [
    `⚠️ *MARLIN – Kendala lewat tenggat*`,
    namaPaket,
    "",
    kepala,
    ...daftar,
    ...(sisa > 0 ? [`• dan ${sisa} kendala lain yang tidak ditampilkan di sini`] : []),
    "",
    "Perbarui tenggat atau tutup kendalanya lewat menu *Kendala* di MARLIN.",
    "",
    "_Pesan otomatis._",
  ].join("\n");
}
