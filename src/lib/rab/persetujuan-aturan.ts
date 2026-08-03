/**
 * ATURAN PERSETUJUAN AKTIVASI ADENDUM — MODUL MURNI, tanpa db.
 *
 * Keputusan user 2026-08-03: *"pengaktifan adendum harus dua orang, program
 * director dan satu orang di level yang ditugaskan bisa AM/SM/PM, bahkan super
 * admin pun tidak boleh mengaktifkan sendiri, harus ada program director yang
 * juga approve."*
 *
 * Mengaktifkan adendum MENGGANTI RAB kontrak yang berlaku dan me-regenerate
 * kurva-S — nilai kontrak, progres, dan termin semuanya bergeser sekaligus. Itu
 * kelas keputusan yang tidak boleh bisa dilakukan satu orang, sekuat apa pun
 * perannya. Empat mata, bukan satu.
 *
 * Dipisah dari `persetujuan.ts` (yang menarik db) supaya aturannya bisa diuji
 * langsung — aturan tata kelola yang tidak diuji sama saja dengan tidak ada.
 *
 * DECISIONS 234.
 */

import type { UserRole } from "@/generated/prisma/enums";

/** Peran yang sah mengisi kursi KEDUA (pelaksana penugasan di lapangan). */
export const PERAN_PENUGASAN: UserRole[] = ["regional_manager", "project_manager", "site_manager"];

/** Satu suara persetujuan atas sebuah draft revisi. */
export type Suara = {
  userId: string;
  role: UserRole;
  /** Peran yang dipakai saat menyetujui — disnapshot, bukan dibaca ulang. */
  approvedAt: Date;
};

export type StatusPersetujuan = {
  /** Semua syarat terpenuhi — aktivasi boleh jalan. */
  lengkap: boolean;
  adaDirektur: boolean;
  adaPenugasan: boolean;
  /** Alasan aktivasi masih ditolak; kosong bila `lengkap`. */
  kurang: string[];
};

/**
 * Apakah peran ini boleh memberi suara sama sekali.
 *
 * `super_admin` SENGAJA TIDAK ADA di sini. Ia bisa melakukan hampir semua hal
 * di sistem, dan justru itu alasannya: kalau super admin boleh mengisi salah
 * satu kursi, satu akun teknis bisa memenuhi separuh syarat tata kelola yang
 * seharusnya menuntut dua jabatan berbeda. Peran teknis bukan pengganti
 * tanggung jawab jabatan.
 */
export function bolehMenyetujui(role: UserRole): boolean {
  return role === "program_director" || PERAN_PENUGASAN.includes(role);
}

/**
 * Nilai kelengkapan persetujuan.
 *
 * Syaratnya DUA ORANG BERBEDA:
 * 1. tepat satu di antaranya `program_director`;
 * 2. satu lagi dari peran penugasan (AM/PM/SM).
 *
 * Orang yang sama tidak bisa mengisi dua kursi walau perannya berganti di
 * tengah jalan — itulah gunanya membandingkan `userId`, bukan hanya peran.
 */
export function nilaiPersetujuan(suara: Suara[]): StatusPersetujuan {
  const unik = new Map<string, Suara>();
  for (const s of suara) unik.set(s.userId, s);
  const daftar = [...unik.values()];

  const direktur = daftar.find((s) => s.role === "program_director");
  const penugasan = daftar.find((s) => PERAN_PENUGASAN.includes(s.role) && s.userId !== direktur?.userId);

  const kurang: string[] = [];
  if (!direktur) kurang.push("persetujuan Program Director");
  if (!penugasan) kurang.push("persetujuan Area Manager / Project Manager / Site Manager");

  return {
    lengkap: kurang.length === 0,
    adaDirektur: Boolean(direktur),
    adaPenugasan: Boolean(penugasan),
    kurang,
  };
}

/**
 * Suara yang MASIH BERLAKU untuk isi draft saat ini.
 *
 * Menyetujui angka lalu mengubah angkanya adalah cara paling sederhana
 * melumpuhkan aturan empat mata: yang diaktifkan bukan lagi yang disetujui.
 * Karena setiap mutasi editor menulis ulang `totalValue` revisi, `updatedAt`
 * revisi adalah penanda perubahan yang bisa dipercaya — suara yang diberikan
 * SEBELUM perubahan terakhir otomatis gugur.
 */
export function suaraMasihBerlaku<T extends { approvedAt: Date }>(
  suara: T[],
  draftDiubahPada: Date,
): T[] {
  return suara.filter((s) => s.approvedAt.getTime() >= draftDiubahPada.getTime());
}
