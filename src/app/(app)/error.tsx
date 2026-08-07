"use client";

// Batas galat untuk SELURUH halaman ber-sesi. Tanpa ini, satu galat di sisi
// peramban (mis. API DOM yang tidak didukung ponsel tertentu) meruntuhkan
// halaman jadi layar bawaan Next tanpa nama dan tanpa jejak di log server.
import { PanelGalat } from "@/components/shell/panel-galat";

export default function Galat({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanelGalat error={error} reset={reset} />;
}
