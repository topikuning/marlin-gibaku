/**
 * Teks pengingat laporan harian yang masuk ke GRUP WhatsApp paket — MODUL
 * MURNI, seperti `pesan.ts` untuk pengingat perorangan.
 *
 * Bedanya dengan pengingat perorangan bukan cuma tujuannya. Pesan ini dibaca
 * PPK, konsultan pengawas, dan seluruh isi grup, jadi nadanya menyebut keadaan
 * — bukan menegur orang. Nama perorangan sengaja tidak disebut: yang belum
 * lengkap adalah laporan sebuah lokasi, dan mempermalukan orang di depan
 * pemberi kerja bukan cara menagihnya.
 */

export type LokasiBelumLapor = {
  nama: string;
  /** true = barisnya sudah ada tapi masih draf (bukan belum sama sekali). */
  adaDraft: boolean;
};

/**
 * Bangun pesan untuk SATU grup paket. `null` = tidak ada yang perlu ditagih,
 * jadi grupnya TIDAK dikirimi apa pun.
 *
 * Pengingat yang tetap datang walau semua sudah melapor akan berhenti dibaca
 * dalam sepekan — dan di grup pemberi kerja ia juga membuat paket yang tertib
 * terlihat seperti paket yang bermasalah.
 */
export function pesanPengingatGrup(input: {
  namaPaket: string;
  tanggalTampil: string;
  belum: LokasiBelumLapor[];
  /** Lokasi yang laporannya SUDAH masuk hari itu — disebut jumlahnya saja. */
  sudah: number;
}): string | null {
  if (input.belum.length === 0) return null;

  const baris = input.belum.map((l) =>
    l.adaDraft ? `• ${l.nama} – masih DRAF, belum dikirim` : `• ${l.nama} – belum ada laporan`,
  );
  const total = input.belum.length + input.sudah;

  return [
    `*Laporan Harian ${input.tanggalTampil} – ${input.namaPaket}*`,
    "",
    `${input.belum.length} dari ${total} lokasi belum lengkap hari ini:`,
    ...baris,
    "",
    // Tenggat KKP disebut karena itulah alasan pengingat ini ada: dokumentasi
    // harian diminta tiap hari, dan berkas mingguan paling lambat Minggu 23.59.
    "Mohon dilengkapi lewat menu *Hari Ini* di MARLIN sebelum tutup hari, beserta dokumentasi fotonya.",
    "",
    "_Pesan otomatis. Bila laporannya sudah dikirim setelah pesan ini terkirim, abaikan saja._",
  ].join("\n");
}
