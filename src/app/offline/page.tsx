import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { PintuFotoCepat } from "@/components/pwa/pintu-foto-cepat";

export const metadata: Metadata = { title: "Tidak ada jaringan" };

/**
 * Halaman yang disajikan service worker saat navigasi gagal (DECISIONS 398).
 *
 * SENGAJA statis dan tanpa sesi: ia dijemput sekali saat service worker
 * dipasang, lalu hidup di HP. Menyentuh database atau branding di sini berarti
 * halaman ini ikut basi — dan yang paling penting darinya justru kalimat yang
 * tidak pernah berubah: ini keadaan jaringan, bukan aplikasi rusak, dan foto
 * yang sudah dijepret tidak hilang.
 *
 * Di luar (app) supaya tidak melewati penjaga sesi: orang yang sedang di luar
 * jangkauan tidak bisa dialihkan ke halaman masuk, dan tidak boleh disuruh.
 * Berada di luar (app) saja TIDAK cukup — middleware menjaga seluruh jalur, jadi
 * `/offline` juga terdaftar di `PUBLIC_PATHS` (`src/middleware.ts`). Tanpa itu
 * service worker menyimpan halaman masuk di bawah kunci `/offline` saat
 * pemasangan; dijaga `tests/unit/middleware-rute-publik.test.ts`.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-warning-soft">
          <WifiOff aria-hidden className="size-6 text-warning" />
        </span>
        <h1 className="text-base font-semibold text-ink">Tidak ada jaringan</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Halaman yang Anda buka butuh data dari server, dan HP ini sedang tidak
          terhubung. Bukan aplikasinya yang rusak – cari sinyal sebentar, lalu buka lagi.
        </p>

        <div className="mt-5 rounded-lg bg-surface-muted p-3 text-left">
          <p className="text-[13px] font-medium text-ink">Yang tetap aman</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Foto yang sudah terlanjur dijepret tersimpan di HP ini dan terkirim
            sendiri begitu sinyal kembali. Anda tidak perlu memotret ulang.
          </p>
        </div>

        <PintuFotoCepat />
      </div>
    </main>
  );
}
