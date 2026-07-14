// Integration test terhadap Postgres nyata.
// Jalankan: DATABASE_URL=postgresql://marlin:marlin@localhost:5432/marlin_test APP_ENV=test \
//   pnpm prisma migrate deploy && pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

const { db } = await import("@/lib/db");

const suffix = Date.now().toString(36);
let orgId: string;
let userId: string;
let packageId: string;
let locationId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Test Org ${suffix}`, slug: `test-${suffix}` } });
  orgId = org.id;
  const user = await db.user.create({
    data: {
      orgId,
      username: `tester-${suffix}`,
      fullName: "Tester",
      passwordHash: "x",
      role: "super_admin",
    },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket Test ${suffix}` } });
  packageId = pkg.id;
  const loc = await db.location.create({
    data: {
      packageId,
      name: "Lokasi Test",
      slug: `lokasi-test-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = loc.id;
});

afterAll(async () => {
  // TRUNCATE tidak memicu row-level trigger append-only — aman utk bersih-bersih DB test.
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("constraint integritas inti", () => {
  it("laporan harian unik per (lokasi, tanggal) — anti-double-input di DB", async () => {
    const date = new Date("2026-07-01T00:00:00.000Z");
    await db.dailyReport.create({ data: { locationId, reportDate: date, createdById: userId } });
    await expect(
      db.dailyReport.create({ data: { locationId, reportDate: date, createdById: userId } }),
    ).rejects.toThrow(/unique/i);
  });

  it("item laporan unik per (report, lineageKey)", async () => {
    const rev = await db.rabRevision.create({
      data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 1000n },
    });
    const node = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "item",
        code: "1",
        name: "Item Uji",
        amount: 1000n,
        lineageKey: "I#1",
        sortOrder: 1,
      },
    });
    const report = await db.dailyReport.create({
      data: { locationId, reportDate: new Date("2026-07-02T00:00:00.000Z"), createdById: userId },
    });
    await db.dailyReportItem.create({
      data: { reportId: report.id, rabNodeId: node.id, lineageKey: node.lineageKey, volumeDone: 1, valueDone: 100n },
    });
    await expect(
      db.dailyReportItem.create({
        data: { reportId: report.id, rabNodeId: node.id, lineageKey: node.lineageKey, volumeDone: 2, valueDone: 200n },
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("kontrak unik per paket — konversi idempotent terjaga DB", async () => {
    const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });
    const base = {
      vendorId: vendor.id,
      contractValue: 1_000_000n,
      signedDate: new Date("2026-01-01"),
      startDate: new Date("2026-01-02"),
      endDate: new Date("2026-06-30"),
    };
    await db.contract.create({ data: { ...base, packageId, contractNumber: `K-${suffix}-1` } });
    await expect(
      db.contract.create({ data: { ...base, packageId, contractNumber: `K-${suffix}-2` } }),
    ).rejects.toThrow(/unique/i);
  });

  it("histori status laporan append-only (trigger menolak UPDATE)", async () => {
    const report = await db.dailyReport.create({
      data: { locationId, reportDate: new Date("2026-07-03T00:00:00.000Z"), createdById: userId },
    });
    const hist = await db.dailyReportStatusHistory.create({
      data: { reportId: report.id, toStatus: "dikirim", changedById: userId },
    });
    await expect(
      db.dailyReportStatusHistory.update({ where: { id: hist.id }, data: { reason: "ubah" } }),
    ).rejects.toThrow(/append-only/i);
  });

  it("audit log append-only (trigger menolak DELETE)", async () => {
    const log = await db.auditLog.create({
      data: { userId, action: "test.action", resourceType: "test" },
    });
    await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/i);
  });
});
