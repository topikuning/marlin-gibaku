// Status laporan harian SAMPAI ke data cetak (DECISIONS 760).
//
// Tanda tangan & stempel harian ditempel hanya bila status disetujui/final.
// Kalau status tidak terbawa ke `getKkpDailyData`, laporan FINAL pun diam-diam
// tercetak tanpa tanda tangan – uji ini yang menjaganya, untuk jalur data
// hidup maupun snapshot final.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { getOrCreateDraft, upsertItem, buildFinalSnapshot } = await import("@/lib/daily-report/service");
const { getKkpDailyData } = await import("@/lib/daily-report/queries");
const { ttdHarianBoleh } = await import("@/lib/lifecycle");
import type { FlatNode } from "@/lib/rab/flatten";
import type { Prisma } from "@/generated/prisma/client";

const suffix = `th${Date.now().toString(36)}`;
const slug = `talud-${suffix}`;
let userId = "";
let locationId = "";
let nodeId = "";

const ITEM: FlatNode = {
  kind: "item",
  code: "1",
  name: "Galian Tanah Biasa",
  volume: 100,
  unit: "m3",
  unitPrice: 50_000,
  amount: 5_000_000n,
  lineageKey: "I#1",
  parentLineageKey: "I",
  sortOrder: 1,
  excelRow: null,
};
const KATEGORI: FlatNode = {
  kind: "kategori",
  code: "I",
  name: "PEKERJAAN TALUD",
  volume: null,
  unit: null,
  unitPrice: null,
  amount: 5_000_000n,
  lineageKey: "I",
  parentLineageKey: null,
  sortOrder: 0,
  excelRow: null,
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  userId = (
    await db.user.create({ data: { orgId: org.id, username: `u-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Talud", slug, village: "Talud", regency: "Rembang", province: "Jateng", status: "berjalan", isActive: true },
    })
  ).id;
  const r = await createRevisionFromNodes(locationId, [KATEGORI, ITEM], { source: "hps_awal", userId, note: "kontrak" });
  await activateRevision(r.revisionId, userId);
  nodeId = (await db.rabNode.findFirstOrThrow({ where: { revisionId: r.revisionId, kind: "item" } })).id;
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("status laporan harian di data cetak", () => {
  it("dikirim → tanpa tanda tangan; disetujui → bertanda tangan; final (snapshot) → bertanda tangan", async () => {
    const lap = await getOrCreateDraft(locationId, "2026-10-01", userId);
    await upsertItem(lap.id, { rabNodeId: nodeId, volumeDone: 3 }, userId);

    const cek = async () => {
      const d = await getKkpDailyData(slug, "2026-10-01");
      return [d?.status, ttdHarianBoleh(d?.status)];
    };
    expect(await cek()).toEqual(["draft", false]);
    await db.dailyReport.update({ where: { id: lap.id }, data: { status: "dikirim" } });
    expect(await cek()).toEqual(["dikirim", false]);
    await db.dailyReport.update({ where: { id: lap.id }, data: { status: "disetujui" } });
    expect(await cek()).toEqual(["disetujui", true]);
    await db.dailyReport.update({ where: { id: lap.id }, data: { status: "final" } });
    const snap = await buildFinalSnapshot(lap.id);
    await db.dailyReport.update({ where: { id: lap.id }, data: { finalSnapshot: snap as unknown as Prisma.InputJsonValue } });
    expect(await cek()).toEqual(["final", true]);
  });

  it("hari tanpa laporan → tanpa tanda tangan", async () => {
    const d = await getKkpDailyData(slug, "2026-10-02");
    expect(ttdHarianBoleh(d?.status)).toBe(false);
  });
});
