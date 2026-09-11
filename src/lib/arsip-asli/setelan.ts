import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * SAKELAR ARSIP DINGIN — di layar, bukan di variabel lingkungan.
 *
 * Teguran user 2026-09-09 atas rancangan yang menuntut 14 variabel baru:
 * *"terlalu banyak variable yang harus ditambahkan"*. Betul, dan sakelar
 * hidup/mati adalah contoh terburuknya: ia justru yang PALING sering perlu
 * diubah — saat mesin arsipnya dimatikan, saat jaringannya bermasalah, saat
 * mencoba pertama kali — sementara mengubah variabel lingkungan berarti deploy
 * ulang dan menunggu.
 *
 * Disimpan di `AppSetting` ber-tanggal-berlaku, pola yang sama dengan sakelar
 * lain di sistem ini (peta berkelompok, Drive otomatis, laporan mingguan):
 * perubahannya punya jejak waktu dan bisa ditelusuri.
 */

export const ARSIP_AKTIF_KEY = "arsip_asli.aktif";
export const ARSIP_TENGGANG_KEY = "arsip_asli.tenggang_hari";
/** Sakelar peringatan WhatsApp – TERPISAH dari sakelar arsipnya sendiri. */
export const ARSIP_WA_AKTIF_KEY = "arsip_asli.wa_aktif";
/** Tujuan peringatan: chatId grup WA, atau nomor ber-format WAHA. */
export const ARSIP_WA_TUJUAN_KEY = "arsip_asli.wa_tujuan";

/** MATI sampai dinyalakan. Fitur yang memindahkan berkas tidak boleh menyala sendiri. */
export const ARSIP_AKTIF_DEFAULT = false;

/**
 * Berapa lama salinan R2 dipertahankan SETELAH berkasnya terbukti aman di arsip
 * dingin.
 *
 * Rancangan awal menghapus sumbernya begitu checksum cocok. Tujuh hari ini
 * pilihan yang berbeda dan disengaja: selama seminggu tiap berkas punya dua
 * salinan sungguhan tanpa usaha tambahan, dan kalau arsip dinginnya ternyata
 * rewel di minggu-minggu pertama, kita masih bisa mundur tanpa kehilangan apa
 * pun. Sesudah lewat, penghapusannya jalan sendiri.
 *
 * Harganya jujur: pemakaian R2 baru mulai turun seminggu setelah arsip berjalan,
 * bukan seketika. Bisa diatur di layar — 0 berarti buang segera.
 */
export const ARSIP_TENGGANG_DEFAULT = 7;

/**
 * Peringatan WA MATI sampai dinyalakan, sama seperti arsipnya.
 *
 * Sakelarnya sendiri, bukan menumpang sakelar arsip, karena keduanya dimatikan
 * karena alasan yang berbeda: arsip dimatikan saat mesinnya sedang diperbaiki,
 * peringatan dimatikan saat orangnya sedang tidak ingin diganggu. Menggabungkan
 * keduanya berarti mematikan yang satu diam-diam mematikan yang lain — dan yang
 * ikut mati justru pemberitahuannya.
 */
export const ARSIP_WA_AKTIF_DEFAULT = false;

async function nilai(key: string): Promise<string | null> {
  const baris = await db.appSetting.findFirst({
    where: { key, effectiveFrom: { lte: jakartaToday() } },
    orderBy: { effectiveFrom: "desc" },
    select: { value: true },
  });
  return baris?.value ?? null;
}

export async function arsipAktif(): Promise<boolean> {
  const v = await nilai(ARSIP_AKTIF_KEY);
  return v == null ? ARSIP_AKTIF_DEFAULT : v === "1";
}

export async function tenggangHari(): Promise<number> {
  const v = await nilai(ARSIP_TENGGANG_KEY);
  const n = v == null ? ARSIP_TENGGANG_DEFAULT : Number(v);
  // Angka aneh (negatif, bukan bilangan) jangan sampai menghapus lebih cepat
  // daripada yang diminta siapa pun — kembali ke bawaan, bukan ke nol.
  return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.floor(n) : ARSIP_TENGGANG_DEFAULT;
}

export async function waArsipAktif(): Promise<boolean> {
  const v = await nilai(ARSIP_WA_AKTIF_KEY);
  return v == null ? ARSIP_WA_AKTIF_DEFAULT : v === "1";
}

export async function waArsipTujuan(): Promise<string | null> {
  const v = (await nilai(ARSIP_WA_TUJUAN_KEY))?.trim();
  return v ? v : null;
}

export async function setWaArsip(aktif: boolean, tujuan: string): Promise<void> {
  await simpan(ARSIP_WA_AKTIF_KEY, aktif ? "1" : "0");
  await simpan(ARSIP_WA_TUJUAN_KEY, tujuan.trim());
}

export async function setArsipAktif(aktif: boolean): Promise<void> {
  await simpan(ARSIP_AKTIF_KEY, aktif ? "1" : "0");
}

export async function setTenggangHari(hari: number): Promise<void> {
  await simpan(ARSIP_TENGGANG_KEY, String(Math.max(0, Math.min(365, Math.floor(hari)))));
}

async function simpan(key: string, value: string): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key, effectiveFrom } },
    create: { key, value, effectiveFrom },
    update: { value },
  });
}
