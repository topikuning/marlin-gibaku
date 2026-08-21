"use client";

import { useEffect } from "react";

/**
 * Buang HTML ber-sesi yang tersimpan di HP, dipasang di halaman masuk
 * (DECISIONS 397).
 *
 * Halaman masuk adalah satu-satunya titik yang PASTI dilewati sesudah keluar –
 * `logout()` selalu mengalihkan ke sini, dan sesi yang kedaluwarsa juga
 * berakhir di sini. Karena itu pembersihannya ditempel ke halaman ini, bukan ke
 * tombol Keluar: tombol bisa tidak ditekan, halaman ini tidak bisa dilewati.
 *
 * Service worker juga membuang simpanan saat pemiliknya berganti (pesan `halo`).
 * Yang ini menutup celah di antaranya: HP diletakkan setelah keluar, orang
 * berikutnya membukanya di luar jangkauan sebelum sempat masuk – dan tanpa
 * pembersihan ini akan melihat halaman milik orang sebelumnya.
 */
export function PembersihSimpanan() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.active?.postMessage({ jenis: "bersihkan-halaman" }))
      .catch(() => {
        // Tidak ada service worker terdaftar = tidak ada yang perlu dibersihkan.
      });
  }, []);

  return null;
}
