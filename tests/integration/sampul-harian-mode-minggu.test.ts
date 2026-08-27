// SAMPUL LAPORAN HARIAN MENGIKUTI MODE MINGGU KONTRAK (DECISIONS 451).
//
// Laporan user 2026-08-27: *"sampul di laporan harian, masih tidak menyesuaikan
// periode mingguan"*. Pratinjau memang sudah benar sejak DECISIONS 427 — yang
// tidak ikut adalah cabang FINAL, dan laporan lapangan yang sungguhan hampir
// semuanya sudah final. Jadi di lapangan sampulnya tidak pernah berubah.
//
// Uji ini menempuh KEDUA cabang atas kontrak yang sama, dan menempuhnya lewat
// finalisasi sungguhan — bukan snapshot karangan.
import { beforeAll, describe, expect, it, vi } from "vitest";
process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "m.uji" }) }));
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => false,
  r2PresignGet: async () => { throw new Error("off"); },
  r2GetBuffer: async () => { throw new Error("off"); },
}));
const { db } = await import("@/lib/db");
const { getKkpDailyData } = await import("@/lib/daily-report/queries");
const { getOrCreateDraft, upsertItem, submitReport, approveReport, finalizeReport } = await import(
  "@/lib/daily-report/service"
);

const s = `sm${Date.now().toString(36)}`;
let slug = "";
let pkgId = "";
let locationId = "";
let mandorId = "";
let pmId = "";
let adminId = "";
let batuId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `O ${s}`, slug: `o-${s}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `V ${s}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `P ${s}`, stage: "pelaksanaan" } });
  pkgId = pkg.id;
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `SPK-${s}`,
      contractValue: 1000n, signedDate: new Date("2026-05-25"), durationDays: 60,
      startDate: new Date("2026-06-03"), endDate: new Date("2026-08-01"),
    },
  });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Lok", slug: `l-${s}`, village: "D", regency: "K", province: "P", status: "berjalan", isActive: true },
    select: { id: true, slug: true },
  });
  slug = loc.slug;
  locationId = loc.id;

  const mkUser = async (n: string, role: "site_manager" | "project_manager" | "super_admin") =>
    (await db.user.create({ data: { orgId: org.id, username: `${n}-${s}`, fullName: n, passwordHash: "x", role }, select: { id: true } })).id;
  mandorId = await mkUser("Mandor", "site_manager");
  pmId = await mkUser("PM", "project_manager");
  adminId = await mkUser("Admin", "super_admin");
  for (const uid of [mandorId, pmId]) await db.locationAssignment.create({ data: { userId: uid, locationId } });

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 1000n, createdAt: new Date("2026-05-26") },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEK", amount: 1000n, lineageKey: "I", sortOrder: 1 },
  });
  batuId = (await db.rabNode.create({
    data: { revisionId: rev.id, parentId: kat.id, kind: "item", code: "I.1", name: "Batu", unit: "m3", volume: 10, unitPrice: 100, amount: 1000n, lineageKey: "I#1", sortOrder: 2 }, select: { id: true },
  })).id;
});

const ringkas = async (tanggal = "2026-06-10") => {
  const d = await getKkpDailyData(slug, tanggal);
  return { weekNo: d?.weekNo, periodStart: d?.periodStart, periodEnd: d?.periodEnd };
};

const setMode = (mode: "tujuh_hari" | "senin_minggu") =>
  db.contract.update({ where: { packageId: pkgId }, data: { weekMode: mode } });

/*
 * SPMK Rabu 3 Juni 2026. Dua tanggal laporan dipakai, dan keduanya perlu:
 *
 *  10 Juni (Rabu) → nomor mingguNya SAMA (2) di kedua mode, tapi RENTANGNYA
 *                   beda: 10–16 Juni vs 8–14 Juni. Menguji rentang saja.
 *   8 Juni (Senin) → NOMORNYA yang beda: minggu 1 (7-hari) vs minggu 2
 *                   (senin_minggu). Tanpa ini, uji tetap hijau walau nomornya
 *                   dibiarkan beku.
 */
describe("pratinjau: sampul ikut mode kontrak", () => {
  it("rentang periodenya berbeda per mode", async () => {
    await setMode("tujuh_hari");
    expect(await ringkas()).toEqual({
      weekNo: 2,
      periodStart: "10 Juni 2026",
      periodEnd: "16 Juni 2026",
    });
    await setMode("senin_minggu");
    expect(await ringkas()).toEqual({
      weekNo: 2,
      periodStart: "8 Juni 2026",
      periodEnd: "14 Juni 2026",
    });
  });

  it("nomor mingguNya pun berbeda per mode", async () => {
    await setMode("tujuh_hari");
    expect((await ringkas("2026-06-08")).weekNo).toBe(1);
    await setMode("senin_minggu");
    expect((await ringkas("2026-06-08")).weekNo).toBe(2);
  });
});

describe("final: sampul TETAP ikut mode kontrak yang berlaku", () => {
  it("mode diganti sesudah final → sampul ikut berubah", async () => {
    await setMode("tujuh_hari");
    const lap = await getOrCreateDraft(locationId, "2026-06-10", mandorId);
    await upsertItem(lap.id, { rabNodeId: batuId, volumeDone: 2 }, mandorId);
    await submitReport(lap.id, mandorId);
    await approveReport(lap.id, pmId);
    await finalizeReport(lap.id, adminId);

    // Dibekukan pada mode 7-hari.
    expect(await ringkas()).toEqual({
      weekNo: 2,
      periodStart: "10 Juni 2026",
      periodEnd: "16 Juni 2026",
    });

    // Inilah keluhannya: dulu baris di bawah ini tidak berubah sama sekali.
    await setMode("senin_minggu");
    expect(await ringkas()).toEqual({
      weekNo: 2,
      periodStart: "8 Juni 2026",
      periodEnd: "14 Juni 2026",
    });
  });

  it("snapshot LAMA (tanpa rentang beku) juga ikut, bukan jatuh ke 7-hari", async () => {
    /*
     * Meniru data pra-DECISIONS 427c: nomor minggu beku, rentang tidak pernah
     * ada. Dulu penyaji menurunkannya dengan `tujuh_hari` yang ditulis mati,
     * jadi sampul laporan lama tidak pernah bisa mengikuti mode kontrak.
     */
    const lap = await db.dailyReport.findFirst({
      where: { locationId, status: "final" },
      select: { id: true },
    });
    await db.$executeRawUnsafe(
      `UPDATE daily_reports SET final_snapshot = final_snapshot - 'periodStartKey' - 'periodEndKey' WHERE id = $1`,
      lap!.id,
    );
    await setMode("senin_minggu");
    expect(await ringkas()).toEqual({
      weekNo: 2,
      periodStart: "8 Juni 2026",
      periodEnd: "14 Juni 2026",
    });
  });
});
