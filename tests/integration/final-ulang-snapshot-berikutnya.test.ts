// BUKA KUNCI → KOREKSI → FINAL ULANG HARUS MEMBANGUN ULANG SNAPSHOT HARI-HARI
// SESUDAHNYA.
//
// `finalSnapshot` membekukan volumeBefore & volumeCumulative. Kalau volume
// laporan yang LEBIH AWAL dikoreksi sesudah dibuka kuncinya, laporan final
// hari-hari berikutnya tetap menyimpan kumulatif lama: cetak/PDF/Drive hari itu
// menampilkan angka yang MARLIN sendiri tahu sudah salah, sementara laporan
// mingguan dan progres sudah memakai angka baru. Pemindahan tanggal laporan
// sudah menghitung ulang rentang terdampak dengan alasan yang sama
// (DECISIONS 415); jalur buka-kunci terlewat. Audit 2026-09-15 (A-4).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "marlin.uji", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/gdrive/antrean", () => ({ antrekanLaporanHarian: async () => {} }));

const { db } = await import("@/lib/db");
const {
  getOrCreateDraft, upsertItem, submitReport, approveReport, finalizeReport,
  unfinalizeReport, returnReport,
} = await import("@/lib/daily-report/service");

const suffix = `fu${Date.now().toString(36)}`;
const LK = "I#FU1";
const HARGA = 1_000_000;
const HARI_1 = "2026-06-08";
const HARI_2 = "2026-06-10";

let locationId = "";
let mandorId = "";
let pmId = "";
let adminId = "";
let nodeId = "";
let lap1 = "";
let lap2 = "";

async function buatUser(nama: string, role: "site_manager" | "project_manager" | "super_admin", orgId: string) {
  return (
    await db.user.create({
      data: { orgId, username: `${nama}-${suffix}`, fullName: nama, passwordHash: "x", role },
      select: { id: true },
    })
  ).id;
}

type SnapItem = { lineageKey: string; volumeBefore: number; volumeCumulative: number };

async function itemSnapshot(reportId: string): Promise<SnapItem> {
  const r = await db.dailyReport.findUniqueOrThrow({
    where: { id: reportId },
    select: { finalSnapshot: true },
  });
  const items = (r.finalSnapshot as unknown as { items: SnapItem[] } | null)?.items ?? [];
  const it = items.find((x) => x.lineageKey === LK);
  if (!it) throw new Error("item tidak ada di snapshot");
  return it;
}

async function lewatiSampaiFinal(reportId: string) {
  await submitReport(reportId, mandorId);
  await approveReport(reportId, pmId);
  await finalizeReport(reportId, adminId);
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  mandorId = await buatUser("Mandor", "site_manager", org.id);
  pmId = await buatUser("PM", "project_manager", org.id);
  adminId = await buatUser("Admin", "super_admin", org.id);

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
      packageId: pkg.id, name: "Lokasi FU", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov", status: "berjalan", isActive: true,
    },
    select: { id: true },
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
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Pasangan batu",
      volume: 100, unit: "m3", unitPrice: HARGA, amount: 100_000_000n, lineageKey: LK, sortOrder: 2,
    },
  });
  nodeId = node.id;

  // 8 Jun: 10 m³ → final. 10 Jun: 20 m³ → final (kumulatif beku 30).
  const r1 = await getOrCreateDraft(locationId, HARI_1, mandorId);
  lap1 = r1.id;
  await upsertItem(lap1, { rabNodeId: nodeId, volumeDone: 10 }, mandorId);
  await lewatiSampaiFinal(lap1);

  const r2 = await getOrCreateDraft(locationId, HARI_2, mandorId);
  lap2 = r2.id;
  await upsertItem(lap2, { rabNodeId: nodeId, volumeDone: 20 }, mandorId);
  await lewatiSampaiFinal(lap2);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("koreksi laporan yang sudah final", () => {
  it("snapshot awal membekukan kumulatif 30", async () => {
    const it = await itemSnapshot(lap2);
    expect(it.volumeBefore).toBeCloseTo(10, 6);
    expect(it.volumeCumulative).toBeCloseTo(30, 6);
  });

  it("sesudah 8 Jun dikoreksi 10 → 5, snapshot 10 Jun IKUT dibangun ulang", async () => {
    await unfinalizeReport(lap1, adminId, "Salah input volume");
    await returnReport(lap1, "Volume dikoreksi", pmId);
    await upsertItem(lap1, { rabNodeId: nodeId, volumeDone: 5 }, mandorId);
    await lewatiSampaiFinal(lap1);

    // Inilah invariannya: dokumen beku hari berikutnya tidak lagi menyebut
    // angka yang sudah diketahui salah.
    const it = await itemSnapshot(lap2);
    expect(it.volumeBefore).toBeCloseTo(5, 6);
    expect(it.volumeCumulative).toBeCloseTo(25, 6);

    // Dan snapshot 8 Jun sendiri memang ikut segar.
    const it1 = await itemSnapshot(lap1);
    expect(it1.volumeCumulative).toBeCloseTo(5, 6);
  });
});
