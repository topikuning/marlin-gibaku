// Reproduksi bug #2: laporan dikembalikan → item dihapus → input ulang.
// Volume tidak boleh terakumulasi seolah item lama masih dihitung.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const { getOrCreateDraft, upsertItem, removeItem, submitReport, returnReport } = await import(
  "@/lib/daily-report/service"
);
const { cumulativeVolumeByLineage } = await import("@/lib/progress");
const { parseDateKey } = await import("@/lib/format");

const suffix = `ret-${Date.now().toString(36)}`;
let locationId: string;
let nodeId: string;
let lineageKey: string;
let userId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `O ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `P ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "L", slug: suffix, village: "v", regency: "r", province: "p", status: "berjalan", isActive: true },
  });
  locationId = loc.id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "K", amount: 100n, lineageKey: "I", sortOrder: 1 },
  });
  const node = await db.rabNode.create({
    data: { revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Item", volume: 100, unit: "m3", unitPrice: 1000, amount: 100n, lineageKey: "I#1", sortOrder: 2 },
  });
  nodeId = node.id;
  lineageKey = node.lineageKey;
  const u = await db.user.create({ data: { orgId: org.id, username: `u-${suffix}`, fullName: "U", passwordHash: "x", role: "site_manager" } });
  userId = u.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("alur pengembalian laporan (bug #2)", () => {
  it("kumulatif kembali benar setelah dikembalikan + item dihapus + input ulang", async () => {
    // Hari-1: volume 40 → dikirim (counted)
    const r1 = await getOrCreateDraft(locationId, "2026-07-01", userId);
    await upsertItem(r1.id, { rabNodeId: nodeId, volumeDone: 40 }, userId);
    await submitReport(r1.id, userId);
    expect((await cumulativeVolumeByLineage(locationId)).get(lineageKey)).toBe(40);

    // Dikembalikan → perlu_koreksi: TIDAK lagi counted → kumulatif 0
    await returnReport(r1.id, "cek ulang", userId);
    expect((await cumulativeVolumeByLineage(locationId)).get(lineageKey) ?? 0).toBe(0);

    // Hapus item
    const item = await db.dailyReportItem.findFirstOrThrow({ where: { reportId: r1.id } });
    await removeItem(r1.id, item.id, userId);
    expect(await db.dailyReportItem.count({ where: { reportId: r1.id } })).toBe(0);

    // Input ulang 40 → tidak boleh ditolak sebagai "melebihi", dan kumulatif setelah kirim = 40 (bukan 80)
    await upsertItem(r1.id, { rabNodeId: nodeId, volumeDone: 40 }, userId);
    const items = await db.dailyReportItem.findMany({ where: { reportId: r1.id } });
    expect(items.length).toBe(1); // tidak dobel
    expect(Number(items[0].volumeDone)).toBe(40);
    await submitReport(r1.id, userId);
    expect((await cumulativeVolumeByLineage(locationId)).get(lineageKey)).toBe(40);
  });

  it("guard tetap mencegah melebihi volume RAB dengan report final sebelumnya", async () => {
    // Hari-2 final 30 (counted). Hari-3 dikirim 40 → return → hapus → input ulang 40.
    const rA = await getOrCreateDraft(locationId, "2026-06-01", userId);
    await upsertItem(rA.id, { rabNodeId: nodeId, volumeDone: 30 }, userId);
    await submitReport(rA.id, userId);
    // total counted sekarang = 40 (juli-1) + 30 (juni-1) = 70
    expect((await cumulativeVolumeByLineage(locationId)).get(lineageKey)).toBe(70);
    // sisa = 30. Input 40 di report baru harus DITOLAK.
    const rB = await getOrCreateDraft(locationId, "2026-06-02", userId);
    await expect(upsertItem(rB.id, { rabNodeId: nodeId, volumeDone: 40 }, userId)).rejects.toThrow(/melebihi/i);
    // Input 30 boleh (70+30=100).
    await upsertItem(rB.id, { rabNodeId: nodeId, volumeDone: 30 }, userId);
  });

  it("kumulatif s/d tanggal TIDAK menghitung laporan hari sesudahnya (tampilan KKP)", async () => {
    // Isolasi lokasi tersendiri supaya bebas dari data uji di atas.
    const org = await db.organization.create({ data: { name: `O2 ${suffix}`, slug: `${suffix}-2` } });
    const pkg = await db.package.create({ data: { orgId: org.id, name: `P2 ${suffix}`, stage: "pelaksanaan" } });
    const loc = await db.location.create({
      data: { packageId: pkg.id, name: "L2", slug: `${suffix}-2`, village: "v", regency: "r", province: "p", status: "berjalan", isActive: true },
    });
    const rev = await db.rabRevision.create({
      data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100n },
    });
    const kat = await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: "I", name: "K", amount: 100n, lineageKey: "I", sortOrder: 1 },
    });
    const node = await db.rabNode.create({
      data: { revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Item", volume: 100, unit: "m3", unitPrice: 1000, amount: 100n, lineageKey: "I#1", sortOrder: 2 },
    });
    const u = await db.user.create({ data: { orgId: org.id, username: `u2-${suffix}`, fullName: "U", passwordHash: "x", role: "site_manager" } });

    // Hari-10 = 5 (final/counted), Hari-11 = 5 (final/counted).
    const r10 = await getOrCreateDraft(loc.id, "2026-07-10", u.id);
    await upsertItem(r10.id, { rabNodeId: node.id, volumeDone: 5 }, u.id);
    await submitReport(r10.id, u.id);
    const r11 = await getOrCreateDraft(loc.id, "2026-07-11", u.id);
    await upsertItem(r11.id, { rabNodeId: node.id, volumeDone: 5 }, u.id);
    await submitReport(r11.id, u.id);

    const d10 = parseDateKey("2026-07-10")!;
    const d11 = parseDateKey("2026-07-11")!;
    // Kumulatif s/d 10 = 5 (bukan 10 — laporan 11 tidak boleh ikut).
    expect((await cumulativeVolumeByLineage(loc.id, d10)).get("I#1")).toBe(5);
    // Kumulatif s/d 11 = 10.
    expect((await cumulativeVolumeByLineage(loc.id, d11)).get("I#1")).toBe(10);
    // Tanpa batas tanggal (guard) = total 10.
    expect((await cumulativeVolumeByLineage(loc.id)).get("I#1")).toBe(10);
  });
});
