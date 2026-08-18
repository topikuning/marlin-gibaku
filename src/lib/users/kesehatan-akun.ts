/**
 * KESEHATAN AKUN — masalah yang membuat sebuah akun tidak berguna, murni tanpa
 * DB (DECISIONS 359).
 *
 * Daftar pengguna sebelumnya menampilkan fakta ("Tanpa penugasan", "Wajib ganti
 * password") berdampingan dengan fakta lain, tanpa memberi tahu mana yang
 * berarti akun itu TIDAK BISA DIPAKAI. Modul ini yang memutuskan hal itu, di
 * satu tempat, supaya bilah ringkasan di atas daftar dan lencana di tiap baris
 * tidak bisa berselisih.
 */

import { isCrossLocation } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

export type AkunRingkas = {
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  waNumber: string | null;
  /** Penugasan lokasi yang MASIH aktif (`unassignedAt: null`). */
  jumlahPenugasan: number;
  pernahMasuk: boolean;
};

export type MasalahAkun = "tanpa_penugasan" | "belum_dipakai" | "tanpa_wa" | "nonaktif";

/** Kalimat pendek untuk lencana di baris. */
export const LABEL_MASALAH: Record<MasalahAkun, string> = {
  tanpa_penugasan: "Tanpa penugasan",
  belum_dipakai: "Belum pernah masuk",
  tanpa_wa: "Tanpa nomor WA",
  nonaktif: "Nonaktif",
};

/**
 * Peran yang percuma tanpa penugasan lokasi.
 *
 * Diturunkan DARI aturan akses yang sebenarnya (`isCrossLocation`), bukan dari
 * daftar peran yang ditulis ulang di sini: kalau suatu saat sebuah peran
 * dipindah ke lintas-lokasi, daftar salinan akan tetap menuduhnya bermasalah.
 */
export function butuhPenugasan(role: UserRole): boolean {
  return !isCrossLocation(role);
}

export function masalahAkun(a: AkunRingkas): MasalahAkun[] {
  // Akun nonaktif hanya dilaporkan "nonaktif". Ia memang sengaja tidak bisa
  // dipakai, jadi menuduhnya "tanpa penugasan" atau "tanpa nomor WA" hanya
  // menggelembungkan hitungan masalah dengan hal yang tak perlu dikerjakan.
  if (!a.isActive) return ["nonaktif"];

  const m: MasalahAkun[] = [];
  if (butuhPenugasan(a.role) && a.jumlahPenugasan === 0) m.push("tanpa_penugasan");
  // Password awal masih yang diketikkan pembuatnya, dan belum ada yang
  // menggantinya karena akunnya belum pernah dipakai sama sekali.
  if (a.mustChangePassword && !a.pernahMasuk) m.push("belum_dipakai");
  if (!terisi(a.waNumber)) m.push("tanpa_wa");
  return m;
}

function terisi(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}
