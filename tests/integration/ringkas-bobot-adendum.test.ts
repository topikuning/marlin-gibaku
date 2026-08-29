// BOBOT HARIAN SESUDAH ADENDUM — PEMBILANG DAN PENYEBUT DARI REVISI YANG SAMA.
//
// Cacat ini sudah tiga kali disentuh dan dua kali lolos, selalu dengan pembuktian
// manual di atas fixture yang TIDAK punya adendum — dan tanpa adendum ketiga
// rumusnya memang menghasilkan angka yang sama persis. Itu sebabnya kesalahannya
// tak pernah terlihat:
//
//   1. `valueDone / grandTotal` — harga beku saat laporan ditulis;
//   2. `volume × amount` dari `item.rabNode` — node yang MENEMPEL di laporan,
//      milik revisi yang aktif saat itu, sementara `grandTotal` datang dari
//      revisi aktif SEKARANG. Cacatnya tidak hilang, hanya pindah dari harga
//      ke node, dan komentarnya bahkan mengklaim "revisi aktif";
//   3. node dicocokkan lewat `lineageKey` ke revisi berstatus aktif — benar.
//
// Uji ini memasang adendum harga sungguhan (revisi 1 digantikan revisi 2), satu-
// satunya keadaan yang bisa membedakan ketiganya. Basis nomor 2 menghasilkan
// 13,7931%; yang benar 16,5517%.
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getRingkasHarian } = await import("@/lib/daily-report/ringkas");
const { parseDateKey } = await import("@/lib/format");

const suffix = `bad${Date.now().toString(36)}`;
const slug = `adendum-${suffix}`;
const TGL = "2026-08-20";
let locationId = "";

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ${suffix}`, slug: `o-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Adendum ${suffix}`,
      slug,
      village: "Adendum",
      regency: "Tegal",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `u-${suffix}`,
      fullName: "Pelapor",
      passwordHash: "x",
      role: "site_manager",
    },
    select: { id: true },
  });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 125_000_000n,
      ppnPercent: 11,
      signedDate: parseDateKey("2026-08-01")!,
      durationDays: 60,
      startDate: parseDateKey("2026-08-01")!,
      endDate: parseDateKey("2026-09-29")!,
    },
  });

  // REVISI 1 (nanti digantikan): item A senilai 100 jt dari grand total 125 jt.
  const buatRevisi = async (revisionNo: number, amountItem: bigint, total: bigint) => {
    const rev = await db.rabRevision.create({
      data: {
        locationId,
        revisionNo,
        status: "aktif",
        source: "hps_awal",
        totalValue: total,
      },
      select: { id: true },
    });
    const kat = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "kategori",
        lineageKey: `kat-${suffix}`,
        code: "1",
        name: "Pekerjaan Utama",
        sortOrder: 1,
        amount: total,
      },
      select: { id: true },
    });
    const item = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        lineageKey: `itm-${suffix}`,
        code: "1.1",
        name: "Pasangan batu",
        sortOrder: 2,
        unit: "m3",
        volume: 100,
        unitPrice: Number(amountItem) / 100,
        amount: amountItem,
      },
      select: { id: true },
    });
    // Sisa nilai kategori ditaruh di item pelengkap supaya grand total pas.
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        lineageKey: `itm2-${suffix}`,
        code: "1.2",
        name: "Pekerjaan lain",
        sortOrder: 3,
        unit: "ls",
        volume: 1,
        unitPrice: Number(total - amountItem),
        amount: total - amountItem,
      },
    });
    return { revId: rev.id, itemId: item.id };
  };

  const rev1 = await buatRevisi(1, 100_000_000n, 125_000_000n);

  const report = await db.dailyReport.create({
    data: {
      locationId,
      reportDate: parseDateKey(TGL)!,
      status: "disetujui",
      createdById: u.id,
    },
    select: { id: true },
  });
  // 20 dari 100 m3 dilaporkan, memakai node REVISI 1.
  await db.dailyReportItem.create({
    data: {
      reportId: report.id,
      rabNodeId: rev1.itemId,
      lineageKey: `itm-${suffix}`,
      basis: "aktif",
      volumeDone: 20,
      valueDone: 20_000_000n,
      reportedById: u.id,
    },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_reports, rab_nodes, rab_revisions, contracts, vendors, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("bobot harian sesudah adendum harga", () => {
  it("sebelum adendum: 20% × 80% = 16,00%", async () => {
    const d = await getRingkasHarian(slug, TGL);
    expect(d!.pekerjaan[0].bobotToday).toBeCloseTo(16, 2);
    expect(d!.bobotHariIni).toBeCloseTo(16, 2);
  });

  it("sesudah adendum +20% harga: memakai amount REVISI AKTIF, bukan node laporan", async () => {
    // Revisi 1 digantikan; revisi 2 menaikkan item jadi 120 jt, total 145 jt.
    await db.rabRevision.updateMany({
      where: { locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    const rev = await db.rabRevision.create({
      data: { locationId, revisionNo: 2, status: "aktif", source: "adendum", totalValue: 145_000_000n },
      select: { id: true },
    });
    const kat = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "kategori",
        lineageKey: `kat-${suffix}`,
        code: "1",
        name: "Pekerjaan Utama",
        sortOrder: 1,
        amount: 145_000_000n,
      },
      select: { id: true },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        lineageKey: `itm-${suffix}`,
        code: "1.1",
        name: "Pasangan batu",
        sortOrder: 2,
        unit: "m3",
        volume: 100,
        unitPrice: 1_200_000,
        amount: 120_000_000n,
      },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        parentId: kat.id,
        kind: "item",
        lineageKey: `itm2-${suffix}`,
        code: "1.2",
        name: "Pekerjaan lain",
        sortOrder: 3,
        unit: "ls",
        volume: 1,
        unitPrice: 25_000_000,
        amount: 25_000_000n,
      },
    });

    const d = await getRingkasHarian(slug, TGL);
    // Yang BENAR: 20/100 x (120 jt / 145 jt) = 20% x 82,7586% = 16,5517%.
    // Basis LAMA (node laporan): 20% x (100 jt / 145 jt) = 13,7931% → salah.
    expect(d!.pekerjaan[0].bobotToday).toBeCloseTo(16.5517, 3);
    expect(d!.bobotHariIni).toBeCloseTo(16.5517, 3);
  });
});
