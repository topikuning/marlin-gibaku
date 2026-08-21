import type { IssueStatus } from "@/generated/prisma/enums";

/**
 * ATURAN MENGHAPUS KENDALA — MURNI (DECISIONS 394).
 *
 * Penggabungan (DECISIONS 393) menutup kasus DUPLIKAT, tapi tidak menutup kasus
 * **salah catat**: mandor mengetik di lokasi yang salah, atau menulis "asdf"
 * saat mencoba-coba. Sebelum ini satu-satunya jalan keluar adalah menutupnya
 * sebagai "selesai" – dan itu berbohong, karena tidak ada yang diselesaikan.
 * Papan lalu terisi kendala palsu berstatus selesai, dan angka "Selesai 30
 * hari" ikut menghitungnya.
 *
 * ### Kenapa SEMPIT, bukan hapus bebas
 *
 * Hapus bebas akan membuat kendala yang sudah dikirim ke grup WA atau sudah
 * tercetak di laporan KKP bisa lenyap tanpa jejak – dan orang yang sudah
 * melihatnya tidak akan pernah tahu. Yang boleh dibuang hanya kendala yang
 * **belum menyentuh siapa pun**.
 *
 * Kesempitan itulah yang membuat hapus ini aman; melonggarkannya menghilangkan
 * satu-satunya alasan ia boleh ada.
 */

export type KendalaHapus = {
  status: IssueStatus;
  /** Jumlah aksi pemulihan yang menempel. */
  jumlahAksi: number;
  /** Kendala ini sudah digabungkan ke kendala lain. */
  mergedIntoId: string | null;
  /** Ada kendala LAIN yang digabungkan ke kendala ini. */
  jumlahKembar: number;
  /** Status laporan harian tempat kendala ini menempel; null = tidak menempel. */
  statusLaporan: string | null;
};

/**
 * Alasan sebuah kendala TIDAK boleh dihapus. `null` = boleh.
 *
 * Mengembalikan kalimat siap-tampil, bukan kode: pesannya masuk ke layar orang
 * lapangan, dan menerjemahkan kode jadi kalimat di komponen berarti kalimatnya
 * ditulis dua kali dan bisa menyimpang.
 */
export function alasanTidakBisaDihapus(k: KendalaHapus): string | null {
  if (k.jumlahAksi > 0) {
    /*
     * Aksi pemulihan berarti seseorang sudah MERENCANAKAN sesuatu untuk kendala
     * ini. Menghapusnya membuang pekerjaan orang lain tanpa pemberitahuan, dan
     * yang merencanakannya tidak akan pernah tahu rencananya lenyap.
     */
    return "Kendala ini sudah punya aksi pemulihan – tutup dengan catatan, jangan dihapus.";
  }
  if (k.jumlahKembar > 0) {
    /*
     * Ada kendala lain yang digabungkan KE SINI. Menghapusnya memutus penunjuk
     * kembarnya, dan kembar yang kehilangan induk akan muncul kembali di layar
     * seolah tidak pernah dirapikan.
     */
    return "Ada kendala lain yang digabungkan ke kendala ini – lepaskan dulu penggabungannya.";
  }
  if (k.mergedIntoId) {
    /*
     * Barisnya adalah BUKTI penggabungan pernah terjadi. Menghapusnya membuat
     * catatan penutup "digabungkan ke ..." menunjuk ke sesuatu yang tidak bisa
     * ditelusuri lagi.
     */
    return "Kendala ini sudah digabungkan – riwayat penggabungannya ikut hilang bila dihapus.";
  }
  if (k.statusLaporan === "final") {
    /*
     * Laporan final sudah diverifikasi dan bisa saja sudah disetorkan ke PPK.
     * Menghapus kendala yang tercantum di dalamnya membuat dokumen yang sudah
     * beredar tidak cocok lagi dengan sistem.
     */
    return "Kendala ini menempel di laporan harian yang sudah FINAL – tidak bisa dihapus.";
  }
  if (k.status === "selesai") {
    /*
     * Kendala selesai adalah riwayat: ia menerangkan sesuatu yang pernah
     * menghambat dan bagaimana diatasi. Salah catat tidak pernah sampai ke
     * status ini kecuali seseorang menutupnya – dan kalau begitu, yang perlu
     * diperbaiki catatan penutupnya, bukan barisnya dibuang.
     */
    return "Kendala yang sudah selesai adalah riwayat – perbaiki catatan penutupnya, jangan dihapus.";
  }
  return null;
}
