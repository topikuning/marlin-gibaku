import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { jalankanDiLatar } from "@/lib/auth/latar";
import { pesanGagalUntukPenanya } from "./pesan-gagal";
import { executeAiRun } from "./runs";
import type { AskOutput } from "./schemas";
import type { SourceRef } from "./types";

/**
 * Menjawab pertanyaan Ask MARLIN DI LATAR (DECISIONS 455).
 *
 * Sebelumnya seluruh panggilan provider ditahan di dalam request server action.
 * Anggarannya sah sampai ±6 menit (4 panggilan × timeout + jeda), sementara
 * peramban menyerah jauh lebih awal: log edge 2026-08-27 mencatat 499 pada
 * detik ke-125 dengan `txBytes: 0`. Jawabannya tetap terhitung dan terbayar,
 * tetapi penanyanya tidak pernah melihatnya.
 *
 * Sekarang request hanya menulis pertanyaan lalu selesai; pekerjaan beratnya
 * jalan terus di proses yang sama dan hasilnya masuk ke percakapan. Layar
 * membaca `AiConversation.pendingSince` untuk tahu ia harus menunggu.
 *
 * MODUL INI TIDAK BOLEH MELEMPAR KE PEMANGGIL: ia sengaja dipanggil tanpa
 * `await`. Setiap jalur keluar wajib menulis sesuatu ke percakapan dan
 * mengosongkan penanda tunggu — percakapan yang menggantung tanpa kabar adalah
 * kegagalan yang lebih buruk daripada pesan galat.
 */

export type TanyaLatarInput = {
  conversationId: string;
  /**
   * PENANDA PEKERJAAN — nilai `pendingSince` yang dipasang pemanggil TEPAT
   * sebelum pekerjaan ini dimulai (temuan review 2026-08-28).
   *
   * ### Kenapa perlu, dan apa yang rusak tanpanya
   *
   * Sesudah lewat `batasJawabanMs()`, penanya BOLEH mengirim ulang
   * pertanyaannya (`ai-hub/actions.ts`) — memang begitu rancangannya, karena
   * proses yang mati tidak akan pernah menjawab. Tetapi "lewat batas" tidak
   * berarti "sudah mati": pekerja lama bisa saja masih berjalan, cuma lambat.
   *
   * Versi pertama membersihkan penanda HANYA berdasarkan id percakapan. Pekerja
   * lama yang selesai belakangan karenanya bisa:
   *   1. menghapus penanda tunggu milik pertanyaan BARU — layar berhenti
   *      menunggu padahal jawabannya belum ada;
   *   2. menuliskan jawaban LAMA sesudah pertanyaan baru masuk, sehingga
   *      jawaban itu terbaca sebagai jawaban atas pertanyaan yang salah;
   *   3. membuka pintu bagi pertanyaan KETIGA selagi pekerja kedua masih jalan.
   *
   * Penanda ini yang mengikat keduanya: setiap tulisan dijaga
   * `updateMany` bersyarat `pendingSince` yang sama persis. Pekerja yang
   * penandanya sudah tidak berlaku menulis NOL baris dan diam — tanpa perlu
   * kolom baru, memakai pola klaim yang sama dengan `jemputTanyaTertunda`.
   */
  penanda: Date;
  question: string;
  locationIds: string[];
  startKey: string;
  endKey: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
};

/**
 * Sitasi disimpan LENGKAP dengan label & tautannya (DECISIONS 378) — diperkaya
 * SAAT MENULIS, bukan saat render: pesan percakapan hidup lebih lama daripada
 * run-nya, dan sumber yang diresolusi belakangan akan berubah/hilang begitu
 * datanya bergerak. Yang tersimpan adalah apa yang benar SAAT jawaban diberikan.
 */
function rakitSitasi(
  answer: AskOutput | undefined,
  sourceRefs: SourceRef[],
): { sourceRefId: string; note: string | null; label: string | null; value: string | null; href: string | null }[] {
  const refs = new Map(sourceRefs.map((r) => [r.id, r]));
  const citationNotes = new Map((answer?.citations ?? []).map((citation) => [citation.sourceRefId, citation.note]));
  const citedIds = new Set((answer?.citations ?? []).map((citation) => citation.sourceRefId));
  for (const part of answer?.answerParts ?? []) {
    for (const sourceRefId of part.sourceRefIds ?? []) citedIds.add(sourceRefId);
    for (const claim of part.claims) citedIds.add(claim.sourceRefId);
    for (const quote of part.kutipan ?? []) citedIds.add(quote.chunkId);
  }
  return [...citedIds].map((sourceRefId) => {
    const r = refs.get(sourceRefId);
    return {
      sourceRefId,
      note: citationNotes.get(sourceRefId) ?? null,
      label: r?.label ?? null,
      value: r?.value ?? null,
      href: r?.href ?? null,
    };
  });
}

/**
 * Tulis satu pesan asisten HANYA bila pekerjaan ini masih pemilik percakapan.
 *
 * Klaim & tulisan dijadikan SATU transaksi: kalau prosesnya mati di tengah,
 * keduanya batal, penandanya utuh, dan `jemputTanyaTertunda` masih bisa
 * menjemputnya. Membersihkan penanda lebih dulu di luar transaksi akan
 * meninggalkan percakapan tanpa penanda DAN tanpa jawaban — menggantung
 * selamanya, tanpa satu pun jalur yang menjemputnya.
 *
 * @returns true bila tulisannya jadi; false bila pekerjaan ini sudah basi.
 */
type IsiPesanAsisten = {
  role: "asisten";
  content: string;
  citations?: object;
  confidence?: number | null;
  runId?: string;
};

async function tulisBilaMasihMilik(
  input: TanyaLatarInput,
  data: IsiPesanAsisten,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const klaim = await tx.aiConversation.updateMany({
      where: { id: input.conversationId, pendingSince: input.penanda },
      data: { pendingSince: null },
    });
    if (klaim.count === 0) return false;
    await tx.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        role: data.role,
        content: data.content,
        citations: data.citations ? JSON.parse(JSON.stringify(data.citations)) : undefined,
        confidence: data.confidence ?? null,
        runId: data.runId,
      },
    });
    return true;
  });
}

async function tulisJawaban(user: SessionUser, input: TanyaLatarInput): Promise<void> {
  const result = await executeAiRun(user, {
    kind: "tanya",
    locationIds: input.locationIds,
    startKey: input.startKey,
    endKey: input.endKey,
    question: input.question,
    conversationHistory: input.conversationHistory,
  });
  const run = await db.aiRun.findUnique({
    where: { id: result.runId },
    select: { outputJson: true, errorMessage: true },
  });
  const out = run?.outputJson as { tanya?: AskOutput; official?: { sourceRefs?: SourceRef[] } } | null;
  const answer = out?.tanya;
  if (result.status !== "siap" || !answer) {
    // Rinciannya tetap ada di `AiRun.errorMessage`; yang masuk percakapan
    // hanya kalimat yang berguna bagi penanya.
    console.error(`[ai/tanya-latar] run ${result.runId} gagal: ${run?.errorMessage ?? "(tanpa pesan)"}`);
  }
  const jadi = await tulisBilaMasihMilik(input, {
    role: "asisten",
    content:
      result.status === "siap" && answer ? answer.answer : pesanGagalUntukPenanya(null),
    citations: answer ? rakitSitasi(answer, out?.official?.sourceRefs ?? []) : undefined,
    confidence: answer?.confidence ?? null,
    runId: result.runId,
  });
  if (!jadi) {
    // Penanya sudah mengirim ulang pertanyaannya dan pekerja lain yang
    // memegang percakapan ini. Jawaban ini SENGAJA dibuang: menuliskannya
    // akan menempelkan jawaban lama pada pertanyaan baru. Run-nya tetap
    // tersimpan di `AiRun`, jadi ongkosnya tetap terlihat.
    console.warn(
      `[ai/tanya-latar] jawaban run ${result.runId} dibuang – percakapan ${input.conversationId} sudah dipegang pekerjaan lain`,
    );
  }
}

/**
 * Jalankan di latar. Sengaja TIDAK mengembalikan Promise yang perlu ditunggu:
 * pemanggil (server action) harus bisa membalas seketika.
 */
export function mulaiJawabanLatar(user: SessionUser, input: TanyaLatarInput): void {
  // Ditandai LATAR (DECISIONS 456): `requestIp()` tidak boleh menyentuh
  // `headers()` di sini, dan tidak perlu lagi menelan galat untuk semua orang.
  void jalankanDiLatar(async () => {
    try {
      await tulisJawaban(user, input);
    } catch (err) {
      // Termasuk penolakan guard dan kegagalan tak terduga. Percakapan HARUS
      // tetap mendapat kabar; kalau tidak, penanya menunggu sesuatu yang tidak
      // akan pernah datang.
      console.error("[ai/tanya-latar] pekerjaan latar gagal:", err);
      await tulisBilaMasihMilik(input, {
        role: "asisten",
        content: pesanGagalUntukPenanya(err),
      }).catch(() => {
        /* DB pun tidak bisa ditulis — penanda di bawah yang menyelamatkan layar. */
      });
    } finally {
      /*
       * Jaring pengaman, dan SELALU bersyarat penanda: kalau kedua cabang di
       * atas gagal menulis, penantian layar tetap harus berakhir — tetapi
       * penanda milik pertanyaan BARU tidak boleh ikut terhapus.
       */
      await db.aiConversation
        .updateMany({
          where: { id: input.conversationId, pendingSince: input.penanda },
          data: { pendingSince: null },
        })
        .catch(() => {
          /* Bila ini gagal, batasJawabanMs() di layar yang menutup penantiannya. */
        });
    }
  });
}
