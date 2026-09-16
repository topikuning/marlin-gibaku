// RENCANA MINGGUAN PADA KONTRAK MODE SENIN–MINGGU DENGAN SPMK BUKAN-SENIN.
//
// `weekMode` = `senin_minggu` adalah DEFAULT skema. Lapisan hitung memakai
// grid kalender: minggu 2 dari SPMK Kamis 5/3 adalah Senin 9/3 – Minggu 15/3.
// Tetapi penulis rentang rencana mingguan memakai aritmetika tujuh-hari dari
// SPMK (12/3 – 18/3), jadi:
//   – formulir rencana mencetak periode yang tidak sama dengan nomor minggunya,
//   – blanko harian tanggal 9/3 (minggu 2) menemukan rencana MINGGU 1,
//   – PPC minggu lalu mengukur realisasi di rentang yang salah.
// Audit 2026-09-15 (G-3).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => penggunaUji(),
    requireCapability: async () => penggunaUji(),
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { addWeeklyPlanItem } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { getRencanaMingguan } = await import("@/lib/plan/rencana-mingguan");
const { getKkpDailyData } = await import("@/lib/daily-report/queries");

const suffix = `wm${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const kunci = (t: Date) => t.toISOString().slice(0, 10);

// SPMK KAMIS. Grid senin_minggu: M1 = Kam 5/3 – Min 8/3, M2 = Sen 9/3 – Min 15/3.
const START = "2026-03-05";
const END = "2026-04-29";

let locationId = "";
let slug = "";
let userId = "";
let batuId = "";
let galianId = "";

async function penggunaUji() {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: 125_000_000n, signedDate: d(START), durationDays: 56,
      startDate: d(START), endDate: d(END), ppkName: "PPK Uji",
      // weekMode DIBIARKAN default skema = senin_minggu.
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi WM", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
  });
  locationId = loc.id;
  slug = loc.slug;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 125_000_000n },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: 125_000_000n, lineageKey: "I", sortOrder: 1,
    },
  });
  const batu = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  batuId = batu.id;
  const galian = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "2", name: "Galian tanah",
      volume: 50, unit: "m3", unitPrice: 500_000, amount: 25_000_000n, lineageKey: "I#2", sortOrder: 3,
    },
  });
  galianId = galian.id;

  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: 56 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: 9 }, (_, i) => ({
      baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / 9) * 100,
    })),
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

async function simpanRencana(minggu: number, rabNodeId = batuId) {
  const fd = new FormData();
  fd.set("locationId", locationId);
  fd.set("weekNumber", String(minggu));
  fd.set("rabNodeId", rabNodeId);
  fd.set("targetVolume", "10");
  const hasil = await addWeeklyPlanItem({}, fd);
  if (hasil?.error) throw new Error(hasil.error);
}

describe("rentang minggu rencana mengikuti grid kontrak", () => {
  it("WeeklyPlan minggu 2 disimpan Senin–Minggu, bukan SPMK+7", async () => {
    await simpanRencana(2);
    const plan = await db.weeklyPlan.findUniqueOrThrow({
      where: { locationId_weekNumber: { locationId, weekNumber: 2 } },
      select: { weekStart: true, weekEnd: true },
    });
    expect(kunci(plan.weekStart)).toBe("2026-03-09");
    expect(kunci(plan.weekEnd)).toBe("2026-03-15");
  });

  it("minggu 1 dipotong SPMK – bukan mundur ke Senin sebelum kontrak", async () => {
    await simpanRencana(1, galianId);
    const plan = await db.weeklyPlan.findUniqueOrThrow({
      where: { locationId_weekNumber: { locationId, weekNumber: 1 } },
      select: { weekStart: true, weekEnd: true },
    });
    expect(kunci(plan.weekStart)).toBe(START);
    expect(kunci(plan.weekEnd)).toBe("2026-03-08");
  });

  it("periode di kepala formulir sama dengan nomor minggunya", async () => {
    const form = await getRencanaMingguan(locationId, 2);
    if (!form) throw new Error("formulir rencana tidak terbentuk");
    expect(kunci(form.header.periodeStart)).toBe("2026-03-09");
    expect(kunci(form.header.periodeEnd)).toBe("2026-03-15");
  });

  it("blanko harian Kamis 12/3 memuat rencana minggu 2 pada HARI yang benar", async () => {
    /*
     * Minggu 2 = Sen 9/3 – Min 15/3, jadi 12/3 adalah hari ke-4 — hari saat
     * "Pasangan batu" (tahap struktur) memang dijadwalkan. Dengan rentang
     * tujuh-hari, minggu 2 tersimpan 12/3 – 18/3 dan 12/3 jadi hari ke-1:
     * kolom rencana blanko itu KOSONG. Nomor minggunya sama, harinya tidak.
     */
    const ws = await getKkpDailyData(slug, "2026-03-12");
    if (!ws) throw new Error("blanko harian tidak terbentuk");
    const nama = (ws.rencana ?? []).map((r) => r.name);
    expect(nama).toContain("Pasangan batu");
    // "Galian tanah" milik minggu 1 (Kam 5/3 – Min 8/3) – tidak boleh ikut.
    expect(nama).not.toContain("Galian tanah");
  });
});
