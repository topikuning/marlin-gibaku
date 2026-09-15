// VOLUME KONTRAK DIBACA DARI REVISI AKTIF, BUKAN NODE YANG MENEMPEL.
//
// `DailyReportItem.rabNodeId` ditulis sekali saat barisnya dibuat dan tidak
// pernah dipetakan ulang. Begitu adendum diaktifkan, node itu milik revisi
// `digantikan` — masa lalu. Dua akibatnya, keduanya sunyi:
//
//  1. Pagar volume mengadu realisasi dengan volume kontrak LAMA, jadi draft
//     yang melampaui kontrak berlaku LOLOS saat dikirim.
//  2. Workspace, blanko harian, dan finalSnapshot menulis "Volume Kontrak"
//     revisi lama, sementara laporan mingguan memakai revisi aktif — dua
//     dokumen resmi, dua volume kontrak untuk item yang sama.
//
// Audit 2026-09-15 (B-2).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));

const { db } = await import("@/lib/db");
const { getWorkspaceData } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, upsertItem, submitReport } = await import("@/lib/daily-report/service");

const suffix = `vk${Date.now().toString(36)}`;
const LK = "I#VK1";
const HARGA = 1_000_000;

let locationId = "";
let slug = "";
let userId = "";
let nodeLamaId = "";
let reportId = "";

async function buatRevisi(revisionNo: number, status: "aktif" | "draft", volume: number) {
  const rev = await db.rabRevision.create({
    data: {
      locationId, revisionNo, source: revisionNo === 1 ? "hps_awal" : "adendum", status,
      totalValue: BigInt(Math.round(volume * HARGA)),
    },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN UJI",
      amount: BigInt(Math.round(volume * HARGA)), lineageKey: "I", sortOrder: 1,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume, unit: "m3", unitPrice: HARGA,
      amount: BigInt(Math.round(volume * HARGA)), lineageKey: LK, sortOrder: 2,
    },
    select: { id: true },
  });
  return { revId: rev.id, itemId: item.id };
}

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
      contractValue: 100_000_000n, signedDate: new Date("2026-06-01"), durationDays: 30,
      startDate: new Date("2026-06-01"), endDate: new Date("2026-06-30"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi VK", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
    select: { id: true, slug: true },
  });
  locationId = loc.id;
  slug = loc.slug;

  // Revisi #1 volume 100. Laporan counted sebelumnya Σ = 50.
  const r1 = await buatRevisi(1, "aktif", 100);
  nodeLamaId = r1.itemId;
  const lalu = await getOrCreateDraft(locationId, "2026-06-05", userId);
  await upsertItem(lalu.id, { rabNodeId: nodeLamaId, volumeDone: 50 }, userId);
  await submitReport(lalu.id, userId);

  // Draft hari ini 40 m³ — masih sah terhadap kontrak lama (50 + 40 ≤ 100).
  const kini = await getOrCreateDraft(locationId, "2026-06-08", userId);
  reportId = kini.id;
  await upsertItem(kini.id, { rabNodeId: nodeLamaId, volumeDone: 40 }, userId);

  // Adendum: revisi #2 MENURUNKAN volume item yang sama jadi 60. Revisi lama
  // disupersede DULU — satu lokasi hanya boleh punya satu revisi aktif.
  await db.rabRevision.update({
    where: { id: r1.revId },
    data: { status: "digantikan", supersededAt: new Date() },
  });
  await buatRevisi(2, "aktif", 60);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("draft yang dibuat SEBELUM adendum diaktifkan", () => {
  it("workspace menampilkan volume kontrak revisi AKTIF", async () => {
    const ws = await getWorkspaceData(slug, "2026-06-08");
    if (!ws?.report) throw new Error("workspace tidak terbentuk");
    const it = ws.report.items.find((x) => x.lineageKey === LK);
    if (!it) throw new Error("item tidak ada di workspace");
    expect(it.volumeContract).toBe(60);
  });

  it("pengiriman DITOLAK karena melampaui kontrak yang berlaku", async () => {
    // 50 (counted) + 40 (hari ini) = 90 > 60. Terhadap kontrak LAMA 100 ia lolos.
    await expect(submitReport(reportId, userId)).rejects.toThrow(/melebihi volume RAB|sisa 10|> RAB/i);
  });
});
