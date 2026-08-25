import "server-only";
import { db } from "@/lib/db";
import type { Niat } from "./tanya-niat";
import type { ParsedWaMessage } from "./ingest-parse";
import { kunciPengirim } from "./klarifikasi-kunci";

/**
 * KONTEKS PERTANYAAN SUSULAN (DECISIONS 377).
 *
 * Percakapan lapangan tidak mengulang subjeknya. Orang menulis *"progress hari
 * ini di Kedung Mutih"*, lalu *"kalau kemarin?"* — dan pertanyaan kedua itu
 * benar-benar tidak berarti apa-apa sendirian. Sampai sekarang MARLIN
 * menawarinya daftar pilihan, padahal ia baru saja menjawab pertanyaan yang
 * melengkapinya.
 *
 * ### Bukan penulisan ulang oleh AI
 *
 * Brief menyebut "6–10 pesan terakhir dipakai HANYA untuk menulis ulang
 * pertanyaan susulan menjadi pertanyaan yang berdiri sendiri". Yang dipakai di
 * sini lebih sempit dan lebih murah: bukan riwayat pesan mentah yang dibaca AI,
 * melainkan **pertanyaan terakhir yang sudah selesai diresolusi** — niat + nama
 * lokasi yang benar-benar dipakai menjawab.
 *
 * Alasannya dua, dan keduanya soal keandalan, bukan ongkos:
 *
 * 1. **Tepat, bukan tafsir.** Kita sudah TAHU apa yang dijawab tadi; menyuruh
 *    AI menyimpulkannya kembali dari teks mentah hanya menambah kesempatan
 *    salah pada informasi yang sudah pasti.
 * 2. **Tidak bisa mengarang lingkup.** Model yang membaca riwayat bisa
 *    memunculkan nama lokasi yang tidak pernah ditulis siapa pun. Di sini tidak
 *    ada yang bisa dikarang: yang tersimpan persis apa yang diketik.
 *
 * ### Kenapa NAMA, bukan id lokasi
 *
 * Yang disimpan nama apa adanya, lalu dicocokkan ULANG terhadap katalog yang
 * berlaku saat susulan datang. Itu yang membuat riwayat **tidak pernah bisa
 * memperlebar lingkup** (syarat keras brief butir 23): lokasi yang sudah di
 * luar hak penanya, atau di luar paket grup tempat ia bertanya sekarang, tidak
 * akan cocok lagi. Menyimpan id hasil resolusi akan mengawetkan izin lama.
 */

/**
 * Umur konteks.
 *
 * Konteks BASI lebih berbahaya daripada tidak ada konteks: ia menjawab
 * pertanyaan lama dengan percaya diri. Setengah jam cukup untuk satu rangkaian
 * tanya-jawab, dan terlalu pendek untuk menyambung percakapan kemarin.
 */
export const UMUR_KONTEKS_MENIT = 30;

export type KonteksLanjutan = { niat: Niat; lokasiDisebut: string[] };

/** Simpan pertanyaan yang BARU SAJA dijawab sebagai konteks berikutnya. */
export async function simpanKonteks(
  m: Pick<ParsedWaMessage, "chatId" | "senderJid" | "senderLid" | "fromNumber">,
  niat: Niat,
  lokasiDisebut: string[],
  sekarang = new Date(),
): Promise<void> {
  const senderKey = kunciPengirim(m);
  if (!senderKey) return;

  const data = {
    niat,
    lokasiDisebut: lokasiDisebut as unknown as object,
    expiresAt: new Date(sekarang.getTime() + UMUR_KONTEKS_MENIT * 60_000),
  };
  await db.waChatContext.upsert({
    where: { chatId_senderKey: { chatId: m.chatId, senderKey } },
    create: { chatId: m.chatId, senderKey, ...data },
    update: data,
  });
}

/** Konteks yang masih hidup untuk penanya ini di chat ini. */
export async function ambilKonteks(
  m: Pick<ParsedWaMessage, "chatId" | "senderJid" | "senderLid" | "fromNumber">,
  sekarang = new Date(),
): Promise<KonteksLanjutan | null> {
  const senderKey = kunciPengirim(m);
  if (!senderKey) return null;

  const baris = await db.waChatContext.findUnique({
    where: { chatId_senderKey: { chatId: m.chatId, senderKey } },
    select: { niat: true, lokasiDisebut: true, expiresAt: true },
  });
  if (!baris) return null;
  if (baris.expiresAt.getTime() <= sekarang.getTime()) return null;

  const lokasi = baris.lokasiDisebut;
  return {
    niat: baris.niat as Niat,
    lokasiDisebut: Array.isArray(lokasi) ? (lokasi as string[]) : [],
  };
}

/** Buang konteks yang sudah lewat umurnya — dipanggil cron WAHA. */
export async function bersihkanKonteksBasi(sekarang = new Date()): Promise<number> {
  const r = await db.waChatContext.deleteMany({
    where: { expiresAt: { lt: new Date(sekarang.getTime() - 60 * 60_000) } },
  });
  return r.count;
}

/**
 * Lepaskan konteks percakapan atas permintaan penanya (DECISIONS 390).
 *
 * User 2026-08-20 mengetik *"abaikan"* setelah menerima jawaban yang salah,
 * dan MARLIN membalas "belum mengerti" – lalu pertanyaan berikutnya TETAP
 * tersambung ke konteks lama. Reaksi itu wajar dan seharusnya bisa dipenuhi:
 * satu-satunya cara melepas konteks sebelum ini adalah menunggu 30 menit atau
 * mengajukan pertanyaan yang lengkap.
 *
 * Mengembalikan `true` bila memang ada yang dilepas – dipakai balasan untuk
 * membedakan "sudah saya lupakan" dari "memang tidak ada yang saya ingat".
 */
export async function lupakanKonteks(
  m: Pick<ParsedWaMessage, "chatId" | "senderJid" | "senderLid" | "fromNumber">,
): Promise<boolean> {
  const senderKey = kunciPengirim(m);
  if (!senderKey) return false;
  const hapus = await db.waChatContext.deleteMany({ where: { chatId: m.chatId, senderKey } });
  return hapus.count > 0;
}
