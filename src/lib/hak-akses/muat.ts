import "server-only";
import { db } from "@/lib/db";
import { pasangPenggantiHakAkses, type PenggantiHakAkses } from "@/lib/authz";
import { susunPengganti } from "./susun";

/**
 * Memuat hak akses yang diatur Super Admin (tabel `hak_akses_peran`, DECISIONS
 * 793) ke `can()`. `can()` sinkron dan dipanggil ratusan tempat, jadi isinya
 * dipasang di memori proses dan disegarkan paling lambat tiap 30 detik – dari
 * `getCurrentUser` (setiap permintaan bersesi) dan webhook WhatsApp. Proses
 * yang menyimpan perubahan langsung menyegarkan dirinya sendiri.
 */
const UMUR_MS = 30_000;
let dimuatPada = 0;
let sedang: Promise<void> | null = null;

/** Isi tabel saat ini, langsung dari DB (untuk layar pengaturan dan aksi simpan). */
export async function bacaPenggantiHakAkses(): Promise<PenggantiHakAkses> {
  const rows = await db.hakAksesPeran.findMany({ select: { role: true, capability: true, boleh: true } });
  return susunPengganti(rows);
}

async function muat(): Promise<void> {
  try {
    pasangPenggantiHakAkses(await bacaPenggantiHakAkses());
    dimuatPada = Date.now();
  } catch (e) {
    // Tabel belum ada (migrasi belum jalan) atau DB sesaat tidak terjangkau:
    // pengaturan terakhir yang diketahui tetap dipakai, bawaan bila belum pernah.
    console.error("[hak-akses] gagal memuat pengaturan:", e instanceof Error ? e.message : e);
  }
}

/** Pastikan pengaturan di memori tidak lebih tua dari 30 detik. */
export async function pastikanHakAkses(): Promise<void> {
  if (Date.now() - dimuatPada < UMUR_MS) return;
  sedang ??= muat().finally(() => {
    sedang = null;
  });
  await sedang;
}

/** Muat ulang sekarang – dipanggil sesudah pengaturan disimpan. */
export async function segarkanHakAkses(): Promise<void> {
  dimuatPada = 0;
  await pastikanHakAkses();
}
