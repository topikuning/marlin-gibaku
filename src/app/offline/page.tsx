import type { Metadata } from "next";
import { Camera, WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Tidak ada jaringan" };

/**
 * Halaman yang disajikan service worker saat navigasi gagal (DECISIONS 392).
 *
 * SENGAJA statis dan tanpa sesi: ia dijemput sekali saat service worker
 * dipasang, lalu hidup di HP. Menyentuh database atau branding di sini berarti
 * halaman ini ikut basi — dan yang paling penting darinya justru kalimat yang
 * tidak pernah berubah: ini keadaan jaringan, bukan aplikasi rusak, dan foto
 * yang sudah dijepret tidak hilang.
 *
 * Di luar (app) supaya tidak melewati penjaga sesi: orang yang sedang di luar
 * jangkauan tidak bisa dialihkan ke halaman masuk, dan tidak boleh disuruh.
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

        <a
          href="/foto-cepat"
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
        >
          <Camera aria-hidden className="size-4" /> Buka Foto Cepat
        </a>
        <p className="mt-2 text-[11px] text-ink-muted">
          Foto Cepat bisa dibuka tanpa sinyal bila pernah dibuka sebelumnya di HP ini.
        </p>
      </div>
    </main>
  );
}
