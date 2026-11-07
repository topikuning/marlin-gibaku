"use client";

import { MapPin } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { tautanGoogleMaps } from "@/lib/peta/google-maps";

/**
 * "Buka di Google Maps" untuk satu lokasi (DECISIONS 749).
 *
 * Tiga rupa untuk tiga tempat, satu sumber URL (`tautanGoogleMaps`):
 * - `teks`  – tautan di samping alamat (header lokasi, kartu Hari Ini);
 * - `tombol` – tombol sekunder di baris aksi (panel Peta, kartu koordinat);
 * - `ikon`  – ikon saja untuk baris sempit (header ponsel, daftar lokasi),
 *   tetap 44 px di layar sentuh (DECISIONS 731) dan berlabel untuk pembaca layar.
 *
 * Koordinat kosong / 0,0 / mustahil → tidak merender apa pun. Tombol mati yang
 * tidak bisa dijelaskan lebih membingungkan daripada tidak ada tombol.
 *
 * Tab baru: halaman MARLIN yang sedang dibuka (sering laporan setengah jadi)
 * tidak boleh tergantikan peta.
 */
export function TautanGoogleMaps({
  lat,
  lng,
  rupa = "teks",
  className,
}: {
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
  rupa?: "teks" | "tombol" | "ikon";
  className?: string;
}) {
  const href = tautanGoogleMaps(lat, lng);
  if (!href) return null;

  const umum = {
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    title: "Buka titik lokasi ini di Google Maps (tab baru)",
  } as const;

  if (rupa === "ikon") {
    return (
      <a
        {...umum}
        aria-label="Buka di Google Maps"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-surface-muted pointer-coarse:size-11",
          className,
        )}
      >
        <MapPin aria-hidden className="size-4" />
      </a>
    );
  }

  if (rupa === "tombol") {
    return (
      <a {...umum} className={buttonClass("secondary", "sm", cn("gap-1.5", className))}>
        <MapPin aria-hidden className="size-3.5" />
        Buka di Google Maps
      </a>
    );
  }

  return (
    <a
      {...umum}
      className={cn(
        "inline-flex items-center gap-1 font-medium text-primary hover:underline pointer-coarse:min-h-11",
        className,
      )}
    >
      <MapPin aria-hidden className="size-3.5 shrink-0" />
      Buka di Google Maps
    </a>
  );
}
