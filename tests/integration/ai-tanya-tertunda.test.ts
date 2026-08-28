// PERTANYAAN ASK MARLIN YANG MENGGANTUNG DIJEMPUT, BUKAN DIBIARKAN (DECISIONS 456).
//
// DECISIONS 455 memindahkan penjawaban ke latar, di proses yang sama, tanpa
// antrean. Konsekuensinya diakui sejak awal: deploy ulang di tengah jalan
// menghapus pekerjaannya, dan penanya diminta mengetik ulang pertanyaan yang
// sudah ia kirim.
//
// Yang diuji di sini bukan penjemputannya saja, melainkan PAGARNYA — karena
// pagar itulah yang membedakan "tahan restart" dari "menjawab dobel":
//   1. yang belum lewat batas TIDAK disentuh (prosesnya mungkin masih hidup);
//   2. yang pesan terakhirnya sudah dari asisten cukup dibersihkan penandanya;
//   3. putaran cron berikutnya tidak boleh menjemput ulang yang baru saja
//      dijalankan.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Siapa saja yang benar-benar dijalankan ulang — inti pembuktian berkas ini. */
const dijalankan: string[] = [];
vi.mock("@/lib/ai-hub/tanya-latar", () => ({
  mulaiJawabanLatar: (_user: unknown, input: { conversationId: string }) => {
    dijalankan.push(input.conversationId);
  },
}));

const { db } = await import("@/lib/db");
const { jemputTanyaTertunda } = await import("@/lib/ai-hub/tanya-tertunda");
const { getAiGuardConfig } = await import("@/lib/ai-hub/guard");
const { batasJawabanMs } = await import("@/lib/ai-hub/guard-rules");

const suffix = `tt${Date.now().toString(36)}`;
let userId = "";
let batasMs = 0;

async function buatPercakapan(opts: {
  umurMs: number;
  pesan: { role: "user" | "asisten"; content: string }[];
}): Promise<string> {
  const convo = await db.aiConversation.create({
    data: {
      userId,
      scopeIds: [],
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-27"),
      pendingSince: new Date(Date.now() - opts.umurMs),
    },
    select: { id: true },
  });
  // createdAt naik seiring urutan supaya "pesan terakhir" tidak bergantung
  // pada resolusi jam basis data.
  let t = Date.now() - 60_000;
  for (const p of opts.pesan) {
    await db.aiMessage.create({
      data: { conversationId: convo.id, role: p.role, content: p.content, createdAt: new Date(t) },
    });
    t += 1_000;
  }
  return convo.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `pengguna-${suffix}`,
      fullName: "Penanya",
      passwordHash: "x",
      role: "project_manager",
    },
    select: { id: true },
  });
  userId = u.id;
  batasMs = batasJawabanMs(await getAiGuardConfig());
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ai_messages, ai_conversations, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  dijalankan.length = 0;
  await db.aiMessage.deleteMany({});
  await db.aiConversation.deleteMany({});
});

describe("yang benar-benar menggantung", () => {
  it("dijalankan ulang, dan penandanya dipasang lagi supaya layar tahu", async () => {
    const id = await buatPercakapan({
      umurMs: batasMs + 60_000,
      pesan: [{ role: "user", content: "bagaimana progres pekan ini" }],
    });

    const hasil = await jemputTanyaTertunda();

    expect(hasil.dijemput).toBe(1);
    expect(dijalankan).toEqual([id]);
    const convo = await db.aiConversation.findUnique({
      where: { id },
      select: { pendingSince: true },
    });
    expect(convo?.pendingSince).not.toBeNull();
  });

  it("riwayat percakapan ikut, tanpa pertanyaan yang sedang dijawab", async () => {
    const id = await buatPercakapan({
      umurMs: batasMs + 60_000,
      pesan: [
        { role: "user", content: "pertanyaan lama" },
        { role: "asisten", content: "jawaban lama" },
        { role: "user", content: "pertanyaan yang menggantung" },
      ],
    });
    await jemputTanyaTertunda();
    expect(dijalankan).toEqual([id]);
  });
});

describe("pagar: yang TIDAK boleh dijemput", () => {
  it("belum lewat batas – prosesnya mungkin masih hidup", async () => {
    await buatPercakapan({
      umurMs: Math.max(0, batasMs - 60_000),
      pesan: [{ role: "user", content: "baru saja ditanya" }],
    });
    const hasil = await jemputTanyaTertunda();
    expect(hasil.diperiksa).toBe(0);
    expect(dijalankan).toEqual([]);
  });

  it("jawabannya sudah ada – penandanya saja yang tertinggal", async () => {
    // Proses lama mati SESUDAH menulis jawaban, SEBELUM mengosongkan penanda.
    // Menjawab ulang di sini akan membuat jawaban dobel.
    const id = await buatPercakapan({
      umurMs: batasMs + 60_000,
      pesan: [
        { role: "user", content: "pertanyaan" },
        { role: "asisten", content: "jawaban yang sudah tertulis" },
      ],
    });
    const hasil = await jemputTanyaTertunda();

    expect(hasil.dibersihkan).toBe(1);
    expect(hasil.dijemput).toBe(0);
    expect(dijalankan).toEqual([]);
    const convo = await db.aiConversation.findUnique({
      where: { id },
      select: { pendingSince: true },
    });
    expect(convo?.pendingSince).toBeNull();
  });

  it("cron menit berikutnya TIDAK menjemput ulang yang baru saja dijalankan", async () => {
    /*
     * Ini keadaan nyatanya: route ini dipicu tiap menit. Penanda yang dipasang
     * ulang saat menjemput membuat percakapan itu kembali "masih dijawab",
     * jadi putaran berikutnya melewatinya — bukan menumpuk jawaban.
     *
     * Balapan dua cron yang benar-benar bersamaan ditutup oleh klaim atomik
     * (`updateMany` ber-syarat `pendingSince` yang sama), bukan oleh uji ini:
     * dua panggilan `Promise.all` di sini berbagi satu koneksi dan urutannya
     * tidak dijamin, jadi ia akan hijau tanpa membuktikan apa pun.
     */
    await buatPercakapan({
      umurMs: batasMs + 60_000,
      pesan: [{ role: "user", content: "pertanyaan" }],
    });
    const a = await jemputTanyaTertunda();
    const b = await jemputTanyaTertunda();
    expect(a.dijemput).toBe(1);
    expect(b.diperiksa).toBe(0);
    expect(dijalankan).toHaveLength(1);
  });

  it("percakapan tanpa penanda tunggu tidak pernah tersentuh", async () => {
    const convo = await db.aiConversation.create({
      data: {
        userId,
        scopeIds: [],
        periodStart: new Date("2026-08-01"),
        periodEnd: new Date("2026-08-27"),
        pendingSince: null,
      },
      select: { id: true },
    });
    await db.aiMessage.create({
      data: { conversationId: convo.id, role: "user", content: "selesai" },
    });
    const hasil = await jemputTanyaTertunda();
    expect(hasil.diperiksa).toBe(0);
  });
});
