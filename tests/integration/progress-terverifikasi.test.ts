// Level status progress (CIP + DECISIONS 426): `statusLevel: "terverifikasi"`
// memakai FUNGSI DAN RUMUS YANG SAMA — hanya saringan status yang berbeda,
// dan default TIDAK berubah.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { getLocationProgress } = await import("@/lib/progress");

const suffix = `pvf-${Date.now().toString(36)}`;
let locationId: string;
let dikirimId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: `Lokasi ${suffix}`, slug: suffix,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
  });
  locationId = loc.id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN", amount: 100_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Item", volume: 100, unit: "m3",
      unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  const sm = await db.user.create({
    data: { orgId: org.id, username: `sm-${suffix}`, fullName: "SM", passwordHash: "x", role: "site_manager" },
  });
  // Laporan DISETUJUI: 10 m3 (10%).
  const disetujui = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-08-01T00:00:00Z"), status: "disetujui", createdById: sm.id },
  });
  await db.dailyReportItem.create({
    data: { reportId: disetujui.id, rabNodeId: node.id, lineageKey: "I#1", volumeDone: 10, valueDone: 10_000_000n },
  });
  // Laporan baru DIKIRIM (belum diverifikasi): 5 m3 (5%).
  const dikirim = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-08-02T00:00:00Z"), status: "dikirim", createdById: sm.id },
  });
  dikirimId = dikirim.id;
  await db.dailyReportItem.create({
    data: { reportId: dikirim.id, rabNodeId: node.id, lineageKey: "I#1", volumeDone: 5, valueDone: 5_000_000n },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("progress terverifikasi vs dilaporkan", () => {
  it("PROOF: dilaporkan 15% (10+5), terverifikasi 10% (disetujui saja)", async () => {
    // Hitung manual: RAB 100 jt; disetujui 10/100×100jt = 10 jt; dikirim 5 jt.
    // dilaporkan   = (10jt + 5jt) / 100jt = 15%
    // terverifikasi = 10jt / 100jt        = 10%
    const dilaporkan = await getLocationProgress(locationId);
    const verif = await getLocationProgress(locationId, { statusLevel: "terverifikasi" });
    expect(dilaporkan.realizedValue).toBe(15_000_000n);
    expect(dilaporkan.realizedPct).toBeCloseTo(15, 6);
    expect(verif.realizedValue).toBe(10_000_000n);
    expect(verif.realizedPct).toBeCloseTo(10, 6);
    // Penyebut (grandTotal) HARUS sama — hanya saringan status yang berbeda.
    expect(verif.grandTotal).toBe(dilaporkan.grandTotal);
  });

  it("default (tanpa statusLevel) identik dengan 'dilaporkan' – angka resmi tidak berubah", async () => {
    const bawaan = await getLocationProgress(locationId);
    const eksplisit = await getLocationProgress(locationId, { statusLevel: "dilaporkan" });
    expect(eksplisit.realizedValue).toBe(bawaan.realizedValue);
    expect(eksplisit.realizedPct).toBe(bawaan.realizedPct);
  });

  it("laporan dikirim yang DISETUJUI menyusul menaikkan level terverifikasi", async () => {
    await db.dailyReport.update({ where: { id: dikirimId }, data: { status: "disetujui" } });
    const verif = await getLocationProgress(locationId, { statusLevel: "terverifikasi" });
    expect(verif.realizedValue).toBe(15_000_000n);
    const dilaporkan = await getLocationProgress(locationId);
    // Kedua level kini sama — tidak ada lagi laporan yang menggantung.
    expect(dilaporkan.realizedValue).toBe(verif.realizedValue);
  });
});
