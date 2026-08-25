/**
 * Akses ke tawaran pasang yang ditangkap skrip awal di root layout
 * (DECISIONS 405).
 *
 * Dipisah dari komponennya dengan alasan yang sangat praktis: `window` adalah
 * nilai di luar React, dan React Compiler menolak komponen yang memutasinya
 * langsung. Dibungkus di sini, mutasinya jadi urusan modul biasa — dan
 * kebetulan lebih benar juga, karena "event pasang sudah dipakai" memang
 * keadaan MILIK HALAMAN, bukan milik satu komponen.
 */

export type EventPasang = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __marlinPasang: EventPasang | null;
  }
}

export function adaTawaran(): boolean {
  return typeof window !== "undefined" && !!window.__marlinPasang;
}

/**
 * Ambil tawarannya SEKALI PAKAI.
 *
 * Dikosongkan di sini, bukan sesudah dialognya selesai: `prompt()` hanya sah
 * dipanggil satu kali per event — panggilan kedua ditolak peramban. Membuangnya
 * saat diambil membuat keadaan "sudah dipakai" tidak bisa terlewat.
 */
export function pakaiTawaran(): EventPasang | null {
  if (typeof window === "undefined") return null;
  const ev = window.__marlinPasang;
  window.__marlinPasang = null;
  return ev;
}
