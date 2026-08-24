// Integration test VERIFIKASI EKSTERNAL Wakil PPK + inspeksi (DECISIONS 426):
// append-only, tidak menyentuh status laporan maupun angka resmi.
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

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
const { verifyReportExternal, latestVerification } = await import("@/lib/verifikasi/service");
const { createInspection, finalizeInspection, updateInspection } = await import("@/lib/inspections/service");
const { getLocationProgress } = await import("@/lib/progress");

const suffix = `vfe-${Date.now().toString(36)}`;
let locationId: string;
let wakilId: string;
let wakilLainId: string;
let reportDikirimId: string;
let reportDraftId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
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
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN", amount: 100_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Item", volume: 100, unit: "m3",
      unitPrice: 1_000_000, amount: 100_000_000n, lineageKey: "I#1", sortOrder: 2,
    },
  });
  const wakil = await db.user.create({
    data: { orgId: org.id, username: `wakil-${suffix}`, fullName: "Wakil Uji", passwordHash: "x", role: "wakil_ppk" },
  });
  wakilId = wakil.id;
  const wakil2 = await db.user.create({
    data: { orgId: org.id, username: `wakil2-${suffix}`, fullName: "Wakil Dua", passwordHash: "x", role: "wakil_ppk" },
  });
  wakilLainId = wakil2.id;
  const sm = await db.user.create({
    data: { orgId: org.id, username: `sm-${suffix}`, fullName: "SM Uji", passwordHash: "x", role: "site_manager" },
  });
  const dikirim = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-08-01T00:00:00Z"), status: "dikirim", createdById: sm.id },
  });
  const node = await db.rabNode.findFirstOrThrow({ where: { lineageKey: "I#1", revision: { locationId } } });
  await db.dailyReportItem.create({
    data: { reportId: dikirim.id, rabNodeId: node.id, lineageKey: "I#1", volumeDone: 10, valueDone: 10_000_000n },
  });
  reportDikirimId = dikirim.id;
  const draft = await db.dailyReport.create({
    data: { locationId, reportDate: new Date("2026-08-02T00:00:00Z"), status: "draft", createdById: sm.id },
  });
  reportDraftId = draft.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("verifikasi eksternal laporan harian", () => {
  it("laporan draft TIDAK bisa diverifikasi", async () => {
    await expect(verifyReportExternal(reportDraftId, "diverifikasi", null, wakilId)).rejects.toThrow(/draft/i);
  });

  it("hasil selain Diverifikasi WAJIB bercatatan", async () => {
    await expect(verifyReportExternal(reportDikirimId, "ditolak", null, wakilId)).rejects.toThrow(/catatan/i);
  });

  it("append-only: dua pemeriksaan = dua baris, baris terakhir = keadaan", async () => {
    await verifyReportExternal(reportDikirimId, "perlu_klarifikasi", "Foto item I#1 kurang", wakilId);
    await verifyReportExternal(reportDikirimId, "diverifikasi", "Sudah dilengkapi", wakilLainId);
    const rows = await db.reportVerification.findMany({ where: { reportId: reportDikirimId }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    const terkini = await latestVerification(reportDikirimId);
    expect(terkini?.status).toBe("diverifikasi");
    expect(terkini?.verifiedById).toBe(wakilLainId);
  });

  it("baris verifikasi tidak bisa DIUBAH (trigger append-only)", async () => {
    const row = await db.reportVerification.findFirstOrThrow({ where: { reportId: reportDikirimId } });
    await expect(
      db.$executeRawUnsafe(`UPDATE report_verifications SET note = 'diubah' WHERE id = '${row.id}'`),
    ).rejects.toThrow(/append-only/i);
  });

  it("TIDAK menyentuh status laporan maupun angka resmi", async () => {
    const report = await db.dailyReport.findUniqueOrThrow({ where: { id: reportDikirimId } });
    expect(report.status).toBe("dikirim"); // status internal tidak bergeser
    // Angka resmi tetap dihitung dari status internal (dikirim ikut dihitung),
    // ada atau tidak ada verifikasi wakil.
    const progress = await getLocationProgress(locationId);
    expect(progress.realizedPct).toBeCloseTo(10, 5);
  });

  it("audit tercatat dengan aksi report.verify_external", async () => {
    const audit = await db.auditLog.findFirst({
      where: { action: "report.verify_external", resourceId: reportDikirimId },
    });
    expect(audit).not.toBeNull();
  });
});

describe("inspeksi lapangan", () => {
  it("draft → hanya pemeriksanya yang bisa ubah → final immutable", async () => {
    const insp = await createInspection(
      { locationId, inspectionDateKey: "2026-08-03", title: "Inspeksi pondasi" },
      wakilId,
    );
    await expect(
      updateInspection(insp.id, { title: "Diubah orang lain" }, wakilLainId),
    ).rejects.toThrow(/pemeriksanya sendiri/i);
    await updateInspection(insp.id, { title: "Inspeksi pondasi minggu 12", notes: "OK" }, wakilId);
    await expect(finalizeInspection(insp.id, wakilLainId)).rejects.toThrow(/pemeriksanya sendiri/i);
    await finalizeInspection(insp.id, wakilId);
    const row = await db.inspection.findUniqueOrThrow({ where: { id: insp.id } });
    expect(row.status).toBe("final");
    await expect(updateInspection(insp.id, { title: "Telat" }, wakilId)).rejects.toThrow(/final/i);
  });
});
