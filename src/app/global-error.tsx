"use client";

// Jaring terakhir: galat yang terjadi di layout root sendiri tidak tertangkap
// batas galat per-segmen, jadi Next mengganti seluruh dokumen. Karena itu
// berkas ini WAJIB menggambar <html> dan <body>-nya sendiri.
import "./globals.css";
import { PanelGalat } from "@/components/shell/panel-galat";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body>
        <PanelGalat error={error} reset={reset} judul="Aplikasi berhenti" />
      </body>
    </html>
  );
}
