// BLANKO FINAL LAMA HARUS TETAP MENYEBUT PERIODENYA SENDIRI (DECISIONS 430).
//
// Bug yang ditutup: snapshot yang dibekukan SEBELUM 427c hanya menyimpan NOMOR
// minggu — rentang tanggalnya diturunkan saat cetak. Nomor itu dulu dihitung
// dengan rumus 7-hari yang ditulis langsung (`floor((tgl − SPMK)/7)+1`), apa
// pun mode kontraknya. Begitu DECISIONS 429 mengubah mode kontrak menjadi
// senin_minggu, derivasi memakai mode BARU sementara nomornya beku dari era
// 7-hari, sehingga blanko menyebut periode yang TIDAK MEMUAT tanggal
// laporannya sendiri.
//
// SPMK Kamis 5 Mar 2026, laporan 11 Mar (Rabu):
//   era 7-hari  → minggu 1 = 5–11 Mar  ← memuat 11 Mar (benar)
//   senin_minggu→ minggu 1 = 5–8 Mar   ← TIDAK memuat 11 Mar (bug)
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { backfillPeriodeSnapshotLama } = await import("@/lib/migrasi/snapshot-periode-backfill");
const { getKkpDailyData } = await import("@/lib/daily-report/queries");

const suffix = `spb${Date.now().toString(36)}`;
let reportLamaId: string;
let reportBaruId: string;
let slugPenyaji: string;

const SPMK = new Date("2026-03-05T00:00:00.000Z"); // Kamis
const TGL_LAPORAN = new Date("2026-03-11T00:00:00.000Z"); // Rabu, minggu 1 versi 7-hari

/** Snapshot minimal — hanya bagian yang disentuh migrasi ini yang penting. */
function snapshot(weekNo: number | null, beku?: { start: string; end: string }) {
  return {
    version: 1,
    generatedAt: "2026-03-11T10:00:00.000Z",
    reportDate: "2026-03-11",
    location: { name: "Lok", slug: `lok-${suffix}`, village: "V", regency: "R", province: "P" },
    weekNo,
    ...(beku ? { periodStartKey: beku.start, periodEndKey: beku.end } : {}),
    tahunAnggaran: 2026,
    weather: null,
    weatherHourly: null,
    workStart: null,
    workEnd: null,
    notes: null,
    items: [],
    totalValueToday: "0",
    progress: { grandTotal: "0", realizedValue: "0", realizedPct: 0, planPct: 12.5, deviationPct: -1.5 },
    workers: [],
    totalWorkers: 0,
    materials: [],
    equipment: [],
    photos: [],
  };
}

beforeAll(async () => {
  await db.appSetting.deleteMany({ where: { key: "migrasi.snapshot_periode_backfill" } });

  const org = await db.organization.create({ data: { name: `Org SPB ${suffix}`, slug: `org-${suffix}` } });
  const admin = await db.user.create({
    data: {
      orgId: org.id,
      username: `admin-${suffix}`,
      fullName: "Admin SPB",
      role: "super_admin",
      passwordHash: "x",
    },
    select: { id: true },
  });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket SPB ${suffix}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV SPB ${suffix}` }, select: { id: true } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000_000n,
      ppnPercent: 11,
      signedDate: SPMK,
      durationDays: 119,
      startDate: SPMK,
      endDate: new Date(SPMK.getTime() + 118 * 86_400_000),
      // Kontrak SUDAH dikonversi ke default baru — persis keadaan setelah 429.
      weekMode: "senin_minggu",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lok ${suffix}`,
      slug: `lok-${suffix}`,
      village: "V",
      regency: "R",
      province: "P",
      isActive: true,
    },
    select: { id: true },
  });

  // (a) Snapshot LAMA: nomor minggu beku era 7-hari, tanpa rentang.
  const lama = await db.dailyReport.create({
    data: {
      locationId: loc.id,
      reportDate: TGL_LAPORAN,
      status: "final",
      createdById: admin.id,
      finalSnapshot: snapshot(1) as never,
    },
    select: { id: true },
  });
  reportLamaId = lama.id;

  // (b) Snapshot BARU (pasca-427c): rentang sudah beku — tidak boleh disentuh.
  const loc2 = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lok2 ${suffix}`,
      slug: `lok2-${suffix}`,
      village: "V",
      regency: "R",
      province: "P",
      isActive: true,
    },
    select: { id: true },
  });
  const baru = await db.dailyReport.create({
    data: {
      locationId: loc2.id,
      reportDate: TGL_LAPORAN,
      status: "final",
      createdById: admin.id,
      finalSnapshot: snapshot(2, { start: "2026-03-09", end: "2026-03-15" }) as never,
    },
    select: { id: true },
  });
  reportBaruId = baru.id;

  // (c) Lokasi untuk uji penyaji — laporannya dibuat setelah backfill jalan.
  slugPenyaji = `lok3-${suffix}`;
  await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lok3 ${suffix}`,
      slug: slugPenyaji,
      village: "V",
      regency: "R",
      province: "P",
      isActive: true,
    },
  });
});

describe("backfillPeriodeSnapshotLama", () => {
  it("membekukan rentang 7-hari yang MEMUAT tanggal laporan, tanpa mengubah angka", async () => {
    const r = await backfillPeriodeSnapshotLama();
    expect(r.status).toBe("selesai");
    expect(r.diisi).toBeGreaterThanOrEqual(1);

    const row = await db.dailyReport.findUnique({
      where: { id: reportLamaId },
      select: { finalSnapshot: true },
    });
    const snap = row!.finalSnapshot as unknown as Record<string, unknown>;
    // Rentang 7-hari: 5–11 Mar. Bukan 5–8 Mar (senin_minggu) yang tidak memuat 11 Mar.
    expect(snap.periodStartKey).toBe("2026-03-05");
    expect(snap.periodEndKey).toBe("2026-03-11");
    // Nomor minggu & angka dokumen TIDAK berubah — blanko sudah diteken.
    expect(snap.weekNo).toBe(1);
    const progress = snap.progress as Record<string, number>;
    expect(progress.planPct).toBe(12.5);
    expect(progress.deviationPct).toBe(-1.5);
  });

  it("snapshot yang rentangnya sudah beku tidak disentuh", async () => {
    const row = await db.dailyReport.findUnique({
      where: { id: reportBaruId },
      select: { finalSnapshot: true },
    });
    const snap = row!.finalSnapshot as unknown as Record<string, unknown>;
    expect(snap.periodStartKey).toBe("2026-03-09");
    expect(snap.periodEndKey).toBe("2026-03-15");
    expect(snap.weekNo).toBe(2);
  });

  it("jalan kedua = no-op (penanda menang)", async () => {
    const r = await backfillPeriodeSnapshotLama();
    expect(r.status).toBe("sudah");
    expect(r.diisi).toBe(0);
  });
});

describe("penyaji cetak – jaring pengaman untuk snapshot lama yang belum ter-backfill", () => {
  it("menurunkan rentang dengan mode 7-hari, bukan mode kontrak sekarang", async () => {
    // Dibuat SETELAH backfill (penanda sudah ada) → sengaja tidak tersentuh,
    // meniru snapshot yang lolos: data dipulihkan dari cadangan, laporan
    // organisasi baru, atau boot yang belum sempat menuntaskan backfill.
    const loc = await db.location.findUnique({ where: { slug: slugPenyaji }, select: { id: true } });
    const admin = await db.user.findFirst({ where: { username: `admin-${suffix}` }, select: { id: true } });
    await db.dailyReport.create({
      data: {
        locationId: loc!.id,
        reportDate: TGL_LAPORAN,
        status: "final",
        createdById: admin!.id,
        finalSnapshot: snapshot(1) as never,
      },
    });

    const data = await getKkpDailyData(slugPenyaji, "2026-03-11");
    expect(data).toBeTruthy();
    expect(data!.weekNo).toBe(1);
    // 11 Maret 2026 HARUS berada di dalam periode yang dicetak. Mode kontrak
    // kini senin_minggu (minggu 1 = 5–8 Mar) — memakainya di sini membuat
    // blanko menyebut periode yang tidak memuat tanggalnya sendiri.
    expect(data!.periodStart).toBe("5 Maret 2026");
    expect(data!.periodEnd).toBe("11 Maret 2026");
  });
});
