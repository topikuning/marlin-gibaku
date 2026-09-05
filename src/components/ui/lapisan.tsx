"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * LAPISAN LAYAR PENUH YANG TIDAK BISA DIJEBAK INDUKNYA.
 *
 * Keluhan user 2026-09-05 di dasbor: *"tumpang tindih semua"* — peta beserta
 * legendanya tetap menyala DI ATAS penampil foto, dan penampilnya sendiri
 * berdiri di tengah kartu, bukan di tengah layar.
 *
 * Sebabnya bukan angka `z-index`-nya kurang tinggi. `position: fixed` diukur
 * terhadap VIEWPORT hanya selama tidak ada leluhur yang membuat containing
 * block baru; begitu ada leluhur ber-`transform`/`filter`/`contain`, lapisan
 * itu terkurung di dalam kartunya, dan `z-index` setinggi apa pun hanya
 * berlaku DI DALAM kurungan itu. Peta (panel Leaflet z 400, kendali z 1000)
 * berada di luar kurungan, jadi ia menang tanpa perlu angka besar.
 *
 * Karena itu obatnya bukan menaikkan angka lagi — itu yang sudah dilakukan
 * (2000) dan tetap kalah — melainkan KELUAR dari kurungannya: lapisan
 * dipindahkan ke `document.body` lewat portal. Di sana ia satu-satunya
 * penghuni tingkat atas, dan angka pada `LAPIS` menentukan urutan sesamanya.
 *
 * Skala z tunggal, supaya tidak ada lagi tebak-tebakan angka:
 *
 * | Lapis        | z    | Isinya                                        |
 * |--------------|------|-----------------------------------------------|
 * | (peta)       | 1000 | kendali Leaflet — BUKAN milik kita, acuan saja |
 * | `panel`      | 1200 | drawer, dialog konfirmasi, lembar pilihan      |
 * | `kamera`     | 1400 | kamera langsung (menutup segalanya)            |
 * | `penampil`   | 2000 | penampil foto layar penuh                      |
 *
 * Yang TIDAK boleh dipindahkan ke portal: lapisan yang isinya ikut terkirim
 * sebagai bagian sebuah `<form>` (mis. pemilih foto di form laporan). Portal
 * memindahkan simpulnya keluar dari form, dan isian di dalamnya berhenti ikut
 * terkirim — kerusakan yang jauh lebih mahal daripada tumpang tindih.
 */

export const LAPIS = { panel: 1200, kamera: 1400, penampil: 2000 } as const;

export type NamaLapis = keyof typeof LAPIS;

export function Lapisan({
  lapis = "panel",
  className = "",
  kunciGulir = true,
  children,
  ...rest
}: {
  lapis?: NamaLapis;
  className?: string;
  /** Kunci gulir halaman di belakang lapisan (matikan bila lapisan tembus). */
  kunciGulir?: boolean;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  // Portal hanya boleh dipasang SESUDAH terpasang di klien: `document` tidak
  // ada saat render server, dan memaksanya membuat hidrasi tidak cocok.
  // Penyetelannya ditunda ke microtask — menyetel state SAAT efek berjalan
  // dilarang lint (react-hooks/set-state-in-effect) dan memang bisa memicu
  // render bersarang.
  const [siap, setSiap] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setSiap(true));
  }, []);

  useEffect(() => {
    if (!kunciGulir) return;
    const semula = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = semula;
    };
  }, [kunciGulir]);

  if (!siap) return null;
  return createPortal(
    <div style={{ zIndex: LAPIS[lapis] }} className={`fixed inset-0 ${className}`} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
