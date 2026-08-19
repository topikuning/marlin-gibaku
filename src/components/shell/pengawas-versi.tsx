"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Peringatkan saat tab ini lebih tua daripada server.
 *
 * Laporan user 2026-08-07, dari dua halaman berbeda dan dua peramban berbeda:
 *
 *     UnrecognizedActionError: Server Action "602cf4e1…" was not found on the
 *     server. → /lokasi/sugihwaras-sugihwaras/rab/adendum (Firefox)
 *     Error: An unexpected response was received from the server.
 *     → /lokasi/kranji-kranji/harian/2026-08-01 (Chrome)
 *
 * Keduanya satu sebab. ID server action di-hash PER BUILD; sesudah deploy,
 * halaman yang sudah telanjur terbuka membawa ID yang tidak ada lagi di server,
 * dan Next menolaknya lewat header `x-nextjs-action-not-found`. Aksinya tidak
 * pernah jalan — itulah kenapa log server kosong dan kenapa hanya production
 * yang kena (di dev tidak ada deploy yang menyalip tab).
 *
 * Kenapa perlu PROAKTIF, bukan cukup pesan saat gagal: tab di lapangan dibuka
 * berjam-jam. Kalau baru tahu saat menekan Simpan, kerja yang sudah diketik dan
 * foto yang sudah dilampirkan sudah telanjur — dan memuat ulang menghapusnya.
 * Diberi tahu lebih awal, pelapor bisa memuat ulang SEBELUM mulai mengisi.
 *
 * TIDAK PERNAH memuat ulang sendiri. Muat ulang otomatis di tengah pengisian
 * persis kerusakan yang sedang dicegah — keputusannya milik pelapor.
 */
const JEDA_MS = 5 * 60 * 1000;

export function PengawasVersi() {
  const [basi, setBasi] = useState(false);
  const milikTab = useRef(process.env.MARLIN_BUILD_ID ?? "");

  const periksa = useCallback(async () => {
    // Tanpa penanda build (mis. dev tanpa konfigurasi) tidak ada yang bisa
    // dibandingkan — diam lebih baik daripada peringatan yang mengarang.
    if (!milikTab.current) return;
    try {
      const r = await fetch("/api/versi", { cache: "no-store" });
      if (!r.ok) return;
      const d: unknown = await r.json();
      const server = typeof d === "object" && d && "build" in d ? String(d.build) : "";
      if (server && server !== milikTab.current) setBasi(true);
    } catch {
      // Jaringan putus bukan versi baru. Jangan menuduh.
    }
  }, []);

  useEffect(() => {
    if (basi) return; // sudah ketahuan basi — berhenti menanya.
    // Ditunda ke microtask supaya tidak menyetel state saat efek berjalan.
    queueMicrotask(() => void periksa());
    const jam = window.setInterval(() => void periksa(), JEDA_MS);
    // Kembali ke tab adalah saat paling mungkin ada deploy terlewat, dan saat
    // paling murah untuk memberitahu (pelapor belum mulai mengetik lagi).
    const saatFokus = () => void periksa();
    window.addEventListener("focus", saatFokus);
    return () => {
      window.clearInterval(jam);
      window.removeEventListener("focus", saatFokus);
    };
  }, [basi, periksa]);

  if (!basi) return null;

  return (
    <div className="sticky top-0 z-[900] border-b border-warning-border bg-warning-soft px-4 py-2">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-xs text-ink">
          <strong className="font-medium">MARLIN sudah diperbarui</strong> sejak halaman ini dibuka.
          Muat ulang sebelum menyimpan – kalau tidak, kiriman dari halaman ini akan ditolak.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800"
        >
          <RefreshCw aria-hidden className="size-3.5" /> Muat ulang
        </button>
        <span className="text-[11px] text-ink-muted">
          Isian yang belum disimpan akan hilang – simpan dulu bila sudah sempat mengisi.
        </span>
      </div>
    </div>
  );
}
