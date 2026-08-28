// "PROGRESS KEMARIN" DAN "TOTAL PROGRESS MINGGUAN" HARUS BERBEDA (DECISIONS 458).
//
// Keluhan user 2026-08-28, dengan tangkapan layar WhatsApp. Dua pertanyaan:
//
//   "progres kemantren kemarin"      → realisasi 7,19% · rencana 5,06% · +2,13%
//   "laporan mingguan di kemantren"  → realisasi 7,19% · rencana 5,06% · +2,13%
//
// *"progress kemarin dan total progress mingguan tidak bisa dibedakan."*
//
// Balasannya tidak salah — ia cuma tidak menjawab. `realizedPct` SELALU
// kumulatif s/d tanggal yang ditanya, jadi selama tidak ada laporan baru di
// antara kedua tanggal itu angkanya memang identik, dan tidak ada satu kata pun
// yang mengaku bahwa itu angka kumulatif.
//
// Uji ini menirukan keadaan itu SEPERSIS mungkin terhadap basis data
// sungguhan: kumulatifnya memang sama di kedua jawaban (dan itu benar), tetapi
// tambahannya berbeda — nol pada hari yang ditanya, lima poin persen sepanjang
// pekan. Tanpa `getLocationsProgressRentang`, angka pembeda itu tidak ada sama
// sekali.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { dataProgress, dataMingguan } = await import("@/lib/waha/tanya-data");
const { getLocationsProgressRentang } = await import("@/lib/progress");
const { parseDateKey } = await import("@/lib/format");
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

const suffix = `pvm${Date.now().toString(36)}`;
let locId = "";
let katalog: LokasiKatalog[] = [];

const MULAI = "2026-06-01";
/** Pekan yang ditanya: Senin 24 s/d Jumat 28 Agustus 2026. */
const PEKAN_MULAI = "2026-08-24";
const PEKAN_AKHIR = "2026-08-28";
/** "kemarin" pada tangkapan layar — hari yang TIDAK ada laporannya. */
const KEMARIN = "2026-08-27";

const KURVA = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org PVM ${suffix}`, slug: `org-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket PVM ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Kemantren ${suffix}`,
      slug: `kemantren-${suffix}`,
      village: "Kemantren",
      regency: "Tegal",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true, name: true },
  });
  locId = loc.id;
  katalog = [
    {
      id: locId,
      nama: loc.name,
      desa: "Kemantren",
      kecamatan: null,
      kabupaten: "Tegal",
      provinsi: "Jawa Tengah",
    },
  ];

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV PVM ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 100_000_000n,
      ppnPercent: 11,
      signedDate: parseDateKey("2026-05-20")!,
      durationDays: 140,
      startDate: parseDateKey(MULAI)!,
      endDate: parseDateKey("2026-10-19")!,
    },
  });

  // RAB 100 juta, volume 100 → 1 m³ = 1%. Angka bulat supaya kegagalan uji
  // terbaca langsung tanpa menghitung apa pun sendiri.
  const rab = await db.rabRevision.create({
    data: { locationId: locId, revisionNo: 1, status: "aktif", source: "hps_awal", totalValue: 0n },
    select: { id: true },
  });
  const kategori = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      kind: "kategori",
      lineageKey: `kat-${suffix}`,
      code: "1",
      name: "Pekerjaan Persiapan",
      sortOrder: 1,
      amount: 100_000_000n,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rab.id,
      parentId: kategori.id,
      kind: "item",
      lineageKey: `itm-${suffix}`,
      code: "1.1",
      name: "Galian tanah",
      sortOrder: 2,
      unit: "m3",
      volume: 100,
      unitPrice: 1_000_000,
      amount: 100_000_000n,
    },
    select: { id: true },
  });

  const baseline = await db.baseline.create({
    data: { locationId: locId, baselineNo: 1, source: "auto", status: "aktif", contractDays: 140 },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: KURVA.map((p, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: p })),
  });

  const pelapor = await db.user.create({
    data: {
      orgId: org.id,
      username: `sm-${suffix}`,
      fullName: "SM PVM",
      role: "site_manager",
      passwordHash: "x",
    },
    select: { id: true },
  });

  const buatLaporan = async (dateKey: string, volume: number) => {
    const lap = await db.dailyReport.create({
      data: {
        locationId: locId,
        reportDate: parseDateKey(dateKey)!,
        status: "dikirim",
        createdById: pelapor.id,
      },
      select: { id: true },
    });
    await db.dailyReportItem.create({
      data: {
        reportId: lap.id,
        rabNodeId: item.id,
        lineageKey: `itm-${suffix}`,
        basis: "aktif",
        volumeDone: volume,
        valueDone: BigInt(volume) * 1_000_000n,
      },
    });
  };

  /*
   * Bentuk datanya yang membuat uji ini berarti:
   *
   *   10 Agu  +7   → di LUAR pekan yang ditanya
   *   24 Agu  +2   ┐ di dalam pekan
   *   26 Agu  +3   ┘
   *   27 Agu   –   ← hari yang ditanya "kemarin": TIDAK ada laporan
   *
   * Kumulatif s/d 27 Agu = 12%, kumulatif s/d 28 Agu = 12% — sama persis,
   * persis seperti tangkapan layar. Tambahannya: 0 pada 27 Agu, 5 sepanjang
   * pekan. Angka 7 di awal ada supaya kumulatif (12) tidak kebetulan sama
   * dengan tambahan pekan (5); tanpa itu uji ini bisa hijau karena kebetulan.
   */
  await buatLaporan("2026-08-10", 7);
  await buatLaporan(PEKAN_MULAI, 2);
  await buatLaporan("2026-08-26", 3);
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_reports, baseline_points, baselines, rab_nodes, rab_revisions, contracts, vendors, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("lapisan hitung", () => {
  it("tambahan satu hari dihitung terhadap sehari SEBELUMNYA", async () => {
    const d = parseDateKey("2026-08-26")!;
    const r = await getLocationsProgressRentang([locId], d, d);
    expect(r.get(locId)?.tambahanPct).toBeCloseTo(3, 6);
    // Kumulatifnya tetap kumulatif — 7 + 2 + 3.
    expect(r.get(locId)?.kumulatif.realizedPct).toBeCloseTo(12, 6);
  });

  it("hari tanpa laporan bertambah NOL, bukan kosong", async () => {
    const d = parseDateKey(KEMARIN)!;
    const r = await getLocationsProgressRentang([locId], d, d);
    expect(r.get(locId)?.tambahanPct).toBeCloseTo(0, 6);
  });

  it("tambahan sepekan menghitung SELURUH laporan di dalam pekan itu", async () => {
    const r = await getLocationsProgressRentang(
      [locId],
      parseDateKey(PEKAN_MULAI)!,
      parseDateKey(PEKAN_AKHIR)!,
    );
    // 2 + 3, dan BUKAN 12: laporan 10 Agustus ada di luar pekan.
    expect(r.get(locId)?.tambahanPct).toBeCloseTo(5, 6);
  });

  it("hari pertama rentang IKUT terhitung", async () => {
    // Memakai `sejak` sebagai batas "sebelumnya" akan menelan laporan hari
    // pertama — 5 akan menyusut jadi 3 tanpa satu pun tanda.
    const r = await getLocationsProgressRentang(
      [locId],
      parseDateKey(PEKAN_MULAI)!,
      parseDateKey(PEKAN_MULAI)!,
    );
    expect(r.get(locId)?.tambahanPct).toBeCloseTo(2, 6);
  });
});

describe("REGRESI: balasan WhatsApp", () => {
  it("kumulatifnya memang sama – dan itu benar", async () => {
    const harian = await dataProgress(katalog, KEMARIN);
    const pekan = await dataMingguan(katalog, PEKAN_MULAI, PEKAN_AKHIR);
    // Inilah yang membuat keluhannya sah: dua pertanyaan, satu angka.
    expect(harian.baris[0].realisasiPct).toBeCloseTo(pekan.baris[0].realisasiPct, 6);
  });

  it("tetapi tambahannya BERBEDA, dan itu yang menjawab pertanyaannya", async () => {
    const harian = await dataProgress(katalog, KEMARIN);
    const pekan = await dataMingguan(katalog, PEKAN_MULAI, PEKAN_AKHIR);
    expect(harian.baris[0].tambahanPct).toBeCloseTo(0, 6);
    expect(pekan.baris[0].tambahanPct).toBeCloseTo(5, 6);
  });
});
