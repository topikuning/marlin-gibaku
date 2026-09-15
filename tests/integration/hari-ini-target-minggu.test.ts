// "TARGET MINGGU INI" DI /hari-ini HARUS MENGUKUR MINGGU INI.
//
// Target diambil dari WeeklyPlan minggu berjalan, tetapi realisasinya dulu
// dihitung KUMULATIF sepanjang proyek. Item yang sudah dikerjakan sebelum
// minggu ini membuat layar pelaksana menulis "25/20 m³" — target tercapai —
// untuk minggu yang belum disentuh sama sekali, sementara halaman lokasi › RAB
// untuk rencana minggu YANG SAMA menulis "0/20". Audit 2026-09-15 (B-1).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { getHariIniLocation } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `ht${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

const START = "2026-06-01"; // Senin
/** Minggu berjalan yang dipakai uji: 2026-06-22 s/d 2026-06-28. */
const MINGGU_START = "2026-06-22";
const MINGGU_END = "2026-06-28";
const HARI_INI = "2026-06-24";

let locationId = "";
let userId = "";
let batuId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Mandor", passwordHash: "x", role: "site_manager" },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: 100_000_000n, signedDate: d(START), durationDays: 42,
      startDate: d(START), endDate: d("2026-07-12"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi HT", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: 100_000_000n, lineageKey: "I", sortOrder: 1,
    },
  });
  const batu = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  batuId = batu.id;

  // 25 m³ dikerjakan SEBELUM minggu rencana ini.
  const lalu = await getOrCreateDraft(locationId, "2026-06-10", userId);
  await upsertItem(lalu.id, { rabNodeId: batuId, volumeDone: 25 }, userId);
  await submitReport(lalu.id, userId);

  const plan = await db.weeklyPlan.create({
    data: {
      locationId, weekNumber: 4, weekStart: d(MINGGU_START), weekEnd: d(MINGGU_END),
      createdById: userId,
    },
  });
  await db.weeklyPlanItem.create({
    data: { weeklyPlanId: plan.id, rabNodeId: batuId, targetVolume: 20, priority: 1 },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("target minggu berjalan di /hari-ini", () => {
  it("belum ada pekerjaan minggu ini → realisasi 0, bukan kumulatif proyek", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${HARI_INI}T09:00:00+07:00`));
    try {
      const h = await getHariIniLocation(locationId);
      if (!h) throw new Error("ringkasan lokasi tidak terbentuk");
      expect(h.weekNumber).toBe(4);
      expect(h.weeklyTargets).toHaveLength(1);
      expect(h.weeklyTargets[0].targetVolume).toBe(20);
      expect(h.weeklyTargets[0].realizedVolume).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pekerjaan DI DALAM minggu itu terhitung", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${HARI_INI}T09:00:00+07:00`));
    try {
      const r = await getOrCreateDraft(locationId, "2026-06-23", userId);
      await upsertItem(r.id, { rabNodeId: batuId, volumeDone: 8 }, userId);
      await submitReport(r.id, userId);

      const h = await getHariIniLocation(locationId);
      if (!h) throw new Error("ringkasan lokasi tidak terbentuk");
      expect(h.weeklyTargets[0].realizedVolume).toBeCloseTo(8, 6);
    } finally {
      vi.useRealTimers();
    }
  });
});
