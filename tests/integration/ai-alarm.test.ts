/*
 * ALARM KEGAGALAN AI (DECISIONS 635).
 *
 * Gangguan provider 4–27 Sep berjalan tiga minggu tanpa diketahui siapa pun.
 * Spesifikasi Fase 0 menaruh alarmnya di cron `cron-waha` – koreksinya: cron
 * GitHub itu dijadwalkan tiap 5 menit tetapi nyatanya jalan tiap 3–6,5 jam,
 * jadi alarm dinilai SAAT run gagal dicatat; cron hanya jaring cadangan.
 *
 * Aturan: menyala bila 5 run terakhir (60 menit) semuanya gagal, atau > 20%
 * gagal dari minimal 5 run. Saat menyala: satu WA ke penerima alarm, satu baris
 * audit, spanduk di layar. Kirim ulang paling cepat 6 jam per kode galat.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const terkirim: { destination: string; teks: string; key?: string }[] = [];
vi.mock("@/lib/waha/gateway", () => ({
  sendWaMessage: async (input: { destination: string; payload: { teks: string }; idempotencyKey?: string }) => {
    terkirim.push({ destination: input.destination, teks: input.payload.teks, key: input.idempotencyKey });
    return { id: "x", status: "diterima_waha", waMessageId: "m", error: null, diterimaWaha: true };
  },
}));

const { db } = await import("@/lib/db");
const { periksaAlarmAi, statusAlarmAi, nilaiAlarm } = await import("@/lib/ai-hub/alarm");
const { putAiSetting, ALERT_CHAT_KEY } = await import("@/lib/ai/config");

const suffix = `al${Date.now().toString(36)}`;
let orgId = "";
let userId = "";
const GRUP = "120363099999999999@g.us";

async function run(status: "siap" | "gagal", errorCode: string | null = status === "gagal" ? "billing" : null) {
  const now = new Date();
  await db.aiRun.create({
    data: {
      userId,
      orgId,
      runKind: "tanya",
      status,
      scopeType: "all",
      scopeIds: [],
      periodStart: now,
      periodEnd: now,
      provider: "mistral",
      errorCode,
      finishedAt: now,
    },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  userId = (
    await db.user.create({
      data: { orgId, username: `u-${suffix}`, fullName: "U", passwordHash: "x", role: "super_admin" },
    })
  ).id;
  await putAiSetting(ALERT_CHAT_KEY, GRUP);
});

beforeEach(() => {
  terkirim.length = 0;
});

describe("aturan alarm (murni)", () => {
  it("5 gagal beruntun → menyala; 1 gagal dari 20 → tidak", () => {
    const g = (n: number) => Array.from({ length: n }, () => ({ gagal: true, errorCode: "billing" }));
    const s = (n: number) => Array.from({ length: n }, () => ({ gagal: false, errorCode: null }));
    expect(nilaiAlarm(g(5)).nyala).toBe(true);
    expect(nilaiAlarm(g(4)).nyala).toBe(false);
    expect(nilaiAlarm([...g(1), ...s(19)]).nyala).toBe(false);
    // 4 dari 20 = 20% – belum LEBIH dari 20%.
    expect(nilaiAlarm([...s(16), ...g(4)]).nyala).toBe(false);
    expect(nilaiAlarm([...s(3), ...g(2)]).nyala).toBe(true);
    expect(nilaiAlarm([...g(2), ...s(3)]).errorCode).toBe("billing");
  });
});

describe("alarm kegagalan AI", () => {
  it("5 run gagal → tepat SATU WA ke penerima alarm dan satu baris audit", async () => {
    for (let i = 0; i < 5; i++) await run("gagal");
    const r = await periksaAlarmAi({ orgId });
    expect(r.nyala).toBe(true);
    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].destination).toBe(GRUP);
    expect(terkirim[0].teks).toMatch(/billing/);
    expect(await db.auditLog.count({ where: { action: "ai.alarm", resourceId: orgId } })).toBe(1);
  });

  it("alarm kedua dalam 6 jam untuk kode yang sama TIDAK terkirim", async () => {
    await run("gagal");
    await periksaAlarmAi({ orgId });
    await periksaAlarmAi({ orgId });
    expect(terkirim).toHaveLength(0);
    expect(await db.auditLog.count({ where: { action: "ai.alarm", resourceId: orgId } })).toBe(1);
  });

  it("spanduk menyebut kode galat terakhir, dan padam begitu ada jawaban berhasil", async () => {
    expect(await statusAlarmAi(orgId)).toMatchObject({ errorCode: "billing" });
    await run("siap");
    expect(await statusAlarmAi(orgId)).toBeNull();
  });
});
