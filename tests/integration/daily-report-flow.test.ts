// Integration test siklus laporan harian terpadu (jantung sistem):
// draft → item (guard volume) → dikirim → perlu_koreksi → dikirim → disetujui → final.
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

// Modul Next tidak tersedia di vitest node — mock tipis.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const {
  getOrCreateDraft,
  upsertItem,
  submitReport,
  returnReport,
  approveReport,
  finalizeReport,
} = await import("@/lib/daily-report/service");

const suffix = `drf-${Date.now().toString(36)}`;
let locationId: string;
let mandorId: string;
let smId: string;
let nodeId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 111_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 153,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-11-01"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug: suffix,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI", amount: 100_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kat.id,
      kind: "item",
      code: "1",
      name: "Pasangan batu",
      volume: 100,
      unit: "m3",
      unitPrice: 1_000_000,
      amount: 100_000_000n,
      lineageKey: "I#1",
      sortOrder: 2,
    },
  });
  nodeId = node.id;
  const mandor = await db.user.create({
    data: { orgId: org.id, username: `mandor-${suffix}`, fullName: "Mandor Uji", passwordHash: "x", role: "field_supervisor" },
  });
  const sm = await db.user.create({
    data: { orgId: org.id, username: `sm-${suffix}`, fullName: "SM Uji", passwordHash: "x", role: "site_manager" },
  });
  mandorId = mandor.id;
  smId = sm.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("siklus laporan harian terpadu", () => {
  const dateKey = "2026-07-01";

  it("draft → item tersimpan, valueDone dihitung server", async () => {
    const report = await getOrCreateDraft(locationId, dateKey, mandorId);
    expect(report.status).toBe("draft");
    await upsertItem(report.id, { rabNodeId: nodeId, volumeDone: 2.5 }, mandorId);
    const item = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: report.id } });
    expect(item.valueDone).toBe(2_500_000n);
    expect(item.lineageKey).toBe("I#1");
  });

  it("guard: volume kumulatif melebihi volume RAB ditolak", async () => {
    const report = await getOrCreateDraft(locationId, dateKey, mandorId);
    await expect(upsertItem(report.id, { rabNodeId: nodeId, volumeDone: 500 }, mandorId)).rejects.toThrow();
  });

  it("upsert item = idempotent (tidak dobel)", async () => {
    const report = await getOrCreateDraft(locationId, dateKey, mandorId);
    await upsertItem(report.id, { rabNodeId: nodeId, volumeDone: 3 }, mandorId);
    const count = await db.dailyReportItem.count({ where: { reportId: report.id } });
    expect(count).toBe(1);
  });

  it("kirim → kembalikan (alasan) → kirim ulang → setujui → final + snapshot", async () => {
    const report = await getOrCreateDraft(locationId, dateKey, mandorId);
    await submitReport(report.id, mandorId);
    await returnReport(report.id, "Volume tidak sesuai foto", smId);
    let r = await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(r.status).toBe("perlu_koreksi");

    await upsertItem(report.id, { rabNodeId: nodeId, volumeDone: 2, notes: "dikoreksi" }, mandorId);
    await submitReport(report.id, mandorId);
    await approveReport(report.id, smId);
    await finalizeReport(report.id, smId);

    r = await db.dailyReport.findUniqueOrThrow({
      where: { id: report.id },
      include: { statusHistory: true, items: true },
    } as never);
    expect(r.status).toBe("final");
    expect(r.finalSnapshot).not.toBeNull();
    const full = await db.dailyReport.findUniqueOrThrow({
      where: { id: report.id },
      include: { statusHistory: { orderBy: { changedAt: "asc" } }, items: true },
    });
    // histori lengkap termasuk pembuatan draft
    const seq = full.statusHistory.map((h) => h.toStatus);
    expect(seq).toEqual(["draft", "dikirim", "perlu_koreksi", "dikirim", "disetujui", "final"]);
    const koreksi = full.statusHistory.find((h) => h.toStatus === "perlu_koreksi");
    expect(koreksi?.reason).toContain("foto");
    // koreksi mengedit report yang sama — item tetap 1 (angka tidak dobel)
    expect(full.items.length).toBe(1);
    expect(Number(full.items[0].volumeDone)).toBe(2);
  });

  it("transisi ilegal ditolak (final → dikirim)", async () => {
    const report = await getOrCreateDraft(locationId, "2026-07-01", mandorId).catch(() => null);
    // report sudah final — getOrCreateDraft harus menolak/mengembalikan yang final tanpa reset
    const r = await db.dailyReport.findFirstOrThrow({
      where: { locationId, reportDate: new Date("2026-07-01T00:00:00Z") },
    });
    expect(r.status).toBe("final");
    await expect(submitReport(r.id, mandorId)).rejects.toThrow();
    void report;
  });
});
