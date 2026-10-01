import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Penanda server non-produksi (DECISIONS 640). Kuning bergaris – pola
 * "area kerja" yang dikenali tanpa perlu dibaca – di tempat yang SELALU
 * terlihat: kepala aplikasi (lengket saat menggulir), puncak sidebar, dan
 * halaman masuk. Produksi tidak menampilkan apa pun; labelnya dari
 * `labelLingkungan()`.
 */

/** Latar bergaris kuning, berbasis token (tanpa hex). */
export const LATAR_PENANDA =
  "bg-warning-soft bg-[repeating-linear-gradient(135deg,var(--color-warning-border)_0_10px,transparent_10px_20px)]";

/** Lencana di kepala aplikasi: "SERVER UJI · DEV". */
export function LencanaLingkungan({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-warning bg-warning px-2 py-1 text-[11px] font-bold tracking-wide whitespace-nowrap text-white uppercase",
        className,
      )}
      title="Server uji – data di sini bukan data resmi"
    >
      <FlaskConical aria-hidden className="size-3.5" />
      <span className="hidden sm:inline">Server uji ·</span> {label}
    </span>
  );
}

/** Pita selebar layar untuk halaman tanpa kerangka aplikasi (masuk, ganti sandi). */
export function PitaLingkungan({ label }: { label: string }) {
  return (
    <div
      role="note"
      className={cn(
        LATAR_PENANDA,
        "no-print flex items-center justify-center gap-2 border-b-2 border-warning px-4 py-2 text-center text-[13px] text-ink",
      )}
    >
      <LencanaLingkungan label={label} />
      <span className="font-medium">Data di sini bukan data resmi.</span>
    </div>
  );
}
