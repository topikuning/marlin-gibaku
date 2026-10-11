"use client";

import { useSyncExternalStore } from "react";
import { KUERI_TERPASANG, iniAplikasiTerpasang } from "@/lib/cetak/mode-cetak";
import { iniIos } from "@/lib/pwa/pasang";

/**
 * KEADAAN PERANGKAT UNTUK KOMPONEN KLIEN – terpasang atau tidak, iPhone atau
 * tidak, bisa membagikan berkas atau tidak.
 *
 * Lewat `useSyncExternalStore` dengan nilai server `false`: server tidak tahu
 * apa-apa tentang perangkat, jadi HTML awal selalu versi peramban biasa, lalu
 * React menyesuaikan sesudah hidrasi. Tanpa itu nilai yang dibaca saat render
 * pertama berbeda antara server dan klien (hydration mismatch).
 */

type NavigatorIos = Navigator & { standalone?: boolean };

export function bacaAplikasiTerpasang(): boolean {
  return iniAplikasiTerpasang(
    (q) => window.matchMedia?.(q).matches === true,
    (navigator as NavigatorIos).standalone,
  );
}

function langgananModeTampilan(ubah: () => void): () => void {
  const daftar = KUERI_TERPASANG.flatMap((q) => {
    const m = window.matchMedia?.(q);
    return m ? [m] : [];
  });
  for (const m of daftar) m.addEventListener?.("change", ubah);
  return () => {
    for (const m of daftar) m.removeEventListener?.("change", ubah);
  };
}

const tanpaLangganan = () => () => {};
const diServer = () => false;

function bacaIos(): boolean {
  return iniIos(navigator.userAgent, navigator.maxTouchPoints, navigator.platform);
}

let bagikanBerkas: boolean | null = null;
/** `canShare({ files })` dengan PDF uji – dibaca sekali, tidak berubah selama halaman hidup. */
function bacaBisaBagikanBerkas(): boolean {
  if (bagikanBerkas === null) {
    try {
      bagikanBerkas =
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [new File([new Uint8Array(1)], "cek.pdf", { type: "application/pdf" })] });
    } catch {
      bagikanBerkas = false;
    }
  }
  return bagikanBerkas;
}

/** Halaman dibuka dari ikon di layar depan (PWA terpasang). */
export function useAplikasiTerpasang(): boolean {
  return useSyncExternalStore(langgananModeTampilan, bacaAplikasiTerpasang, diServer);
}

export function useIos(): boolean {
  return useSyncExternalStore(tanpaLangganan, bacaIos, diServer);
}

export function useBisaBagikanBerkas(): boolean {
  return useSyncExternalStore(tanpaLangganan, bacaBisaBagikanBerkas, diServer);
}
