/**
 * KETERANGAN ASAL PESAN WHATSAPP (DECISIONS baru 2026-10-07).
 *
 * Keluhan user: *"marlin mengirim data dari sistem ke wa … siapa yg request?
 * perlu diketahui siapa peminta data agar jelas"*. Pesan MARLIN di grup tampil
 * dari satu nomor yang sama, entah dikirim karena seseorang menekan tombol di
 * aplikasi, entah terjadwal. Anggota grup tidak bisa membedakannya.
 *
 * Aturannya:
 *   - dikirim dari tombol di aplikasi → baris "atas permintaan Nama (Peran)";
 *   - terjadwal → baris "Pesan otomatis MARLIN – …";
 *   - jawaban atas pertanyaan di grup → MENGUTIP pesan penanyanya (lihat
 *     `konteks-balasan.ts`), jadi tidak perlu baris tambahan.
 *
 * Murni (tanpa db) supaya kalimatnya bisa diuji.
 */
import { ROLE_LABEL } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

export type Peminta = {
  /** Akun MARLIN peminta, bila ada – dicatat di outbox. */
  userId: string | null;
  /** Label seperti tertulis di pesan. */
  label: string;
};

/** Peminta dari pengguna MARLIN yang sedang masuk. */
export function pemintaPengguna(u: { id: string; fullName: string; role: UserRole }): Peminta {
  const nama = u.fullName.trim() || "pengguna MARLIN";
  return { userId: u.id, label: `${nama} (${ROLE_LABEL[u.role] ?? u.role})` };
}

/** Baris penutup untuk kiriman yang diminta orang lewat aplikasi. */
export function catatanPeminta(p: Peminta): string {
  return `_Dikirim lewat MARLIN atas permintaan ${p.label}._`;
}

/** Baris penutup untuk kiriman terjadwal – tidak ada orang yang memintanya hari ini. */
export function catatanOtomatis(keterangan: string): string {
  return `_Pesan otomatis MARLIN – ${keterangan}._`;
}

/** Tempelkan baris keterangan di bawah teks/caption, dipisah satu baris kosong. */
export function denganCatatan(teks: string | undefined | null, catatan: string): string {
  const t = (teks ?? "").trimEnd();
  return t ? `${t}\n\n${catatan}` : catatan;
}
