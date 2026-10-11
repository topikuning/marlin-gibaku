"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { klikBiasa } from "@/components/ui/unduh";
import { tautanCetakDalamAplikasi } from "@/lib/cetak/mode-cetak";
import { bacaAplikasiTerpasang } from "./mode-tampilan";

/**
 * Di APLIKASI TERPASANG, tautan cetak "tab baru" dibuka di tempat.
 *
 * Beberapa tombol cetak sengaja ber-`target="_blank"` – di peramban komputer
 * versi cetak memang enak dibuka di tab sebelah. Di aplikasi terpasang tidak:
 * di iPhone "tab baru" adalah peramban lain yang TIDAK membawa sesi aplikasi,
 * jadi pemakai mendarat di halaman masuk, bukan di laporannya. Itu salah satu
 * wujud "tidak bisa mencetak di PWA" (laporan user 2026-10-11).
 *
 * Hanya `/cetak/*` yang ditahan (lihat `tautanCetakDalamAplikasi`): halaman itu
 * punya tombol Kembali sendiri, dan tombol cetaknya tahu cara mencetak dari
 * aplikasi terpasang. Di peramban biasa komponen ini tidak berbuat apa-apa.
 *
 * Satu pendengar di dokumen, bukan prop di tiap tombol: tautan cetak tersebar
 * di banyak layar, dan yang dipasang per layar akan terlewat di layar
 * berikutnya.
 */
export function PenahanTabCetak() {
  const router = useRouter();

  useEffect(() => {
    const tangkap = (e: MouseEvent) => {
      if (e.defaultPrevented || !klikBiasa(e)) return;
      if (!bacaAplikasiTerpasang()) return;
      const a = e.target instanceof Element ? e.target.closest("a[target='_blank']") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const jalur = tautanCetakDalamAplikasi(
        a.getAttribute("href") ?? "",
        window.location.origin,
        `${window.location.pathname}${window.location.search}`,
      );
      if (!jalur) return;
      e.preventDefault();
      router.push(jalur);
    };
    document.addEventListener("click", tangkap);
    return () => document.removeEventListener("click", tangkap);
  }, [router]);

  return null;
}
