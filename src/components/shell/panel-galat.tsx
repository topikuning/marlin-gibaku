"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, RotateCcw } from "lucide-react";

/**
 * Layar galat yang MENYEBUT galatnya.
 *
 * Sebelum ini seluruh aplikasi tidak punya satu pun error boundary. Akibatnya
 * setiap galat di sisi peramban — bukan di server — meruntuhkan halaman jadi
 * layar bawaan Next yang berbunyi "application error, reload", tanpa nama,
 * tanpa pesan, dan TANPA JEJAK DI LOG SERVER (karena memang tidak ada
 * permintaan yang pernah dikirim). Dari sisi pelapor: kerja hilang, sebabnya
 * gaib. Dari sisi kami: tidak ada apa pun untuk diperiksa.
 *
 * Pelapor kami bekerja di lapangan dengan ponsel — tidak ada inspect element,
 * tidak ada console. Jadi satu-satunya kanal diagnosis yang tersedia adalah
 * LAYAR ITU SENDIRI: nama galat, pesan, alamat halaman, dan identitas peramban
 * ditulis apa adanya supaya bisa difoto atau disalin dan dikirim.
 *
 * Identitas peramban ikut ditulis dengan sengaja: galat yang hanya muncul di
 * satu merek/versi peramban mustahil dipersempit tanpa itu, dan menebak-nebak
 * perangkat pelapor sudah terbukti membuang waktu berhari-hari.
 */
export function PanelGalat({
  error,
  reset,
  judul = "Halaman ini berhenti",
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  judul?: string;
}) {
  const [disalin, setDisalin] = useState(false);
  const [konteks, setKonteks] = useState("");
  const jam = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Alamat & peramban hanya ada di klien; dibaca sesudah render supaya HTML
  // server dan klien tidak berbeda.
  useEffect(() => {
    // Ditunda ke microtask supaya tidak menyetel state saat efek berjalan.
    queueMicrotask(() =>
      setKonteks(`${window.location.pathname}${window.location.search}\n${navigator.userAgent}`),
    );
  }, []);

  useEffect(() => {
    // Selalu tulis ke console juga — kalau kebetulan perangkatnya BISA
    // di-inspect, jejaknya tetap ada tanpa perlu menyalin.
    console.error("[marlin] galat klien", error);
  }, [error]);

  const rincian = [
    `${error.name}: ${error.message}`,
    error.digest ? `digest: ${error.digest}` : null,
    konteks,
  ]
    .filter(Boolean)
    .join("\n");

  const salin = () => {
    void navigator.clipboard
      ?.writeText(rincian)
      .then(() => {
        setDisalin(true);
        if (jam.current) clearTimeout(jam.current);
        jam.current = setTimeout(() => setDisalin(false), 2500);
      })
      .catch(() => {
        // Papan klip diblokir (lazim di WebView). Teksnya toh sudah terlihat
        // dan bisa difoto — jangan menambah galat di atas galat.
        setDisalin(false);
      });
  };

  useEffect(
    () => () => {
      if (jam.current) clearTimeout(jam.current);
    },
    [],
  );

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-lg font-semibold text-ink">{judul}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Yang sudah tersimpan tidak hilang. Yang belum sempat disimpan perlu diisi ulang.
      </p>

      <div className="mt-4 rounded-lg border border-danger-border bg-danger-soft p-3">
        <p className="text-xs font-medium text-danger">Rincian galat – kirim ini saat melapor</p>
        <pre className="mt-1.5 max-h-60 overflow-auto text-[11px] leading-relaxed break-words whitespace-pre-wrap text-ink">
          {rincian}
        </pre>
        <button
          type="button"
          onClick={salin}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
        >
          <Copy aria-hidden className="size-3.5" />
          {disalin ? "Tersalin" : "Salin rincian"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {reset ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"
          >
            <RotateCcw aria-hidden className="size-4" /> Coba lagi
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted"
        >
          <RefreshCw aria-hidden className="size-4" /> Muat ulang halaman
        </button>
      </div>
    </div>
  );
}
