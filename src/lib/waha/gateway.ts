import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { WaOutboundKind, WaOutboundStatus } from "@/generated/prisma/enums";
import {
  WahaError,
  getSessionStatus,
  kirimMentahFile,
  kirimMentahGambar,
  kirimMentahTeks,
  type FilePayload,
} from "./client";
import { kanonikGrupId, tujuanGrup } from "./grup-id";
import { izinKirimPersonal } from "./config";
import { statusBerikutnya, statusDariAck } from "./status-kirim";

/**
 * GATEWAY PENGIRIMAN WHATSAPP — satu-satunya pintu keluar (DECISIONS 374).
 *
 * ### Yang salah sebelumnya
 *
 * Tiga fungsi kirim, tiga perilaku:
 *
 * | | kembalian | periksa sesi | simpan message id |
 * |---|---|---|---|
 * | `sendText` | id atau `null` | tidak | ya (oleh pemanggil, kadang) |
 * | `sendImage` | `void` | tidak | tidak pernah |
 * | `sendFile` | `void` | tidak | tidak pernah |
 *
 * Akibatnya tiap pemanggil menafsirkan keberhasilan sendiri, dan sebagian UI
 * menulis **"Terkirim"** begitu tidak ada galat. Padahal WAHA menjawab 2xx juga
 * ketika sesinya belum login: pesannya tidak pernah keluar, dan tidak ada satu
 * pun tempat di layar yang bisa membedakannya dari pesan yang benar-benar
 * sampai.
 *
 * ### Yang dijamin gateway ini
 *
 * 1. konfigurasi WAHA ada;
 * 2. **sesi `WORKING`** — diperiksa SEBELUM endpoint kirim dipanggil;
 * 3. tujuan dinormalkan ke bentuk kanonik;
 * 4. percobaan tercatat di `wa_outbound` sebelum berangkat;
 * 5. idempotensi lewat `idempotencyKey`;
 * 6. **ID pesan disimpan untuk teks, gambar, DAN berkas**;
 * 7. kiriman yang sudah diterima WAHA tidak pernah dikirim ulang;
 * 8. status yang dikembalikan jujur dan seragam;
 * 9. galat tersimpan terstruktur: pesan, kode HTTP, jumlah percobaan.
 *
 * Yang TIDAK dijaminnya, dan itu disengaja: bahwa pesannya sampai. Bukti itu
 * hanya datang dari `message.ack`, dan sampai ack tiba statusnya tetap
 * `diterima_waha` — bukan "terkirim".
 */

export type KirimWaInput = {
  kind: WaOutboundKind;
  /** Nomor/grup tujuan; dinormalkan ke bentuk kanonik di sini. */
  destination: string;
  payload:
    | { teks: string }
    | { file: FilePayload; caption?: string };
  /**
   * Kunci idempotensi dari pemanggil.
   *
   * Kosong = TIDAK ada jaminan idempotensi (kunci acak dibuat di sini). Itu
   * perilaku pemanggil lama yang belum dimigrasikan, dan sengaja dibiarkan
   * apa adanya: mengarang kunci dari isi pesan akan diam-diam MENELAN kiriman
   * sah yang kebetulan sama — pengingat harian dua hari berturut-turut, misalnya.
   */
  idempotencyKey?: string;
  sourceType: string;
  sourceId?: string | null;
};

export type HasilKirimWa = {
  /** `true` hanya berarti WAHA menerimanya — BUKAN bahwa pesannya sampai. */
  diterimaWaha: boolean;
  status: WaOutboundStatus;
  outboundId: string;
  waMessageId: string | null;
  /** Kalimat galat untuk ditampilkan; null bila tidak gagal. */
  error: string | null;
};

/** Potongan isi untuk diagnosa — bukan isi penuh (outbox dibaca admin lain). */
function ringkasIsi(input: KirimWaInput): string {
  if ("teks" in input.payload) return input.payload.teks.slice(0, 120);
  return `${input.payload.file.filename} (${input.payload.file.mimetype})${
    input.payload.caption ? ` – ${input.payload.caption.slice(0, 80)}` : ""
  }`;
}

/**
 * Sesi WAHA harus `WORKING` sebelum endpoint kirim disentuh.
 *
 * Ini pemeriksaan yang dulu hanya ada di sebagian jalur — dan justru jalur yang
 * TIDAK memeriksanya (gambar & berkas) yang paling sering dipakai mengirim
 * laporan resmi. Kegagalan membaca status diperlakukan sebagai TIDAK siap:
 * lebih baik menahan kiriman dengan sebab yang jelas daripada melemparkannya ke
 * sesi yang mungkin mati dan melaporkannya "terkirim".
 */
async function sesiSiap(): Promise<{ siap: true } | { siap: false; alasan: string }> {
  try {
    const s = await getSessionStatus();
    if (s.status === "WORKING") return { siap: true };
    return {
      siap: false,
      alasan: `Sesi WhatsApp belum siap (status: ${s.status}). Buka Sistem → WhatsApp dan pindai QR bila perlu.`,
    };
  } catch (err) {
    return {
      siap: false,
      alasan: `Status sesi WhatsApp tidak bisa dibaca: ${err instanceof Error ? err.message : "gagal"}`,
    };
  }
}

export async function sendWaMessage(input: KirimWaInput): Promise<HasilKirimWa> {
  const chatId = kanonikGrupId(input.destination);
  const key = input.idempotencyKey ?? `auto:${randomUUID()}`;

  if (!chatId) {
    const baris = await catat(key, input, "-", "ditolak", {
      lastError: `Tujuan tidak terbaca: ${input.destination}`,
    });
    return hasil(baris.id, "ditolak", null, `Tujuan tidak terbaca: ${input.destination}`);
  }

  /*
   * PAGAR NOMOR PRIBADI (DECISIONS 433).
   *
   * Ditaruh di gateway, bukan di tiap fitur: inilah satu-satunya jalan keluar
   * semua kiriman WhatsApp, jadi menutupnya di sini berarti tidak ada fitur
   * yang bisa lolos — sekarang maupun yang ditambahkan nanti.
   *
   * Ditolaknya DICATAT di outbox, bukan dilempar diam-diam: admin harus bisa
   * melihat kiriman mana yang tertahan dan kenapa, lalu memutuskan membuka
   * pagarnya di Sistem atau memindahkan tujuannya ke grup.
   */
  if (!tujuanGrup(chatId) && !(await izinKirimPersonal())) {
    const alasan =
      "Kiriman ke nomor pribadi sedang dimatikan (Sistem → WhatsApp). " +
      "WhatsApp memblokir nomor yang banyak mengirim chat pribadi, dan blokir itu ikut mematikan kiriman ke grup.";
    const b = await catat(key, input, chatId, "ditolak", { lastError: alasan });
    return hasil(b.id, "ditolak", null, alasan);
  }

  /*
   * Baris outbox dibuat SEBELUM berangkat — bukan sesudah.
   *
   * Kalau proses mati tepat setelah WAHA menerima tapi sebelum kita mencatat,
   * pesannya sudah keluar sementara sistem tidak punya jejaknya sama sekali:
   * percobaan berikutnya akan mengirim ulang, dan penerimanya mendapat dua.
   */
  const baris = await catat(key, input, chatId, "antre", {});

  // Sudah pernah berangkat → JANGAN kirim ulang. Ini pagar utama idempotensi.
  if (baris.waMessageId) {
    return hasil(baris.id, baris.status, baris.waMessageId, null);
  }
  if (baris.status === "ditolak") {
    return hasil(baris.id, baris.status, null, baris.lastError);
  }

  const sesi = await sesiSiap();
  if (!sesi.siap) {
    const b = await db.waOutbound.update({
      where: { id: baris.id },
      data: { status: "gagal", lastError: sesi.alasan, attempts: { increment: 1 } },
      select: { id: true },
    });
    return hasil(b.id, "gagal", null, sesi.alasan);
  }

  try {
    const waMessageId =
      "teks" in input.payload
        ? await kirimMentahTeks(chatId, input.payload.teks)
        : input.kind === "gambar"
          ? await kirimMentahGambar(chatId, input.payload.file, input.payload.caption)
          : await kirimMentahFile(chatId, input.payload.file, input.payload.caption);

    await db.waOutbound.update({
      where: { id: baris.id },
      data: {
        status: "diterima_waha",
        waMessageId,
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        errorCode: null,
      },
    });
    return hasil(baris.id, "diterima_waha", waMessageId, null);
  } catch (err) {
    const pesan = err instanceof Error ? err.message : String(err);
    const kode = err instanceof WahaError ? err.status : undefined;
    /*
     * 4xx = DITOLAK, bukan gagal. WhatsApp menolak nomor tak terdaftar dan
     * tujuan tak sah dengan 4xx (mis. 463); mengulanginya tidak akan pernah
     * berhasil. Menandainya "gagal" berarti mengundang percobaan ulang yang
     * pasti sia-sia — dan menyembunyikan bahwa tujuannya yang salah.
     */
    const status: WaOutboundStatus = kode != null && kode >= 400 && kode < 500 ? "ditolak" : "gagal";
    await db.waOutbound.update({
      where: { id: baris.id },
      data: {
        status,
        lastError: pesan.slice(0, 500),
        errorCode: kode != null ? String(kode) : null,
        attempts: { increment: 1 },
      },
    });
    return hasil(baris.id, status, null, pesan);
  }
}

async function catat(
  key: string,
  input: KirimWaInput,
  chatId: string,
  status: WaOutboundStatus,
  extra: { lastError?: string },
) {
  return db.waOutbound.upsert({
    where: { idempotencyKey: key },
    // Baris yang sudah ada TIDAK ditimpa: ia mungkin sudah memuat message id
    // atau sebab kegagalan yang justru sedang dicari orang.
    update: {},
    create: {
      kind: input.kind,
      chatId,
      idempotencyKey: key,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      status,
      ringkas: ringkasIsi(input),
      ...extra,
    },
    select: { id: true, status: true, waMessageId: true, lastError: true },
  });
}

function hasil(
  outboundId: string,
  status: WaOutboundStatus,
  waMessageId: string | null,
  error: string | null,
): HasilKirimWa {
  return {
    diterimaWaha: status !== "gagal" && status !== "ditolak" && status !== "antre",
    status,
    outboundId,
    waMessageId,
    error,
  };
}

/* ------------------------------------------------------------------ */
/* Rekonsiliasi message.ack                                            */
/* ------------------------------------------------------------------ */

export type HasilAck =
  | { cocok: false; alasan: string }
  | { cocok: true; berubah: boolean; dari: WaOutboundStatus; ke: WaOutboundStatus };

/**
 * Terapkan satu event `message.ack` ke barisnya.
 *
 * Idempoten dan tahan urutan: ack duplikat maupun ack yang datang terlambat
 * tidak mengubah apa pun. Lihat `statusBerikutnya` untuk alasannya.
 */
export async function terapkanAck(waMessageId: string, ack: unknown): Promise<HasilAck> {
  const usul = statusDariAck(ack as number | string | null);
  if (!usul) return { cocok: false, alasan: `kode ack tidak dikenal: ${String(ack)}` };

  const baris = await db.waOutbound.findUnique({
    where: { waMessageId },
    select: { id: true, status: true },
  });
  /*
   * Tidak ketemu itu WAJAR, bukan galat: WAHA mengirim ack untuk SETIAP pesan
   * keluar dari nomor itu, termasuk yang diketik manusia dari HP-nya. Yang
   * bukan kiriman MARLIN memang tidak punya barisnya.
   */
  if (!baris) return { cocok: false, alasan: "bukan kiriman MARLIN" };

  const berikut = statusBerikutnya(baris.status, usul);
  if (!berikut) return { cocok: true, berubah: false, dari: baris.status, ke: baris.status };

  await db.waOutbound.update({
    where: { id: baris.id },
    data: { status: berikut, ackAt: new Date() },
  });
  return { cocok: true, berubah: true, dari: baris.status, ke: berikut };
}

/** Ringkasan untuk panel diagnosa pengiriman di Sistem. */
export async function ringkasPengiriman(): Promise<{
  per: { status: WaOutboundStatus; jumlah: number }[];
  gagalTerbaru: {
    chatId: string;
    sourceType: string;
    status: WaOutboundStatus;
    lastError: string | null;
    errorCode: string | null;
    createdAt: Date;
  }[];
}> {
  const [grup, gagal] = await Promise.all([
    db.waOutbound.groupBy({ by: ["status"], _count: { _all: true } }),
    db.waOutbound.findMany({
      where: { status: { in: ["gagal", "ditolak"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        chatId: true,
        sourceType: true,
        status: true,
        lastError: true,
        errorCode: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    per: grup.map((g) => ({ status: g.status, jumlah: g._count._all })),
    gagalTerbaru: gagal,
  };
}
