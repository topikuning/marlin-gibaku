// LAPORAN PERIODIK KKP — dua cacat yang membuat satu halaman menyebut dua angka.
//
// 1. weekMode TIDAK diteruskan ke `currentWeekNumber` (audit 2026-09-15, B-3/G-4).
//    Pada kontrak `senin_minggu` dengan SPMK bukan-Senin, minggu berjalan
//    terhitung SATU LEBIH KECIL selama tiga hari dari tujuh. `cutoffWeek` lalu
//    memotong terlalu awal: garis realisasi & kolom deviasi minggu itu kosong,
//    sementara tabel item di halaman yang sama sudah terisi.
//
// 2. Identitas kategori dipotong `split("#")[0]` (audit 2026-09-15, D-2/G-5).
//    "VI#2" adalah kategori romawi VI yang KEDUA — nyata di data HPS. Memotong
//    di "#" pertama melebur keduanya, jadi realisasi kategori kedua masuk ke
//    subtotal kategori pertama.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `pw${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

// SPMK KAMIS. Di mode senin_minggu, M1 = Kamis–Minggu (pendek), M2 = Senin dst.
const START = "2026-09-10"; // Kamis
const WEEKS = 8;
let locationId = "";
let userId = "";

/**
 * RAB dengan DUA kategori berkode romawi sama — bentuk yang membuat lineageKey
 * bersufiks ("VI" dan "VI#2"), persis seperti hasil `flattenParsedRab`.
 */
const ITEMS = [
  { cat: "VI", code: "1", name: "Galian", vol: 100, price: 1_000, lineage: "VI#1" },
  { cat: "VI#2", code: "1", name: "Beton", vol: 100, price: 3_000, lineage: "VI#2#1" },
];
const CAT_TOTAL: Record<string, bigint> = { VI: 100_000n, "VI#2": 300_000n };
const GRAND = 400_000n;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: GRAND, signedDate: d(START), durationDays: WEEKS * 7,
      startDate: d(START), endDate: d("2026-11-04"),
      // Inilah yang membuat cacat pertama terlihat.
      weekMode: "senin_minggu",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi Uji", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov",
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: GRAND },
  });
  let sort = 0;
  for (const key of ["VI", "VI#2"]) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id, kind: "kategori", code: "VI", name: `PEKERJAAN ${key}`,
        amount: CAT_TOTAL[key], lineageKey: key, sortOrder: sort++,
      },
    });
  }
  for (const it of ITEMS) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id, kind: "item", code: it.code, name: it.name,
        volume: it.vol, unit: "m3", unitPrice: it.price,
        amount: BigInt(it.vol * it.price), lineageKey: it.lineage, sortOrder: sort++,
      },
    });
  }

  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: WEEKS * 7 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: WEEKS }, (_, i) => ({
      baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / WEEKS) * 100,
    })),
  });

  // Laporan pada SENIN 2026-09-14 — minggu ke-2 menurut grid senin_minggu.
  const report = await db.dailyReport.create({
    data: { locationId, reportDate: d("2026-09-14"), status: "final", createdById: userId, weather: "cerah" },
  });
  const nodes = await db.rabNode.findMany({ where: { revisionId: rev.id, kind: "item" }, select: { id: true, lineageKey: true } });
  for (const n of nodes) {
    const it = ITEMS.find((x) => x.lineage === n.lineageKey)!;
    await db.dailyReportItem.create({
      data: {
        reportId: report.id, rabNodeId: n.id, lineageKey: n.lineageKey,
        volumeDone: 50, valueDone: BigInt(50 * it.price),
      },
    });
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_report_status_history, daily_reports, baseline_points,
     baselines, rab_nodes, rab_revisions, contracts, locations, packages, vendors, users, organizations
     RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("kontrak senin_minggu dengan SPMK bukan-Senin", () => {
  it("minggu berjalan memakai grid kontrak, bukan hitungan tujuh-hari", async () => {
    /*
     * "Hari ini" dibekukan ke Senin 2026-09-14 — hari pertama minggu kalender
     * ke-2. Dengan grid senin_minggu itu minggu ke-2; dengan hitungan tujuh-hari
     * dari SPMK Kamis baru hari ke-5, jadi minggu ke-1.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T09:00:00+07:00"));
    try {
      const rep = await getPeriodReport(locationId, "mingguan", 2);
      expect(rep.scurve.currentWeek).toBe(2);
      // Realisasi minggu ke-2 TERISI – bukan null seperti sebelumnya.
      expect(rep.scurve.actualPct[1]).not.toBeNull();
      // Dan angkanya sepakat dengan tabel di halaman yang sama.
      expect(rep.scurve.actualPct[1]).toBeCloseTo(rep.totals.bobotSd, 6);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dua kategori berkode romawi sama", () => {
  it("realisasi kategori KEDUA tidak dilebur ke kategori pertama", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T09:00:00+07:00"));
    try {
      const rep = await getPeriodReport(locationId, "mingguan", 2);
      const kunci = rep.categories.map((c) => c.lineageKey);
      expect(kunci).toContain("VI");
      expect(kunci).toContain("VI#2");

      const pertama = rep.categories.find((c) => c.lineageKey === "VI")!;
      const kedua = rep.categories.find((c) => c.lineageKey === "VI#2")!;
      // Satu item di masing-masing kategori – bukan dua di kategori pertama.
      expect(pertama.rows).toHaveLength(1);
      expect(kedua.rows).toHaveLength(1);
      expect(pertama.rows[0].name).toBe("Galian");
      expect(kedua.rows[0].name).toBe("Beton");
      // Subtotal bobot mengikuti nilai kategorinya masing-masing (25% : 75%).
      expect(pertama.subtotalBobot).toBeCloseTo(25, 6);
      expect(kedua.subtotalBobot).toBeCloseTo(75, 6);
    } finally {
      vi.useRealTimers();
    }
  });
});
