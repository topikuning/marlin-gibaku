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
 * 3. **Penandanya DIKLAIM lebih dulu** (`updateMany` ber-syarat `pendingSince`
 *    yang sama). Dua cron yang kebetulan tumpang tindih tidak bisa sama-sama
 *    memenangkan percakapan yang sama.
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
    // Klaim: hanya yang penandanya masih sama persis. Yang kalah balapan
    // mendapat count 0 dan dilewati tanpa efek samping.
    const klaim = await db.aiConversation.updateMany({
      where: { id: convo.id, pendingSince: convo.pendingSince },
      data: { pendingSince: null },
    });
    if (klaim.count === 0) continue;

    const terakhir = convo.messages[0];
    if (!terakhir || terakhir.role !== "user") {
      // Jawabannya sudah ada — penandanya saja yang tertinggal.
      hasil.dibersihkan++;
      continue;
    }

    const user = await db.user.findUnique({
      where: { id: convo.userId },
      select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true, mustChangePassword: true },
    });
    // Pengguna dihapus/dinonaktifkan sesudah bertanya: penandanya sudah
    // dibersihkan di atas, dan itu memang seluruh yang boleh dilakukan.
    if (!user) continue;

    const sisa = convo.messages.slice(1);
    mulaiJawabanLatar(user as SessionUser, {
      conversationId: convo.id,
      question: terakhir.content,
      locationIds: (convo.scopeIds as string[]) ?? [],
      startKey: convo.periodStart.toISOString().slice(0, 10),
      endKey: convo.periodEnd.toISOString().slice(0, 10),
      conversationHistory: sisa
        .slice()
        .reverse()
        .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    });
    // Penanda dipasang lagi supaya layar tahu jawabannya sedang disusun ulang.
    await db.aiConversation.update({ where: { id: convo.id }, data: { pendingSince: new Date() } });
    hasil.dijemput++;
  }

  return hasil;
}
