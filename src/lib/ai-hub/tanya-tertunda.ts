import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { getAiGuardConfig } from "./guard";
import { batasJawabanMs } from "./guard-rules";
import { mulaiJawabanLatar } from "./tanya-latar";

/**
 * Menjemput pertanyaan Ask MARLIN yang MENGGANTUNG (DECISIONS 456).
 *
 * ### Kenapa perlu
 *
 * DECISIONS 455 memindahkan penjawaban ke latar, di proses yang sama, tanpa
 * antrean. Konsekuensinya diakui sejak awal: kalau Railway men-deploy ulang
 * saat pertanyaan sedang dijawab, pekerjaannya hilang bersama prosesnya.
 * Layar memang tidak berputar selamanya — `keadaanTunggu()` menyebutnya
 * TERPUTUS begitu lewat batas — tetapi penanya diminta mengetik ulang
 * pertanyaan yang sudah ia kirim, dan itu kegagalan yang terlihat.
 *
 * Catatan aslinya sudah menunjuk jalan keluarnya: `pendingSince` yang lewat
 * batas SUDAH cukup sebagai antrean. Berkas ini yang menjemputnya.
 *
 * ### Kenapa aman dijalankan berkali-kali
 *
 * Tiga pagar, dan ketiganya perlu:
 *
 * 1. **Hanya yang lewat `batasJawabanMs()`.** Itu anggaran TERBESAR yang bisa
 *    dipakai satu jawaban (4 panggilan provider + jeda). Lewat dari itu,
 *    prosesnya memang sudah mati — bukan sekadar lambat. Menjemput lebih awal
 *    berarti dua proses menjawab pertanyaan yang sama.
 * 2. **Hanya bila pesan TERAKHIR dari penanya.** Proses lama bisa saja mati
 *    setelah menulis jawaban tetapi sebelum mengosongkan penanda. Percakapan
 *    seperti itu sudah punya jawabannya; ia cukup dibersihkan penandanya, dan
 *    menjawab ulang justru membuat jawaban dobel.
 * 3. **Penandanya DIKLAIM sekaligus DIPERBARUI** dalam satu `updateMany`
 *    ber-syarat `pendingSince` yang sama. Dua cron yang tumpang tindih tidak
 *    bisa sama-sama memenangkan percakapan yang sama — dan tidak ada sela
 *    "tanpa penanda" yang membuat penanya bisa mengirim ulang pertanyaannya
 *    selagi pekerja baru sudah berjalan. Nilai penanda barunya sekaligus
 *    menjadi IDENTITAS pekerjaan itu: pekerja hanya boleh menulis selama
 *    nilainya belum berubah (lihat `TanyaLatarInput.penanda`).
 *
 * Kuota tetap berlaku: penjemputan memakai jalur yang sama, jadi pagarnya
 * diperiksa ulang. Yang lewat kuota menerima kalimat penolakan — bukan
 * jawaban gratis lewat pintu belakang.
 */

export type HasilJemput = {
  diperiksa: number;
  /** Dijalankan ulang – pertanyaannya benar-benar belum terjawab. */
  dijemput: number;
  /** Sudah ada jawabannya; penandanya saja yang tertinggal. */
  dibersihkan: number;
};

/** Paling banyak sekian percakapan per panggilan – cron bukan tempat antre panjang. */
const BATAS_PER_JALAN = 10;

export async function jemputTanyaTertunda(sekarang = new Date()): Promise<HasilJemput> {
  const cfg = await getAiGuardConfig();
  const ambang = new Date(sekarang.getTime() - batasJawabanMs(cfg));

  const tertunda = await db.aiConversation.findMany({
    where: { pendingSince: { not: null, lt: ambang } },
    orderBy: { pendingSince: "asc" },
    take: BATAS_PER_JALAN,
    select: {
      id: true,
      userId: true,
      scopeIds: true,
      periodStart: true,
      periodEnd: true,
      pendingSince: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { role: true, content: true },
      },
    },
  });

  const hasil: HasilJemput = { diperiksa: tertunda.length, dijemput: 0, dibersihkan: 0 };

  for (const convo of tertunda) {
    /*
     * Klaim SEKALIGUS memasang penanda BARU — satu `updateMany`, bukan dua
     * langkah (perbaikan review 2026-08-28).
     *
     * Versi pertama mengosongkan penanda, memulai pekerja, lalu memasang
     * penanda baru SESUDAHNYA. Di sela itu percakapan terlihat "tidak sedang
     * dijawab", sehingga penanya bisa mengirim ulang pertanyaannya dan dua
     * pekerja berjalan atas percakapan yang sama.
     *
     * Nilai barunya juga menjadi IDENTITAS pekerjaan ini: pekerja hanya boleh
     * menulis selama `pendingSince` masih sama persis (lihat `tanya-latar.ts`).
     */
    const penanda = new Date();
    const klaim = await db.aiConversation.updateMany({
      where: { id: convo.id, pendingSince: convo.pendingSince },
      data: { pendingSince: penanda },
    });
    if (klaim.count === 0) continue;

    /** Lepas penanda yang baru saja kita pasang — hanya bila masih milik kita. */
    const lepas = () =>
      db.aiConversation.updateMany({
        where: { id: convo.id, pendingSince: penanda },
        data: { pendingSince: null },
      });

    const terakhir = convo.messages[0];
    if (!terakhir || terakhir.role !== "user") {
      // Jawabannya sudah ada — penandanya saja yang tertinggal.
      await lepas();
      hasil.dibersihkan++;
      continue;
    }

    const user = await db.user.findUnique({
      where: { id: convo.userId },
      select: {
        id: true,
        orgId: true,
        fullName: true,
        username: true,
        email: true,
        role: true,
        mustChangePassword: true,
        // `isActive` IKUT DIPERIKSA (review 2026-08-28). Versi pertama hanya
        // memeriksa keberadaan barisnya, padahal menonaktifkan akun adalah cara
        // yang lazim — akun jarang benar-benar dihapus. Akibatnya pertanyaan
        // milik akun yang sudah dimatikan tetap dijalankan ulang di latar:
        // memakai kuota provider, dan menuliskan jawaban ke percakapan yang
        // pemiliknya sudah tidak boleh masuk.
        isActive: true,
      },
    });
    // Pengguna dihapus/dinonaktifkan sesudah bertanya: penandanya dilepas, dan
    // itu memang seluruh yang boleh dilakukan.
    if (!user || !user.isActive) {
      await lepas();
      continue;
    }

    const sisa = convo.messages.slice(1);
    mulaiJawabanLatar(user as SessionUser, {
      conversationId: convo.id,
      penanda,
      question: terakhir.content,
      locationIds: (convo.scopeIds as string[]) ?? [],
      startKey: convo.periodStart.toISOString().slice(0, 10),
      endKey: convo.periodEnd.toISOString().slice(0, 10),
      conversationHistory: sisa
        .slice()
        .reverse()
        .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    });
    hasil.dijemput++;
  }

  return hasil;
}
