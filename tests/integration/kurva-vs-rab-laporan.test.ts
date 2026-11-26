/*
 * LEMBAR KURVA-S LAPORAN PERIODIK vs RAB AKTIF (DECISIONS 794).
 *
 * Keadaan BUYAT TENGAH sesudah CCO + koreksi (user 2026-11-26, Kurva S minggu
 * ke-10): jadwal tersimpan masih jadwal kontrak – Tambatan Perahu berbobot
 * padahal 0 di RAB aktif; kategori bayangan parser lama ("judul tidak ada di
 * file") berbaris 0; Genset ada di RAB aktif tetapi tanpa jadwal.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `kr${Date.now().toString(36)}`;
const START = "2026-01-05";
const WEEKS = 4;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
let locationId = "";
let orgId = "";

/** Kategori RAB aktif: Tambatan 0 (dinolkan CCO), Genset baru. */
const KATEGORI = [
  { key: "I", code: "I", name: "PEKERJAAN PERSIAPAN", amount: 30_000_000n },
  { key: "III", code: "III", name: "PEKERJAAN TAMBATAN PERAHU", amount: 0n },
  { key: "IV", code: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", amount: 50_000_000n },
  { key: "XII#2", code: "XII", name: "PEKERJAAN BANGUNAN GENSET", amount: 20_000_000n },
];
/** Jadwal tersimpan (kontrak lama) – bobot per minggu. */
const JADWAL = [
  { key: "I", name: "PEKERJAAN PERSIAPAN", weekly: [10, 10, 0, 0] },
  { key: "III", name: "PEKERJAAN TAMBATAN PERAHU", weekly: [0, 10, 20, 0] },
  { key: "IV", name: "PEKERJAAN DINDING PENAHAN TANAH", weekly: [0, 10, 20, 20] },
  { key: "XII#2", name: "PEKERJAAN BANGUNAN GENSET", weekly: [0, 0, 0, 0] },
  { key: "III#2", name: "PEKERJAAN (kategori III – judul tidak ada di file)", weekly: [0, 0, 0, 0] },
];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  orgId = org.id;
  const vendor = await db.vendor.create({ data: { orgId, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      signedDate: d(START),
      durationDays: WEEKS * 7,
      startDate: d(START),
      endDate: new Date(d(START).getTime() + (WEEKS * 7 - 1) * 86_400_000),
    },
  });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "BUYAT uji", slug: `buyat-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  await db.rabNode.createMany({
    data: KATEGORI.map((k, i) => ({
      revisionId: rev.id,
      kind: "kategori" as const,
      code: k.code,
      name: k.name,
      amount: k.amount,
      lineageKey: k.key,
      sortOrder: i,
    })),
  });
  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "manual", status: "aktif", rabRevisionId: rev.id, contractDays: WEEKS * 7 },
  });
  let kum = 0;
  await db.baselinePoint.createMany({
    data: Array.from({ length: WEEKS }, (_, i) => {
      kum += JADWAL.reduce((s, j) => s + j.weekly[i], 0);
      return { baselineId: baseline.id, weekNumber: i + 1, plannedPct: kum };
    }),
  });
  await db.baselineScheduleItem.createMany({
    data: JADWAL.map((j) => ({
      baselineId: baseline.id,
      lineageKey: j.key,
      name: j.name,
      weightPct: j.weekly.reduce((s, v) => s + v, 0),
      weekly: j.weekly,
    })),
  });
});

afterAll(async () => {
  await db.baselinePoint.deleteMany({ where: { baseline: { locationId } } });
  await db.baselineScheduleItem.deleteMany({ where: { baseline: { locationId } } });
  await db.baseline.deleteMany({ where: { locationId } });
  await db.rabNode.deleteMany({ where: { revision: { locationId } } });
  await db.rabRevision.deleteMany({ where: { locationId } });
  await db.location.deleteMany({ where: { id: locationId } });
  await db.contract.deleteMany({ where: { package: { orgId } } });
  await db.package.deleteMany({ where: { orgId } });
  await db.vendor.deleteMany({ where: { orgId } });
});

describe("lembar kurva-S laporan mingguan", () => {
  it("baris kategori bayangan berbobot 0 tidak dicetak; angka rencana tidak berubah", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 2);
    expect(r).not.toBeNull();
    expect(r!.kurvaSchedule.map((k) => k.lineageKey)).toEqual(["I", "III", "IV", "XII#2"]);
    const total = r!.kurvaSchedule.reduce((s, k) => s + k.weekly.reduce((a, v) => a + v, 0), 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("ketidakcocokan dengan RAB aktif dilaporkan: Tambatan berbobot tanpa RAB, Genset di RAB tanpa jadwal", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 2);
    expect(r!.kurvaTakSesuai).toEqual({
      tanpaRab: [{ name: "PEKERJAAN TAMBATAN PERAHU", bobot: 30 }],
      tanpaJadwal: [{ code: "XII", name: "PEKERJAAN BANGUNAN GENSET", bobotRab: 20 }],
    });
  });
});
