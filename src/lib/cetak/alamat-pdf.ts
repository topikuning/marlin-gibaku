/**
 * Alamat PDF resmi tiap dokumen cetak – dipakai tombol "Buka PDF" di aplikasi
 * terpasang (lihat `mode-cetak.ts`). Dikumpulkan di satu tempat supaya ujinya
 * bisa memastikan tiap alamat menunjuk route yang benar-benar ada.
 */

const e = encodeURIComponent;

export const alamatPdf = {
  harian: (slug: string, tanggal: string) => `/api/laporan/harian/${e(slug)}/${e(tanggal)}/pdf`,
  periodik: (slug: string, jenis: "mingguan" | "bulanan", n: number) =>
    `/api/laporan/periodik/${e(slug)}/${jenis}/${n}/pdf`,
  rencana: (slug: string, minggu: number) => `/api/laporan/rencana/${e(slug)}/${minggu}/pdf`,
  jadwal: (slug: string) => `/api/laporan/jadwal/${e(slug)}/pdf`,
  rencanaRealisasi: (slug: string) => `/api/laporan/rencana-realisasi/${e(slug)}/pdf`,
};
