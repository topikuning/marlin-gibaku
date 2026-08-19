// ANTREAN JAWABAN WHATSAPP: durable, idempoten, punya dead-letter
// (DECISIONS 372).
//
// Temuan audit user 2026-08-19: webhook menunggu ingest, identitas, guard,
// provider AI, query data, DAN pengiriman WAHA sebelum mengembalikan 200. Dua
// panggilan jaringan ke pihak lain ada di dalam rantai itu. Kalau salah satunya
// lambat: webhook timeout → WAHA retry → event yang sama memicu AI dan balasan
// untuk KEDUA kalinya → kuota AI terhitung dua kali, penerima dapat dua pesan.
//
// `WaMessage.waMessageId` memang unique, tapi itu hanya menjaga ARSIP pesan
// masuk — ia tidak pernah menjadi pagar bagi proses tanya-jawab.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Berapa kali jalur jawab benar-benar dijalankan — inti seluruh berkas ini. */
let dijalankan = 0;
/** Disetel uji: kalau terisi, jalur jawab melempar. */
let lemparkan: string | null = null;

vi.mock("@/lib/waha/tanya", () => ({
  jawabPertanyaanWa: async () => {
    dijalankan++;
    if (lemparkan) throw new Error(lemparkan);
    return { dijawab: true, alasan: "dijawab (uji)" };
  },
}));

const { db } = await import("@/lib/db");
const { antreJawaban, prosesAntrean, ringkasAntreanWa, BATAS_PERCOBAAN } = await import(
  "@/lib/waha/antrean"
);

const suffix = `ant${Date.now().toString(36)}`;
const GRUP = `12036300000000777@g.us`;

let no = 0;
function event(o: { id?: string; fromMe?: boolean } = {}) {
  no += 1;
  return {
    event: "message",
    payload: {
      id: o.id ?? `m-${suffix}-${no}`,
      from: GRUP,
      author: "6285700000001@c.us",
      fromMe: o.fromMe ?? false,
      body: "progress hari ini",
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ANT ${suffix}`, slug: `oa-${suffix}` },
  });
  await db.package.create({
    data: { orgId: org.id, name: `Paket ANT ${suffix}`, waGroupId: GRUP },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE wa_reply_jobs, wa_messages, packages, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  dijalankan = 0;
  lemparkan = null;
  await db.waReplyJob.deleteMany({});
});

describe("idempotensi antrean", () => {
  it("event yang SAMA dua kali menghasilkan SATU pekerjaan", async () => {
    const ev = event();
    const a = await antreJawaban(ev);
    const b = await antreJawaban(ev);

    expect(a).toMatchObject({ antre: true, baru: true });
    // Yang kedua bukan galat — itu justru pagarnya bekerja.
    expect(b).toMatchObject({ antre: true, baru: false });
    expect(await db.waReplyJob.count()).toBe(1);
  });

  it("`message` dan `message.any` untuk pesan yang sama tetap satu pekerjaan", async () => {
    // Keduanya memang dikirim WAHA untuk satu pesan yang sama.
    const ev = event();
    await antreJawaban(ev);
    await antreJawaban({ ...ev, event: "message.any" });
    expect(await db.waReplyJob.count()).toBe(1);
  });

  it("dua event bersamaan (balapan INSERT) tetap satu pekerjaan", async () => {
    /*
     * Diselesaikan basis data lewat indeks unik, BUKAN oleh pemeriksaan
     * "sudah ada?" yang selalu punya celah di antara baca dan tulis.
     */
    const ev = event();
    const hasil = await Promise.all([antreJawaban(ev), antreJawaban(ev), antreJawaban(ev)]);
    expect(hasil.every((h) => h.antre)).toBe(true);
    expect(hasil.filter((h) => h.antre && h.baru)).toHaveLength(1);
    expect(await db.waReplyJob.count()).toBe(1);
  });

  it("pesan dari MARLIN sendiri tidak pernah masuk antrean", async () => {
    // Kalau ikut, MARLIN membalas balasannya sendiri.
    const h = await antreJawaban(event({ fromMe: true }));
    expect(h.antre).toBe(false);
    expect(await db.waReplyJob.count()).toBe(0);
  });

  it("payload tanpa id pesan DITOLAK — tanpa kunci, tak ada idempotensi", async () => {
    const h = await antreJawaban({ event: "message", payload: { tanpaApaPun: true } });
    expect(h).toMatchObject({ antre: false });
    expect(await db.waReplyJob.count()).toBe(0);
  });
});

describe("pemrosesan", () => {
  it("satu pekerjaan dijalankan SEKALI, lalu berstatus selesai", async () => {
    await antreJawaban(event());
    const h = await prosesAntrean();
    expect(h).toMatchObject({ diproses: 1, selesai: 1, gagal: 0 });
    expect(dijalankan).toBe(1);

    const job = await db.waReplyJob.findFirstOrThrow({ select: { status: true, hasil: true } });
    expect(job.status).toBe("selesai");
    expect(job.hasil).toContain("dijawab");
  });

  it("memproses ULANG tidak menjalankan pekerjaan yang sudah selesai", async () => {
    // Inilah yang dulu terjadi saat WAHA me-retry: AI dipanggil dua kali dan
    // penerima mendapat dua pesan.
    await antreJawaban(event());
    await prosesAntrean();
    await prosesAntrean();
    await prosesAntrean();
    expect(dijalankan).toBe(1);
  });

  it("dua processor bersamaan tidak mengerjakan pekerjaan yang sama", async () => {
    /*
     * Klaimnya satu `UPDATE … FOR UPDATE SKIP LOCKED`, jadi yang kalah balapan
     * tidak mendapat baris sama sekali — bukan menunggu lalu mengerjakannya
     * untuk kedua kalinya.
     */
    await antreJawaban(event());
    const [a, b] = await Promise.all([prosesAntrean(), prosesAntrean()]);
    expect(a.diproses + b.diproses).toBe(1);
    expect(dijalankan).toBe(1);
  });

  it("banyak pekerjaan diproses sampai batas yang diminta", async () => {
    for (let i = 0; i < 5; i++) await antreJawaban(event());
    const h = await prosesAntrean(3);
    expect(h.diproses).toBe(3);
    expect(await db.waReplyJob.count({ where: { status: "antre" } })).toBe(2);
  });
});

describe("kegagalan: backoff lalu dead-letter", () => {
  it("gagal sekali → kembali ANTRE dengan jeda, bukan langsung mati", async () => {
    lemparkan = "provider AI mati";
    await antreJawaban(event());
    const h = await prosesAntrean();
    expect(h).toMatchObject({ gagal: 0, diulang: 1 });

    const job = await db.waReplyJob.findFirstOrThrow();
    expect(job.status).toBe("antre");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain("provider AI mati");
    // Jedanya nyata: percobaan berikutnya tidak boleh langsung diambil.
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 1000);
  });

  it("pekerjaan yang sedang menunggu backoff TIDAK diambil", async () => {
    lemparkan = "gagal";
    await antreJawaban(event());
    await prosesAntrean();
    dijalankan = 0;

    const lagi = await prosesAntrean();
    expect(lagi.diproses).toBe(0);
    expect(dijalankan).toBe(0);
  });

  it("sesudah batas percobaan → GAGAL permanen, dan berhenti dicoba", async () => {
    /*
     * Antrean yang mengulang pekerjaan beracun selamanya akan menghabiskan
     * kuota AI dan menutupi pekerjaan sehat di belakangnya — tanpa ada yang
     * melihatnya, karena tidak ada yang pernah selesai untuk dilaporkan.
     */
    lemparkan = "selalu gagal";
    await antreJawaban(event());

    for (let i = 0; i < BATAS_PERCOBAAN; i++) {
      // Jedanya dilewati dengan menarik `next_attempt_at` ke masa lalu —
      // menunggu sungguhan akan membuat uji ini berjalan belasan menit.
      await db.waReplyJob.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await prosesAntrean();
    }

    const job = await db.waReplyJob.findFirstOrThrow();
    expect(job.status).toBe("gagal");
    expect(job.attempts).toBe(BATAS_PERCOBAAN);
    expect(job.finishedAt).not.toBeNull();

    // Dan benar-benar berhenti: putaran berikutnya tidak menyentuhnya lagi.
    dijalankan = 0;
    await db.waReplyJob.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const h = await prosesAntrean();
    expect(h.diproses).toBe(0);
    expect(dijalankan).toBe(0);
  });

  it("pekerjaan gagal TERLIHAT admin, beserta sebabnya", async () => {
    // Dead-letter yang tidak terlihat sama saja dengan pesan yang hilang.
    lemparkan = "meledak";
    await antreJawaban(event());
    for (let i = 0; i < BATAS_PERCOBAAN; i++) {
      await db.waReplyJob.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await prosesAntrean();
    }

    const r = await ringkasAntreanWa();
    expect(r.gagal).toBe(1);
    expect(r.contohGagal[0].lastError).toContain("meledak");
    expect(r.contohGagal[0].attempts).toBe(BATAS_PERCOBAAN);
    expect(r.contohGagal[0].chatId).toBe(GRUP);
  });

  it("satu pekerjaan beracun tidak menghalangi yang sehat di belakangnya", async () => {
    lemparkan = "racun";
    await antreJawaban(event({ id: `racun-${suffix}` }));
    await prosesAntrean();

    lemparkan = null;
    await antreJawaban(event({ id: `sehat-${suffix}` }));
    const h = await prosesAntrean();
    expect(h.selesai).toBe(1);

    const sehat = await db.waReplyJob.findUniqueOrThrow({
      where: { waMessageId: `sehat-${suffix}` },
      select: { status: true },
    });
    expect(sehat.status).toBe("selesai");
  });
});
