"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Strip progres di PONSEL tampil di semua tab lokasi KECUALI halaman input
 * laporan harian (DECISIONS 737).
 *
 * Permintaan user 2026-08-02 tetap berlaku di sana: *"untuk tampilan mobile
 * pada halaman input pekerjaan … informasi di atas inputan seperti progress
 * dll, di hide saja"* – mandor harus bisa langsung mengisi tanpa menggulir.
 * Permintaan 2026-11-02 (*"untuk mobile juga perlu informasi ini"*) berlaku
 * di tab lainnya. Kalender harian (`/harian`) bukan halaman input, jadi
 * strip tetap tampil di sana.
 */
export function TampilKecualiInputHarian({ slug, children }: { slug: string; children: ReactNode }) {
  const path = usePathname();
  if (path.startsWith(`/lokasi/${slug}/harian/`)) return null;
  return <>{children}</>;
}
