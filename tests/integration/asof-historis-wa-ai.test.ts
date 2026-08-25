// PROGRESS HISTORIS: WhatsApp dan AI Hub tidak boleh mencampur dua waktu.
//
// Temuan audit user 2026-08-19 (DECISIONS 369). Tiga tempat menerima periode,
// memakainya untuk sebagian data, lalu mengambil angka progress TANPA `asOf` —
// yaitu posisi hari ini:
//
//   - `dataProgress(lokasi, dateKey)` di src/lib/waha/tanya-data.ts
//   - `dataDeviasi(lokasi)` — bahkan tidak menerima tanggal sama sekali
//   - `buildPortfolioPulse(user, ids, startKey, endKey)` di src/lib/ai-hub/source.ts
//
// Cacatnya SENYAP dan itu yang membuatnya berbahaya: tidak ada galat, tidak ada
// kolom kosong. Satu balasan berjudul "minggu lalu" memuat status laporan
// minggu lalu berdampingan dengan realisasi hari ini, dan penerimanya tidak
// punya cara mengetahui bahwa dua angka itu dari dua waktu berbeda.
//
// Jalurnya sendiri sudah ada sejak DECISIONS 275 — `getLocationsProgress`
// menerima `asOf`. Yang kurang hanya meneruskan tanggalnya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { dataProgress, dataDeviasi } = await import("@/lib/waha/tanya-data");
const { buildPortfolioPulse } = await import("@/lib/ai-hub/source");
const { parseDateKey, jakartaDateKey, jakartaToday } = await import("@/lib/format");
import type { SessionUser } from "@/lib/auth/session";
import type { LokasiKatalog } from "@/lib/waha/tanya-niat";

const suffix = `hst${Date.now().toString(36)}`;
let orgId = "";
let locId = "";
let user: SessionUser;
let katalog: LokasiKatalog[];

/**
 * Kontrak mulai 1 Juni 2026, 140 hari. Dua tanggal pemeriksaan sengaja jatuh di
 * minggu yang jauh berbeda supaya rencana kurva-S-nya juga berbeda jelas —
 * kalau keduanya di minggu yang sama, uji ini bisa hijau tanpa `asOf` bekerja.
 */
const MULAI = "2026-06-01";
/** Minggu ke-3. Sudah ada laporan A, belum ada laporan B. */
const TANGGAL_LAMPAU = "2026-06-15";
/** Minggu ke-11. Kedua laporan sudah masuk. */
const TANGGAL_KEMUDIAN = "2026-08-15";

/** Rencana kumulatif minggu 1..20 — naik tajam, jadi minggu 3 ≠ minggu 11. */
const KURVA = [3, 7, 12, 18, 25, 33, 41, 49, 57, 64, 71, 77, 83, 88, 92, 95, 97, 98, 99, 100];

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org HST ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;

  const pkg = await db.package.create({
    data: { orgId, name: `Paket HST ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Sidorejo ${suffix}`,
      slug: `sidorejo-${suffix}`,
      village: "Sidorejo",
      regency: "Kebumen",
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
      desa: "Sidorejo",
      kecamatan: null,
      kabupaten: "Kebumen",
      provinsi: "Jawa Tengah",
    },
  ];

  const vendor = await db.vendor.create({
    data: { orgId, name: `CV HST ${suffix}` },
    select: { id: true },
  });
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

  // RAB aktif: total 100 juta, jadi 10 juta = 10% — angka bulat memudahkan
  // membaca kegagalan uji tanpa menghitung apa pun sendiri.
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
    data: {
      locationId: locId,
      baselineNo: 1,
      source: "auto",
      status: "aktif",
      contractDays: 140,
    },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: KURVA.map((p, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: p })),
  });

  const pelapor = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      email: `sm-${suffix}@contoh.id`,
      fullName: "SM HST",
      role: "site_manager",
      passwordHash: "x",
    },
    select: { id: true, orgId: true, fullName: true, username: true, email: true, role: true },
  });
  user = { ...pelapor, mustChangePassword: false };

  /** Dua laporan pada dua waktu — inilah yang membuat `asOf` bisa dibedakan. */
  const buatLaporan = async (dateKey: string, nilai: bigint, volume: number) => {
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
        valueDone: nilai,
      },
    });
  };
  await buatLaporan("2026-06-10", 10_000_000n, 10); // 10%
  await buatLaporan("2026-08-10", 40_000_000n, 40); // kumulatif 50%
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE daily_report_items, daily_reports, baseline_points, baselines, rab_nodes, rab_revisions, contracts, vendors, locations, packages, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("Tanya WhatsApp – progress historis", () => {
  it("progress tanggal lampau BERBEDA dari progress hari ini", async () => {
    const lampau = await dataProgress(katalog, TANGGAL_LAMPAU);
    const kemudian = await dataProgress(katalog, TANGGAL_KEMUDIAN);

    expect(lampau.baris[0].realisasiPct).not.toBeCloseTo(kemudian.baris[0].realisasiPct, 3);
  });

  it("dataProgress benar-benar memakai asOf: laporan sesudah tanggal itu TIDAK ikut", async () => {
    /*
     * Angka pastinya, bukan sekadar "berbeda". Uji yang cuma membandingkan dua
     * hasil bisa hijau karena sebab lain (mis. rencana berubah) sementara
     * realisasinya tetap salah — dan realisasi itulah inti keluhannya.
     */
    const lampau = await dataProgress(katalog, TANGGAL_LAMPAU);
    expect(lampau.baris[0].realisasiPct).toBeCloseTo(10, 3);

    const kemudian = await dataProgress(katalog, TANGGAL_KEMUDIAN);
    expect(kemudian.baris[0].realisasiPct).toBeCloseTo(50, 3);
  });

  it("rencana kurva-S ikut bergerak: minggu ke-3 bukan minggu ke-11", async () => {
    // Kalau `asOf` hanya menyaring laporan tapi tidak menggeser minggu, deviasi
    // lampau tetap diukur terhadap rencana hari ini — separuh cacat yang sama.
    const lampau = await dataProgress(katalog, TANGGAL_LAMPAU);
    const kemudian = await dataProgress(katalog, TANGGAL_KEMUDIAN);
    expect(lampau.baris[0].rencanaPct).toBeCloseTo(12, 3); // minggu 3
    expect(kemudian.baris[0].rencanaPct).toBeCloseTo(71, 3); // minggu 11
  });

  it("dataDeviasi memakai asOf yang SAMA dengan dataProgress", async () => {
    /*
     * Dua fungsi ini menjawab pertanyaan yang bersebelahan di layar yang sama.
     * Kalau salah satunya diam-diam memakai hari ini, penanya melihat dua
     * angka yang tidak bisa dijumlahkan menjadi cerita yang masuk akal.
     */
    const p = await dataProgress(katalog, TANGGAL_LAMPAU);
    const d = await dataDeviasi(katalog, TANGGAL_LAMPAU);

    expect(d.negatif).toHaveLength(1);
    expect(d.negatif[0].realisasiPct).toBeCloseTo(p.baris[0].realisasiPct, 3);
    expect(d.negatif[0].rencanaPct).toBeCloseTo(p.baris[0].rencanaPct, 3);
    expect(d.negatif[0].deviasiPct).toBeCloseTo(p.baris[0].deviasiPct, 3);
  });

  it("deviasi lampau berbeda dari deviasi kemudian", async () => {
    const lampau = await dataDeviasi(katalog, TANGGAL_LAMPAU);
    const kemudian = await dataDeviasi(katalog, TANGGAL_KEMUDIAN);
    // −2 pp (10 vs 12) di minggu 3, −21 pp (50 vs 71) di minggu 11.
    expect(lampau.negatif[0].deviasiPct).toBeCloseTo(-2, 3);
    expect(kemudian.negatif[0].deviasiPct).toBeCloseTo(-21, 3);
  });
});

describe("AI Hub – buildPortfolioPulse", () => {
  it("periode lampau memakai progress akhir periode, bukan hari ini", async () => {
    const lampau = await buildPortfolioPulse(user, [locId], "2026-06-01", TANGGAL_LAMPAU);
    const kemudian = await buildPortfolioPulse(user, [locId], "2026-06-01", TANGGAL_KEMUDIAN);

    expect(lampau.rows[0].actualPct).toBeCloseTo(10, 3);
    expect(kemudian.rows[0].actualPct).toBeCloseTo(50, 3);
    expect(lampau.rows[0].planPct).toBeCloseTo(12, 3);
    expect(kemudian.rows[0].planPct).toBeCloseTo(71, 3);
  });

  it("sourceRef progress menyebut TANGGAL-nya, supaya angka lampau tidak terbaca sebagai terkini", async () => {
    const lampau = await buildPortfolioPulse(user, [locId], "2026-06-01", TANGGAL_LAMPAU);
    const ref = lampau.sourceRefs.find((r) => r.id.endsWith(":progress"));
    expect(ref).toBeDefined();
    expect(ref!.label).toContain(TANGGAL_LAMPAU);
    // Dan nilainya memang angka periode itu, bukan angka hari ini.
    expect(ref!.value).toContain("10.0%");
  });

  it("periode yang ujungnya di MASA DEPAN dijepit ke hari ini", async () => {
    /*
     * "bulan ini" berakhir di masa depan. Tanpa penjepitan, minggu rencana
     * melompat ke minggu yang belum terjadi dan deviasinya mengukur
     * keterlambatan terhadap masa depan — angka yang selalu memburuk sendiri
     * tanpa ada yang salah di lapangan.
     */
    const hariIni = jakartaDateKey(jakartaToday());
    const jauhDiDepan = await buildPortfolioPulse(user, [locId], "2026-06-01", "2027-12-31");
    const sampaiHariIni = await buildPortfolioPulse(user, [locId], "2026-06-01", hariIni);

    expect(jauhDiDepan.rows[0].planPct).toBeCloseTo(
      sampaiHariIni.rows[0].planPct,
      3,
    );
  });
});
