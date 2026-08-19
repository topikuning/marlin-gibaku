/**
 * KLARIFIKASI TERTUNDA — bagian MURNI (DECISIONS 376).
 *
 * Dipisah dari `klarifikasi.ts` karena berkas itu menarik `db`, dan menarik
 * `db` berarti menarik validasi environment. Dua keputusan paling menentukan di
 * fitur ini — siapa yang boleh menjawab tawaran, dan apa yang dihitung sebagai
 * jawaban — jadi hanya bisa diuji dengan basis data hidup. Keduanya tidak
 * menyentuh basis data sama sekali, jadi tidak ada alasan untuk itu.
 */

import type { KandidatNiat } from "./parser-niat";

export type { KandidatNiat };

/**
 * Berapa lama tawaran layak dijawab.
 *
 * Brief meminta 10–15 menit. Diambil 12: `2` yang diketik sejam kemudian hampir
 * pasti menjawab percakapan lain, dan menjalankannya berarti menjawab
 * pertanyaan yang sudah lama ditinggalkan penanyanya.
 */
export const UMUR_KLARIFIKASI_MENIT = 12;

/**
 * Identitas pengirim yang dipakai sebagai kunci.
 *
 * Urutannya dari yang paling khusus. Nama tampilan TIDAK PERNAH dipakai — siapa
 * pun bisa mengubahnya, dan memakainya berarti membiarkan orang lain
 * memakai kunci milik penanya hanya dengan mengganti namanya sendiri.
 *
 * `null` berarti pengirimnya tidak bisa dibedakan dari peserta lain. Di situ
 * klarifikasi TIDAK ditawarkan sama sekali — lihat `simpanTawaran`.
 */
export function kunciPengirim(m: {
  senderJid: string | null;
  senderLid: string | null;
  fromNumber: string | null;
  chatId: string;
}): string | null {
  if (m.senderJid) return m.senderJid;
  if (m.senderLid) return `${m.senderLid}@lid`;
  if (m.fromNumber) return m.fromNumber;
  /*
   * Chat PRIBADI tanpa identitas pengirim masih aman: chat-nya sendiri hanya
   * berisi satu lawan bicara, jadi "chat" dan "pengirim" memang sama orang.
   * Di GRUP tidak — dan di sanalah `null` dikembalikan.
   */
  return m.chatId.endsWith("@g.us") ? null : m.chatId;
}

/**
 * Baca balasan yang berupa PILIHAN, bukan pertanyaan baru. Murni.
 *
 * Sengaja sempit. Yang diterima hanya angka telanjang (`2`), angka berimbuhan
 * pendek (`pilih 2`, `no 2`, `opsi 2.`), dan tidak lebih. Menerima kalimat
 * panjang yang kebetulan memuat angka berarti membajak pertanyaan sungguhan —
 * *"laporan tanggal 2"* bukan jawaban pilihan, dan memperlakukannya begitu
 * menjawab hal yang sama sekali berbeda.
 *
 * `null` = bukan jawaban pilihan; perlakukan sebagai pertanyaan biasa.
 */
export function bacaPilihan(teks: string): number | null {
  const t = teks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = t.match(/^(?:pilih|pilihan|opsi|nomor|nomer|no|yang)?\s*([1-9])$/);
  if (!m) return null;
  return Number(m[1]) - 1;
}

