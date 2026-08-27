import "server-only";
import { sendWaMessage } from "./gateway";
import type { FilePayload } from "./client";

/**
 * PEMBUNGKUS LAMA `sendText` / `sendImage` / `sendFile` — kini menumpang
 * gateway kanonik (DECISIONS 374).
 *
 * Ada 28 tempat pemanggilan di 6 berkas. Memigrasikan semuanya sekaligus ke
 * tanda tangan baru berarti satu perubahan besar yang menyentuh setiap fitur
 * WhatsApp sekaligus — persis yang dilarang brief ("jangan mengubah satu
 * masalah menjadi refactor besar tanpa bukti").
 *
 * Yang dilakukan di sini lebih murah dan langsung menutup cacatnya: nama
 * lamanya dipertahankan, isinya diarahkan ke gateway. Sejak baris ini, SETIAP
 * kiriman WhatsApp — dari fitur mana pun — melewati pemeriksaan sesi `WORKING`,
 * tercatat di outbox, dan ID pesannya tersimpan, termasuk untuk gambar dan
 * berkas yang dulu tidak pernah punya bukti apa pun.
 *
 * Yang TIDAK ikut otomatis: idempotensi. Tanpa kunci dari pemanggil, gateway
 * membuat kunci acak — perilakunya persis seperti dulu. Mengarang kunci dari
 * isi pesan akan diam-diam MENELAN kiriman sah yang kebetulan sama (pengingat
 * harian dua hari berturut-turut, misalnya). Pemanggil yang butuh idempotensi
 * memanggil `sendWaMessage()` langsung dengan kuncinya sendiri.
 */

/** Kirim teks. Mengembalikan ID pesan WAHA bila ada; `null` bila tidak. */
export async function sendText(chatId: string, text: string): Promise<string | null> {
  const r = await sendWaMessage({
    kind: "teks",
    destination: chatId,
    payload: { teks: text },
    sourceType: "legacy_sendText",
  });
  /*
   * Melempar saat gagal — SENGAJA, karena itulah perilaku lama yang
   * diandalkan pemanggil: banyak di antaranya membungkus panggilan ini dalam
   * try/catch dan menampilkan pesannya. Menggantinya dengan `null` diam-diam
   * akan mengubah kegagalan yang terlihat menjadi kegagalan yang senyap.
   */
  if (r.error) throw new Error(r.error);
  return r.waMessageId;
}

/**
 * BALASAN atas pesan yang masuk dari WhatsApp (DECISIONS 439).
 *
 * Sengaja fungsi tersendiri, bukan parameter tambahan di `sendText`: penjawab
 * pesan masuk memanggil ini, semua jalur lain tidak bisa lewat pagar nomor
 * pribadi tanpa sadar mengubah fungsinya. Pagar itu satu arah — yang dilarang
 * WhatsApp adalah menyapa duluan, bukan menjawab yang menyapa kita.
 */
export async function balasWa(chatId: string, text: string): Promise<string | null> {
  const r = await sendWaMessage({
    kind: "teks",
    destination: chatId,
    payload: { teks: text },
    sourceType: "balasan_wa",
    balasanMasuk: true,
  });
  if (r.error) throw new Error(r.error);
  return r.waMessageId;
}

/**
 * BALASAN berupa BERKAS atas pesan yang masuk (DECISIONS 448).
 *
 * Sama alasannya dengan `balasWa`: hanya penjawab pesan masuk yang boleh
 * menyalakan `balasanMasuk`, jadi ia berdiri sebagai fungsinya sendiri dan
 * bukan parameter tambahan di `sendFile` yang dipakai jalur lain.
 */
export async function balasFileWa(
  chatId: string,
  file: FilePayload,
  caption?: string,
): Promise<string | null> {
  const r = await sendWaMessage({
    kind: "berkas",
    destination: chatId,
    payload: { file, caption },
    sourceType: "balasan_wa_berkas",
    balasanMasuk: true,
  });
  if (r.error) throw new Error(r.error);
  return r.waMessageId;
}

export async function sendImage(
  chatId: string,
  file: FilePayload,
  caption?: string,
): Promise<string | null> {
  const r = await sendWaMessage({
    kind: "gambar",
    destination: chatId,
    payload: { file, caption },
    sourceType: "legacy_sendImage",
  });
  if (r.error) throw new Error(r.error);
  return r.waMessageId;
}

export async function sendFile(
  chatId: string,
  file: FilePayload,
  caption?: string,
): Promise<string | null> {
  const r = await sendWaMessage({
    kind: "berkas",
    destination: chatId,
    payload: { file, caption },
    sourceType: "legacy_sendFile",
  });
  if (r.error) throw new Error(r.error);
  return r.waMessageId;
}
