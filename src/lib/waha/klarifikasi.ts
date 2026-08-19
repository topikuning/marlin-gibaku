import "server-only";
import { db } from "@/lib/db";
import type { KandidatNiat } from "./parser-niat";
import type { ParsedWaMessage } from "./ingest-parse";
import { UMUR_KLARIFIKASI_MENIT, bacaPilihan, kunciPengirim } from "./klarifikasi-kunci";

// Di-ekspor ulang supaya pemanggil punya SATU pintu (`klarifikasi.ts`) dan
// pemisahan murni/tidak-murni di dalamnya tidak bocor jadi urusan mereka.
export { UMUR_KLARIFIKASI_MENIT, bacaPilihan, kunciPengirim };

/**
 * KLARIFIKASI TERTUNDA — menawarkan pilihan, lalu benar-benar bisa dijawab
 * (DECISIONS 376).
 *
 * Parser deterministik (DECISIONS 375) sudah bisa menghitung 2–3 tafsir untuk
 * pertanyaan yang kabur. Yang belum ada: tempat menyimpannya sampai penanya
 * menjawab. Tanpa itu, menawarkan `1`/`2`/`3` berarti menyodorkan pilihan yang
 * tidak bisa dipilih — lebih buruk daripada tidak menawarkan sama sekali.
 *
 * ### Kenapa DURABLE, bukan di memori
 *
 * Pesan WhatsApp diproses lewat antrean yang boleh berpindah proses, di-restart,
 * atau dijalankan kembali oleh cron (DECISIONS 372). Konteks di memori proses
 * akan hilang tepat pada saat ia dibutuhkan: tawaran dikirim oleh satu proses,
 * jawabannya tiba di proses lain, dan penanya melihat MARLIN melupakan
 * pertanyaan yang baru saja ia ajukan sendiri.
 *
 * ### Kenapa kuncinya chat + PENGIRIM
 *
 * Instruksi brief, dan alasannya bukan kenyamanan. Mengunci per chat saja
 * berarti di grup siapa pun bisa mengambil alih klarifikasi orang lain dengan
 * mengetik `1` — dan jawabannya akan tampil seolah menjawab pertanyaan si
 * penanya asli. Yang menentukan pertanyaan siapa yang dijawab adalah siapa yang
 * ditawari, bukan siapa yang mengetik lebih dulu.
 */

export type TawaranTersimpan = {
  id: string;
  kandidat: KandidatNiat[];
  pertanyaan: string;
};

/**
 * Simpan tawaran. `null` = tidak boleh menawarkan (pengirim tak terbedakan),
 * `"sudah"` = webhook yang sama diproses ulang, jangan menawarkan lagi.
 */
export async function simpanTawaran(
  m: Pick<ParsedWaMessage, "chatId" | "senderJid" | "senderLid" | "fromNumber" | "waMessageId">,
  pertanyaan: string,
  kandidat: KandidatNiat[],
  sekarang = new Date(),
): Promise<{ jenis: "disimpan"; id: string } | { jenis: "sudah" } | { jenis: "tak_bisa" }> {
  const senderKey = kunciPengirim(m);
  /*
   * Tidak tahu siapa yang bertanya di GRUP → jangan menawarkan pilihan.
   *
   * Menawarkannya berarti membuka `1` untuk siapa pun yang membaca, dan
   * jawabannya akan terlihat seperti jawaban untuk penanya aslinya. Lebih baik
   * pertanyaannya diteruskan ke jalur biasa.
   */
  if (!senderKey) return { jenis: "tak_bisa" };

  const ada = await db.waPendingClarification.findUnique({
    where: { chatId_senderKey: { chatId: m.chatId, senderKey } },
    select: { id: true, waMessageId: true },
  });
  // Webhook yang sama dikirim ulang: tawarannya sudah pernah dikirim.
  if (ada && ada.waMessageId === m.waMessageId) return { jenis: "sudah" };

  const expiresAt = new Date(sekarang.getTime() + UMUR_KLARIFIKASI_MENIT * 60_000);
  const data = {
    pertanyaan,
    kandidat: kandidat as unknown as object,
    waMessageId: m.waMessageId,
    expiresAt,
    // Pertanyaan baru mengganti yang lama SEUTUHNYA — termasuk jejak jawaban
    // tawaran sebelumnya, yang tidak berlaku lagi untuk kandidat baru.
    answeredAt: null,
    pilihan: null,
    offerMessageId: null,
  };
  const baris = await db.waPendingClarification.upsert({
    where: { chatId_senderKey: { chatId: m.chatId, senderKey } },
    create: { chatId: m.chatId, senderKey, ...data },
    update: data,
    select: { id: true },
  });
  return { jenis: "disimpan", id: baris.id };
}

/** Catat ID pesan tawaran supaya balasan reply-to bisa diikat ke tawaran ini. */
export async function catatIdTawaran(id: string, offerMessageId: string | null): Promise<void> {
  if (!offerMessageId) return;
  await db.waPendingClarification.update({ where: { id }, data: { offerMessageId } });
}

/** Sama persis, atau salah satunya berakhiran yang lain. Lihat `ambilPilihan`. */
function idPesanCocok(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export type HasilAmbilPilihan =
  | { jenis: "bukan_pilihan" }
  /** Ada tawaran, tapi tidak lagi layak dijawab — katakan, jangan diam. */
  | { jenis: "kedaluwarsa"; pertanyaan: string }
  | { jenis: "di_luar_daftar"; jumlah: number }
  | { jenis: "ambil"; kandidat: KandidatNiat; pertanyaan: string; indeks: number };

/**
 * Ambil pilihan yang dijawab penanya — TANPA memanggil AI lagi.
 *
 * Itulah inti butir 22 brief: kandidatnya sudah dihitung saat tawaran dibuat
 * dan disimpan utuh, jadi menjawab `2` tidak boleh membayar panggilan AI kedua
 * untuk membaca ulang pertanyaan yang sama.
 */
export async function ambilPilihan(
  m: Pick<
    ParsedWaMessage,
    "chatId" | "senderJid" | "senderLid" | "fromNumber" | "balasanKePesanId"
  >,
  teks: string,
  sekarang = new Date(),
): Promise<HasilAmbilPilihan> {
  const indeks = bacaPilihan(teks);
  if (indeks === null) return { jenis: "bukan_pilihan" };

  const senderKey = kunciPengirim(m);
  if (!senderKey) return { jenis: "bukan_pilihan" };

  const baris = await db.waPendingClarification.findUnique({
    where: { chatId_senderKey: { chatId: m.chatId, senderKey } },
    select: {
      id: true,
      kandidat: true,
      pertanyaan: true,
      expiresAt: true,
      answeredAt: true,
      offerMessageId: true,
    },
  });
  if (!baris) return { jenis: "bukan_pilihan" };

  /*
   * Balasan yang MENGUTIP pesan lain bukan jawaban untuk tawaran ini.
   *
   * Di grup ramai beberapa percakapan berjalan bersamaan, dan tawaran yang
   * lebih tua bisa masih terlihat di layar. Kalau penanya sengaja mengutip satu
   * pesan dan itu BUKAN tawaran yang sedang hidup, memperlakukan angkanya
   * sebagai pilihan berarti menjawab percakapan yang salah.
   *
   * Diperiksa hanya bila KEDUA id diketahui. Balasan tanpa id kutipan tetap
   * diterima — kebanyakan orang cuma mengetik "1" tanpa mengutip apa pun, dan
   * sebagian engine WAHA memang tidak mengirimkan id itu. Ketiadaan bukti
   * bukan bukti ketiadaan.
   *
   * Perbandingannya toleran ujung: WAHA menuliskan id pesan keluar dalam
   * bentuk lengkap (`true_120…@g.us_ABC`) sementara id yang dikutip sering
   * hanya bagian terakhirnya. Menuntut sama persis akan menolak balasan yang
   * benar-benar mengutip tawaran kita.
   */
  const kutipan = m.balasanKePesanId;
  if (kutipan && baris.offerMessageId && !idPesanCocok(kutipan, baris.offerMessageId)) {
    return { jenis: "bukan_pilihan" };
  }

  // Sudah pernah dijawab → jangan jalankan lagi. Ini pagar idempotensi kedua:
  // webhook yang mengulang pesan jawaban tidak boleh mengirim jawaban dua kali.
  if (baris.answeredAt) return { jenis: "bukan_pilihan" };

  if (baris.expiresAt.getTime() <= sekarang.getTime()) {
    return { jenis: "kedaluwarsa", pertanyaan: baris.pertanyaan };
  }

  const kandidat = baris.kandidat as unknown as KandidatNiat[];
  if (!Array.isArray(kandidat) || indeks >= kandidat.length) {
    return { jenis: "di_luar_daftar", jumlah: Array.isArray(kandidat) ? kandidat.length : 0 };
  }

  await db.waPendingClarification.update({
    where: { id: baris.id },
    data: { answeredAt: sekarang, pilihan: indeks },
  });
  return { jenis: "ambil", kandidat: kandidat[indeks], pertanyaan: baris.pertanyaan, indeks };
}

/**
 * Buang tawaran yang sudah lewat umurnya.
 *
 * Dipanggil dari cron yang sama dengan antrean. Tidak ada yang membaca baris
 * kedaluwarsa, tapi membiarkannya menumpuk membuat tabel ini tumbuh selamanya
 * untuk data yang umurnya 12 menit.
 */
export async function bersihkanKlarifikasiBasi(sekarang = new Date()): Promise<number> {
  const r = await db.waPendingClarification.deleteMany({
    where: { expiresAt: { lt: new Date(sekarang.getTime() - 60 * 60_000) } },
  });
  return r.count;
}
