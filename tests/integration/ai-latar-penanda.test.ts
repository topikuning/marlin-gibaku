// PEKERJAAN LATAR LAMA TIDAK BOLEH MERUSAK PERTANYAAN BARU (review 2026-08-28).
//
// DECISIONS 455 memindahkan penjawaban ke latar; DECISIONS 456 menjemput yang
// menggantung. Yang belum dijaga: apa yang terjadi bila pekerja LAMA ternyata
// masih hidup ketika pertanyaan BARU sudah dimulai.
//
// Sesudah lewat `batasJawabanMs()`, penanya memang BOLEH mengirim ulang
// pertanyaannya — proses yang mati tidak akan pernah menjawab. Tetapi "lewat
// batas" tidak sama dengan "sudah mati": pekerja lama bisa saja cuma lambat.
// Versi pertama membersihkan penanda HANYA berdasarkan id percakapan, sehingga
// pekerja lama yang selesai belakangan bisa:
//
//   1. menghapus penanda tunggu milik pertanyaan BARU — layar berhenti
//      menunggu padahal jawabannya belum ada;
//   2. menuliskan jawaban LAMA sesudah pertanyaan baru masuk, sehingga jawaban
//      itu terbaca sebagai jawaban atas pertanyaan yang salah.
//
// Keduanya SENYAP: tidak ada galat, hanya jawaban yang salah tempat.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * Pintu yang menahan pekerja di tengah jalan.
 *
 * Inti uji ini adalah SELA WAKTU antara "pekerja mulai" dan "pekerja menulis".
 * Tanpa cara menahan pekerja di sela itu, keadaan yang diuji tidak bisa
 * dibuat sama sekali — dan cacatnya memang hanya muncul di sela itu.
 */
let bukaPintu: () => void = () => {};
let pintu = new Promise<void>((r) => (bukaPintu = r));
let runIdDipakai = "";

vi.mock("@/lib/ai-hub/runs", () => ({
  executeAiRun: async () => {
    await pintu;
    return { runId: runIdDipakai, status: "gagal" as const };
  },
}));

const { db } = await import("@/lib/db");
const { mulaiJawabanLatar } = await import("@/lib/ai-hub/tanya-latar");
import type { SessionUser } from "@/lib/auth/session";

const suffix = `lp${Date.now().toString(36)}`;
let user: SessionUser;
let orgId = "";

async function buatPercakapan(penanda: Date): Promise<string> {
  const convo = await db.aiConversation.create({
    data: {
      userId: user.id,
      scopeIds: [],
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-28"),
      pendingSince: penanda,
    },
    select: { id: true },
  });
  await db.aiMessage.create({
    data: { conversationId: convo.id, role: "user", content: "pertanyaan" },
  });
  return convo.id;
}

/** Tunggu sampai `cek()` benar, atau menyerah — dipakai menunggu kerja latar. */
async function sampai(cek: () => Promise<boolean>, batasMs = 3000): Promise<void> {
  const habis = Date.now() + batasMs;
  for (;;) {
    if (await cek()) return;
    if (Date.now() > habis) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const isiPesan = (conversationId: string) =>
  db.aiMessage.count({ where: { conversationId, role: "asisten" } });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: {
      orgId,
      username: `pengguna-${suffix}`,
      fullName: "Penanya",
      passwordHash: "x",
      role: "project_manager",
    },
    select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true },
  });
  user = { ...u, mustChangePassword: false };
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ai_messages, ai_conversations, ai_runs, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  pintu = new Promise<void>((r) => (bukaPintu = r));
  await db.aiMessage.deleteMany({});
  await db.aiConversation.deleteMany({});
  await db.aiRun.deleteMany({});
  const run = await db.aiRun.create({
    data: {
      userId: user.id,
      orgId,
      runKind: "tanya",
      status: "gagal",
      scopeType: "all",
      scopeIds: [],
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-28"),
    },
    select: { id: true },
  });
  runIdDipakai = run.id;
});

describe("penanda pekerjaan mengikat tulisan pekerja latar", () => {
  it("pekerjaan yang penandanya MASIH berlaku tetap menulis seperti biasa", async () => {
    /*
     * Pagar yang terlalu galak sama merusaknya: kalau tulisan yang SAH ikut
     * ditolak, tiap jawaban hilang dan percakapan menggantung selamanya.
     */
    const penanda = new Date();
    const id = await buatPercakapan(penanda);

    mulaiJawabanLatar(user, {
      conversationId: id,
      penanda,
      question: "pertanyaan",
      locationIds: [],
      startKey: "2026-08-01",
      endKey: "2026-08-28",
      conversationHistory: [],
    });
    bukaPintu();
    await sampai(async () => (await isiPesan(id)) > 0);

    expect(await isiPesan(id)).toBe(1);
    const convo = await db.aiConversation.findUnique({
      where: { id },
      select: { pendingSince: true },
    });
    expect(convo?.pendingSince, "penanda dilepas setelah selesai").toBeNull();
  });

  it("REGRESI: pekerja LAMA tidak menulis, dan tidak menghapus penanda pertanyaan baru", async () => {
    /*
     * Urutannya persis keadaan produksinya:
     *   1. pekerja lama mulai dengan penanda P1;
     *   2. penanya menganggapnya putus dan mengirim ulang — penanda jadi P2;
     *   3. pekerja LAMA baru selesai sekarang.
     *
     * Yang benar: pekerja lama diam. Jawabannya sudah tidak menjawab
     * pertanyaan yang sedang ditunggu, dan penanda P2 milik pekerja baru.
     */
    const p1 = new Date(Date.now() - 600_000);
    const id = await buatPercakapan(p1);

    mulaiJawabanLatar(user, {
      conversationId: id,
      penanda: p1,
      question: "pertanyaan lama",
      locationIds: [],
      startKey: "2026-08-01",
      endKey: "2026-08-28",
      conversationHistory: [],
    });

    // Penanya mengirim ulang: penanda diganti, persis seperti `actions.ts`.
    const p2 = new Date();
    await db.aiConversation.update({ where: { id }, data: { pendingSince: p2 } });

    bukaPintu();
    // Beri waktu cukup bagi pekerja lama untuk MENCOBA menulis.
    await sampai(async () => (await isiPesan(id)) > 0, 1500);

    expect(await isiPesan(id), "jawaban lama TIDAK boleh masuk percakapan").toBe(0);
    const convo = await db.aiConversation.findUnique({
      where: { id },
      select: { pendingSince: true },
    });
    expect(
      convo?.pendingSince?.getTime(),
      "penanda pertanyaan BARU tidak boleh ikut terhapus",
    ).toBe(p2.getTime());
  });
});
