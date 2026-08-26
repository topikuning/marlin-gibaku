import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { parseWaEvent } from "./ingest-parse";
import { jawabPertanyaanWa } from "./tanya";

/**
 * ANTREAN JAWABAN WhatsApp — durable, idempoten, dengan backoff dan
 * dead-letter (DECISIONS 372).
 *
 * ### Kenapa webhook tidak boleh menjalankan semuanya sendiri
 *
 * Sebelumnya `/api/waha/webhook` menunggu ingest → identitas → guard → provider
 * AI → query data → pengiriman WAHA sebelum mengembalikan 200. Rantai itu
 * memuat dua panggilan jaringan ke pihak lain (provider AI dan WAHA), dan
 * keduanya bisa lambat tanpa batas. Akibatnya berantai:
 *
 *  1. webhook timeout → WAHA menganggap gagal → **retry**;
 *  2. retry memicu AI dan balasan LAGI untuk pesan yang sama;
 *  3. kuota AI terhitung dua kali, penerima menerima dua pesan.
 *
 * `WaMessage.waMessageId` memang unique, tapi itu hanya menjaga ARSIP pesan
 * masuk — ia tidak pernah menjadi pagar bagi proses tanya-jawab dan pengiriman.
 *
 * ### Pagar idempotensinya
 *
 * `WaReplyJob.waMessageId` UNIQUE. Berapa pun kali WAHA mengirim event yang
 * sama — termasuk `message` dan `message.any` yang tiba berbarengan — hanya ada
 * satu baris pekerjaan. Balapan INSERT diselesaikan basis data (P2002), bukan
 * oleh pemeriksaan "sudah ada?" yang selalu punya celah di antaranya.
 *
 * ### Klaim pekerjaan juga harus atomik
 *
 * Membaca job `antre` lalu menuliskannya `berjalan` dalam dua langkah membuka
 * celah yang sama satu tingkat lebih dalam: dua processor bisa membaca baris
 * yang sama sebelum salah satunya menulis. Karena itu klaimnya satu pernyataan
 * `UPDATE … WHERE status='antre' … RETURNING`, dan yang kalah balapan tidak
 * mendapat baris sama sekali.
 */

/** Maksimal percobaan sebelum pekerjaan dianggap gagal permanen. */
export const BATAS_PERCOBAAN = 4;

/** Backoff bertingkat (detik) — percobaan ke-1 gagal → tunggu 30 detik, dst. */
const BACKOFF_DETIK = [30, 120, 600];

function jedaBerikutnya(attempts: number): Date {
  const detik = BACKOFF_DETIK[Math.min(attempts - 1, BACKOFF_DETIK.length - 1)] ?? 600;
  return new Date(Date.now() + detik * 1000);
}

export type HasilAntre =
  | { antre: true; baru: boolean; jobId: string }
  | { antre: false; alasan: string };

/**
 * Taruh satu event webhook ke antrean — idempoten terhadap `waMessageId`.
 *
 * Event yang tidak bisa diparse TIDAK diantrekan: tanpa id pesan tidak ada
 * kunci idempotensi, dan pekerjaan tanpa kunci idempotensi adalah pekerjaan
 * yang akan dijalankan berulang setiap kali WAHA mengirim ulang.
 */
export async function antreJawaban(body: unknown): Promise<HasilAntre> {
  const m = parseWaEvent(body);
  if (!m) return { antre: false, alasan: "payload tidak dikenali" };
  if (m.fromMe) return { antre: false, alasan: "pesan dari MARLIN sendiri" };

  /*
   * Jalan cepat: WAHA mengirim `message` DAN `message.any` untuk pesan yang
   * sama, jadi event kedua BUKAN kejadian langka — ia datang untuk setiap
   * pesan. Membiarkannya selalu menabrak indeks unik membuat PostgreSQL
   * mencatat `ERROR: duplicate key value violates unique constraint` di log
   * produksi untuk tiap pesan masuk yang sehat; log yang penuh galat palsu
   * membuat galat sungguhan tidak terlihat.
   *
   * Pemeriksaan ini TIDAK menggantikan pagar unik — ia tetap punya celah
   * balapan, dan celah itu tetap ditutup basis data di `catch` di bawah.
   */
  const sudahAda = await db.waReplyJob.findUnique({
    where: { waMessageId: m.waMessageId },
    select: { id: true },
  });
  if (sudahAda) return { antre: true, baru: false, jobId: sudahAda.id };

  try {
    const job = await db.waReplyJob.create({
      data: {
        waMessageId: m.waMessageId,
        chatId: m.chatId,
        payload: body as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { antre: true, baru: true, jobId: job.id };
  } catch (err) {
    // P2002 = pesan ini sudah pernah diantrekan. Itu BUKAN kegagalan; itu
    // justru pagar idempotensinya bekerja.
    if (err && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
      const ada = await db.waReplyJob.findUnique({
        where: { waMessageId: m.waMessageId },
        select: { id: true },
      });
      return ada
        ? { antre: true, baru: false, jobId: ada.id }
        : { antre: false, alasan: "balapan antre – baris hilang saat dibaca ulang" };
    }
    throw err;
  }
}

/**
 * Klaim SATU pekerjaan yang siap dikerjakan — atomik.
 *
 * `null` = tidak ada yang siap. Pekerjaan `berjalan` milik processor lain tidak
 * pernah ikut terklaim karena syarat `status='antre'` ada di dalam `UPDATE`
 * yang sama.
 */
async function klaimSatu(): Promise<{
  id: string;
  payload: unknown;
  attempts: number;
  waMessageId: string;
} | null> {
  const rows = await db.$queryRaw<
    { id: string; payload: unknown; attempts: number; wa_message_id: string }[]
  >`
    UPDATE wa_reply_jobs
       SET status = 'berjalan',
           attempts = attempts + 1,
           started_at = now()
     WHERE id = (
       SELECT id FROM wa_reply_jobs
        WHERE status = 'antre' AND next_attempt_at <= now()
        ORDER BY created_at
        -- SKIP LOCKED: dua processor yang berjalan bersamaan mengambil baris
        -- yang BERBEDA, bukan saling menunggu.
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, payload, attempts, wa_message_id
  `;
  const r = rows[0];
  return r
    ? { id: r.id, payload: r.payload, attempts: r.attempts, waMessageId: r.wa_message_id }
    : null;
}

export type HasilProses = {
  diproses: number;
  selesai: number;
  gagal: number;
  diulang: number;
};

/**
 * Jalankan pekerjaan yang siap, paling banyak `batas` buah.
 *
 * Dipanggil dua jalur, dan itu disengaja:
 *  - webhook, tanpa ditunggu, supaya balasan tetap cepat di jalur normal;
 *  - cron, sebagai jaring pengaman untuk apa pun yang terlewat (proses mati di
 *    tengah jalan, backoff yang jatuh tempo belakangan).
 */
export async function prosesAntrean(batas = 10): Promise<HasilProses> {
  const hasil: HasilProses = { diproses: 0, selesai: 0, gagal: 0, diulang: 0 };

  for (let i = 0; i < batas; i++) {
    const job = await klaimSatu();
    if (!job) break;
    hasil.diproses++;

    try {
      const jawab = await jawabPertanyaanWa(job.payload);
      await db.waReplyJob.update({
        where: { id: job.id },
        data: {
          status: "selesai",
          finishedAt: new Date(),
          // Alasan "diam" ikut disimpan: jalur yang sengaja tidak menjawab
          // adalah jalur yang paling sering perlu didiagnosis.
          hasil: `${jawab.dijawab ? "dijawab" : "diam"} – ${jawab.alasan}`.slice(0, 500),
          lastError: null,
        },
      });
      hasil.selesai++;
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      const habis = job.attempts >= BATAS_PERCOBAAN;
      await db.waReplyJob.update({
        where: { id: job.id },
        data: {
          /*
           * Pekerjaan yang habis percobaannya berhenti di `gagal`, TIDAK
           * dicoba selamanya. Antrean yang mengulang pekerjaan beracun
           * selamanya akan menghabiskan kuota AI dan menutupi pekerjaan sehat
           * di belakangnya — dan tidak ada yang melihatnya, karena tidak ada
           * yang pernah selesai untuk dilaporkan.
           */
          status: habis ? "gagal" : "antre",
          nextAttemptAt: habis ? new Date() : jedaBerikutnya(job.attempts),
          finishedAt: habis ? new Date() : null,
          lastError: pesan.slice(0, 500),
        },
      });
      if (habis) hasil.gagal++;
      else hasil.diulang++;
      console.error(
        `[waha/antrean] job ${job.id} (${job.waMessageId}) percobaan ${job.attempts} gagal: ${pesan}`,
      );
    }
  }

  return hasil;
}

/** Ringkasan untuk panel diagnosa admin — pekerjaan gagal harus TERLIHAT. */
export async function ringkasAntreanWa(): Promise<{
  antre: number;
  berjalan: number;
  gagal: number;
  contohGagal: { chatId: string; lastError: string | null; attempts: number }[];
  /**
   * Pekerjaan TERAKHIR yang selesai, lengkap dengan alasannya (DECISIONS 443).
   *
   * "Diam" bukan kegagalan — jobnya selesai normal — jadi ia tidak pernah
   * muncul di `contohGagal`. Padahal justru inilah pertanyaan yang paling
   * sering diajukan: *"kenapa MARLIN tidak menjawab?"* Alasannya sudah
   * ditulis ke `hasil` sejak DECISIONS 372; yang kurang cuma jendelanya.
   */
  terakhir: { chatId: string; hasil: string | null; selesaiPada: string | null }[];
}> {
  const [antre, berjalan, gagal, contoh, rampung] = await Promise.all([
    db.waReplyJob.count({ where: { status: "antre" } }),
    db.waReplyJob.count({ where: { status: "berjalan" } }),
    db.waReplyJob.count({ where: { status: "gagal" } }),
    db.waReplyJob.findMany({
      where: { status: "gagal" },
      orderBy: { finishedAt: "desc" },
      take: 5,
      select: { chatId: true, lastError: true, attempts: true },
    }),
    db.waReplyJob.findMany({
      where: { status: "selesai" },
      orderBy: { finishedAt: "desc" },
      take: 8,
      select: { chatId: true, hasil: true, finishedAt: true },
    }),
  ]);
  return {
    antre,
    berjalan,
    gagal,
    contohGagal: contoh,
    terakhir: rampung.map((r) => ({
      chatId: r.chatId,
      hasil: r.hasil,
      selesaiPada: r.finishedAt?.toISOString() ?? null,
    })),
  };
}
