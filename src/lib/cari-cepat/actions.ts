"use server";

import { requireUser } from "@/lib/auth/session";
import { daftarCariCepat, type DaftarCepat } from "./daftar";

/**
 * Dimuat saat Cari Cepat DIBUKA, bukan di tiap halaman (DECISIONS 684): isi
 * daftar tidak ikut membebani muatan setiap navigasi di jaringan lapangan.
 * Hanya membaca – tanpa audit, sama seperti membuka halaman daftar.
 */
export async function muatCariCepat(): Promise<DaftarCepat> {
  return daftarCariCepat(await requireUser());
}
