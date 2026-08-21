import { describe, expect, it } from "vitest";
import { alasanTidakBisaDihapus, type KendalaHapus } from "@/lib/kendala/hapus";

/**
 * DECISIONS 394 — menghapus kendala yang SALAH CATAT.
 *
 * Penggabungan menutup kasus duplikat; ini menutup kasus salah catat. Sebelum
 * ada ini, satu-satunya jalan keluar adalah menutupnya sebagai "selesai" — dan
 * itu berbohong, karena tidak ada yang diselesaikan.
 *
 * Yang dijaga di sini bukan "boleh atau tidak", melainkan **kesempitannya**.
 * Kesempitan itulah satu-satunya alasan hapus permanen boleh ada; melonggarkan
 * salah satu syaratnya membuat kendala yang sudah dilihat orang bisa lenyap
 * tanpa jejak.
 */

const k = (o: Partial<KendalaHapus> = {}): KendalaHapus => ({
  status: "terbuka",
  jumlahAksi: 0,
  mergedIntoId: null,
  jumlahKembar: 0,
  statusLaporan: null,
  ...o,
});

describe("alasanTidakBisaDihapus", () => {
  it("kendala baru yang belum menyentuh siapa pun BOLEH dihapus", () => {
    expect(alasanTidakBisaDihapus(k())).toBeNull();
    expect(alasanTidakBisaDihapus(k({ status: "ditangani" }))).toBeNull();
  });

  it("kendala dari laporan harian yang masih draft boleh dihapus", () => {
    expect(alasanTidakBisaDihapus(k({ statusLaporan: "draft" }))).toBeNull();
    expect(alasanTidakBisaDihapus(k({ statusLaporan: "dikirim" }))).toBeNull();
  });

  it("REGRESI: yang sudah punya aksi pemulihan DITOLAK", () => {
    /*
     * Aksi pemulihan berarti seseorang sudah merencanakan sesuatu. Menghapusnya
     * membuang pekerjaan orang lain tanpa pemberitahuan, dan yang
     * merencanakannya tidak akan pernah tahu rencananya lenyap.
     */
    expect(alasanTidakBisaDihapus(k({ jumlahAksi: 1 }))).toMatch(/aksi pemulihan/i);
  });

  it("REGRESI: yang jadi TUJUAN penggabungan ditolak", () => {
    /*
     * Ada kendala lain yang digabungkan ke sini. Menghapusnya memutus penunjuk
     * kembarnya, dan kembar yang kehilangan induk muncul kembali di layar
     * seolah tidak pernah dirapikan.
     */
    expect(alasanTidakBisaDihapus(k({ jumlahKembar: 1 }))).toMatch(/digabungkan ke kendala ini/i);
  });

  it("REGRESI: yang SUDAH digabungkan ditolak", () => {
    // Barisnya adalah bukti penggabungan pernah terjadi.
    expect(alasanTidakBisaDihapus(k({ mergedIntoId: "x" }))).toMatch(/sudah digabungkan/i);
  });

  it("REGRESI: yang menempel di laporan FINAL ditolak", () => {
    /*
     * Laporan final sudah diverifikasi dan bisa saja sudah disetorkan ke PPK.
     * Menghapus kendala di dalamnya membuat dokumen yang sudah beredar tidak
     * cocok lagi dengan sistem.
     */
    expect(alasanTidakBisaDihapus(k({ statusLaporan: "final" }))).toMatch(/FINAL/);
  });

  it("REGRESI: kendala yang sudah SELESAI ditolak", () => {
    // Kendala selesai adalah riwayat: ia menerangkan sesuatu yang pernah
    // menghambat dan bagaimana diatasi.
    expect(alasanTidakBisaDihapus(k({ status: "selesai" }))).toMatch(/riwayat/i);
  });

  it("aksi pemulihan diperiksa lebih dulu daripada status", () => {
    // Kendala selesai YANG punya aksi harus menyebut aksinya — itu sebab yang
    // lebih spesifik, dan pesan yang lebih spesifik lebih menolong.
    const hasil = alasanTidakBisaDihapus(k({ status: "selesai", jumlahAksi: 2 }));
    expect(hasil).toMatch(/aksi pemulihan/i);
  });
});
