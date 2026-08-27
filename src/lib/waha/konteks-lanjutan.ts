import "server-only";
import { db } from "@/lib/db";
import type { Niat } from "./tanya-niat";
import type { ParsedWaMessage } from "./ingest-parse";
import { kunciPengirim } from "./klarifikasi-kunci";
import { sanitizeConversationHistory, type AiConversationTurn } from "@/lib/ai/conversation";

/**
 * KONTEKS PERTANYAAN SUSULAN (DECISIONS 377).
 *
 * Percakapan lapangan tidak mengulang subjeknya. Orang menulis *"progress hari
 * ini di Kedung Mutih"*, lalu *"kalau kemarin?"* — dan pertanyaan kedua itu
 * benar-benar tidak berarti apa-apa sendirian. Sampai sekarang MARLIN
 * menawarinya daftar pilihan, padahal ia baru saja menjawab pertanyaan yang
 * melengkapinya.
 *
 * ### Riwayat percakapan yang dipagari
 *
 * Selain niat + nama lokasi terakhir untuk susulan deterministik, MARLIN
 * menyimpan maksimal delapan giliran tanya-jawab. Riwayat ini membantu model
 * membaca rujukan seperti "yang tadi", tetapi pesan terbaru selalu menang.
 *
 * Scope tidak pernah dipinjam dari riwayat. Setiap pesan tetap melewati resolver
 * kanal dan katalog izin saat ini; nama lokasi dari konteks dicocokkan ulang.
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

export type KonteksLanjutan = { niat: Niat | null; lokasiDisebut: string[]; history: AiConversationTurn[] };

export function bacaHistoryPercakapan(value: unknown): AiConversationTurn[] {
  return sanitizeConversationHistory(value);
}

/** Simpan pertanyaan yang BARU SAJA dijawab sebagai konteks berikutnya. */
export async function simpanKonteks(
  m: Pick<ParsedWaMessage, "chatId" | "senderJid" | "senderLid" | "fromNumber">,
  niat: Niat | null,
  lokasiDisebut: string[],
  sekarang = new Date(),
  exchange?: { question: string; answer: string },
): Promise<void> {
  const senderKey = kunciPengirim(m);
  if (!senderKey) return;

  const existing = exchange
    ? await db.waChatContext.findUnique({
        where: { chatId_senderKey: { chatId: m.chatId, senderKey } },
        select: { history: true },
      })
    : null;
  const history = exchange
    ? [
        ...bacaHistoryPercakapan(existing?.history),
        { role: "user" as const, content: exchange.question.slice(0, 2_000) },
        { role: "assistant" as const, content: exchange.answer.slice(0, 2_000) },
      ].slice(-8)
    : bacaHistoryPercakapan(existing?.history);

  const data = {
    niat,
    lokasiDisebut: lokasiDisebut as unknown as object,
    history: history as unknown as object,
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
    select: { niat: true, lokasiDisebut: true, history: true, expiresAt: true },
  });
  if (!baris) return null;
  if (baris.expiresAt.getTime() <= sekarang.getTime()) return null;

  const lokasi = baris.lokasiDisebut;
  return {
    niat: (baris.niat as Niat | null) ?? null,
    lokasiDisebut: Array.isArray(lokasi) ? (lokasi as string[]) : [],
    history: bacaHistoryPercakapan(baris.history),
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
