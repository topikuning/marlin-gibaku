"use client";

import { useEffect } from "react";

/**
 * Buka dialog cetak SEKALI saat halaman cetak dibuka dengan `?cetak=1`.
 *
 * Bukan bawaan halaman cetak: dulu auto-print di setiap halaman membuat
 * pengguna "terjebak" dan harus menekan Back peramban. Sekarang ia hanya hidup
 * bila DIMINTA lewat alamat – yaitu oleh tombol "Buka di peramban" dari
 * aplikasi terpasang, yang memang membuka jendela peramban baru hanya untuk
 * mencetak (lihat `lib/cetak/mode-cetak.ts`).
 *
 * Menunggu `load`, bukan sekadar satu frame: halaman cetak memuat foto, dan
 * dialog yang terbuka sebelum fotonya tiba mencetak kotak kosong.
 */
export function AutoPrint() {
  useEffect(() => {
    let jeda: number | undefined;
    const cetak = () => {
      jeda = window.setTimeout(() => window.print(), 150);
    };
    if (document.readyState === "complete") cetak();
    else window.addEventListener("load", cetak, { once: true });
    return () => {
      window.removeEventListener("load", cetak);
      if (jeda !== undefined) window.clearTimeout(jeda);
    };
  }, []);

  return null;
}
