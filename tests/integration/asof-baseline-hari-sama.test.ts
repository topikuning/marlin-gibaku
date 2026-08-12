// DASAR PERHITUNGAN = BASELINE YANG AKTIF, di layar mana pun.
//
// Laporan user 2026-08-06: workspace lokasi menulis Rencana 1,7% / Deviasi
// +2,7%, sedangkan PDF "Ringkasan Pelaksanaan Harian" tanggal SAMA menulis
// Rencana kurva-S 23,30% / Deviasi −18,91%. Realisasinya cocok (4,4% vs 4,39%),
// minggunya cocok (2 dari 20). Yang berbeda HANYA rencananya — dan hari itu
// jadwal kurva-S memang baru diubah.
//
// Sebabnya bukan dua rumus. Keduanya memanggil `getLocationProgress` yang sama.
// Yang berbeda adalah BASELINE MANA yang dianggap berlaku: layar membaca
// baseline berstatus `aktif`, sedangkan dokumen harian dulu memilih baseline
// "yang berlaku pada tanggal laporan" — dan karena tanggal kerja `@db.Date`
// tersimpan sebagai TENGAH MALAM UTC (= 07:00 WIB), jadwal yang diganti siang
// hari gugur sementara jadwal lama yang baru saja digantikan justru lolos.
//
// Keputusan user 2026-08-06 menutup soal ini di akarnya:
//
//   *"intinya kalau baseline kurva-s aktif yang mana, itu yang dipakai dasar."*
//
// Jadi pemilihan versi berdasarkan tanggal DIBUANG. `asOf` tetap berarti untuk
// hal yang memang soal waktu — laporan mana yang dihitung dan minggu ke berapa
// — tapi dasar rencananya selalu baseline aktif. DECISIONS 275.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getLocationProgress } = await import("@/lib/progress");
const { parseDateKey } = await import("@/lib/format");

const suffix = `aof${Date.now().toString(36)}`;
let orgId: string;
let locId: string;

/** Tanggal laporan = hari saat jadwal diubah. */
const HARI_INI = "2026-08-06";
/** Batas `asOf` yang dipakai kode: tengah malam UTC = 07:00 WIB. */
const ASOF = parseDateKey(HARI_INI)!;
/** Jadwal diganti SIANG hari itu — sesudah batas di atas. */
const SAAT_GANTI = new Date("2026-08-06T07:30:00.000Z"); // 14:30 WIB

/** Rencana kumulatif minggu 1..20 — dua kurva yang sangat berbeda di minggu 2. */
const KURVA_LAMA = [11.5, 23.3, 34, 44, 52, 59, 65, 70, 75, 79, 83, 86, 89, 92, 94, 96, 97, 98, 99, 100];
const KURVA_BARU = [0.8, 1.7, 3.2, 5.4, 8.5, 12.5, 17.5, 23.5, 30.5, 38, 46, 54, 62, 70, 77, 84, 89, 94, 97, 100];

async function buatBaseline(no: number, kurva: number[], createdAt: Date, supersededAt: Date | null) {
  const b = await db.baseline.create({
    data: {
      locationId: locId,
      baselineNo: no,
      source: "auto",
      status: supersededAt ? "digantikan" : "aktif",
      contractDays: 140,
      createdAt,
      supersededAt,
    },
    select: { id: true },
  });
  await db.baselinePoint.createMany({
    data: kurva.map((p, i) => ({ baselineId: b.id, weekNumber: i + 1, plannedPct: p })),
  });
  return b.id;
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ASOF ${suffix}`, slug: `org-${suffix}` },
  });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket ASOF ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Pasir ${suffix}`,
      slug: `pasir-${suffix}`,
      village: "Pasir",
      regency: "Kebumen",
      province: "Jawa Tengah",
      isActive: true,
    },
    select: { id: true },
  });
  locId = loc.id;

  const vendor = await db.vendor.create({
    data: { orgId, name: `CV Uji ${suffix}` },
    select: { id: true },
  });
  // Kontrak mulai 27 Jul 2026 → 6 Agu 2026 = hari ke-11 = minggu ke-2.
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 12_228_475_000n,
      ppnPercent: 11,
      signedDate: new Date("2026-07-20T00:00:00.000Z"),
      durationDays: 140,
      startDate: new Date("2026-07-27T00:00:00.000Z"),
      endDate: new Date("2026-12-09T00:00:00.000Z"),
    },
  });

  // RAB aktif + satu laporan BERTANGGAL HARI INI (bukan 30 Juli) — dipakai
  // membuktikan bahwa `asOf` tetap membatasi laporan yang dihitung.
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
  await db.rabNode.create({
    data: {
      revisionId: rab.id,
      parentId: kategori.id,
      kind: "item",
      lineageKey: `itm-${suffix}`,
      code: "1.1",
      name: "Bulldozer",
      sortOrder: 2,
      unit: "unit",
      volume: 10,
      unitPrice: 10_000_000,
      amount: 100_000_000n,
    },
  });
  const pelapor = await db.user.create({
    data: {
      orgId,
      username: `sm-${suffix}`,
      email: `sm-${suffix}@contoh.id`,
      fullName: "SM Uji",
      role: "site_manager",
      passwordHash: "x",
    },
    select: { id: true },
  });
  const laporan = await db.dailyReport.create({
    data: {
      locationId: locId,
      reportDate: parseDateKey(HARI_INI)!,
      status: "dikirim",
      createdById: pelapor.id,
    },
    select: { id: true },
  });
  await db.dailyReportItem.create({
    data: {
      reportId: laporan.id,
      rabNodeId: (await db.rabNode.findFirstOrThrow({
        where: { revisionId: rab.id, kind: "item" },
        select: { id: true },
      })).id,
      lineageKey: `itm-${suffix}`,
      basis: "aktif",
      volumeDone: 1,
      valueDone: 10_000_000n,
    },
  });

  // Baseline LAMA dibuat sebelum hari ini, digantikan SIANG ini.
  await buatBaseline(1, KURVA_LAMA, new Date("2026-07-27T02:00:00.000Z"), SAAT_GANTI);
  // Baseline BARU dibuat SIANG ini — sesudah tengah malam UTC hari ini.
  await buatBaseline(2, KURVA_BARU, SAAT_GANTI, null);

  /*
   * JAM DIBEKUKAN DI TANGGAL KEJADIAN — bukan kerapian, tapi syarat sahnya uji.
   *
   * Seluruh skenario ini bertanggal 6 Agustus 2026: kontrak mulai 27 Juli,
   * jadwal diganti siang 6 Agustus, dan angka yang dibandingkan (minggu ke-2,
   * rencana 1,7%) hanya berarti pada hari itu. Tapi `getLocationProgress(locId)`
   * TANPA `asOf` — yaitu persis cara layar workspace memanggilnya, dan justru
   * itu yang sedang diuji — membaca jam sungguhan. Jadi nomor minggunya ikut
   * merayap tiap pekan: tanggal 6 ia minggu ke-2, tanggal 12 sudah minggu ke-3
   * dan rencananya 3,2%.
   *
   * Uji ini karena itu lulus persis satu minggu lalu memerah sendiri tanpa ada
   * yang menyentuh kodenya — memerahkan CI orang lain untuk kesalahan yang
   * bukan miliknya. Membekukan jamnya membuat yang diuji tinggal yang memang
   * ingin diuji: DASAR rencananya baseline aktif, bukan baseline "yang berlaku
   * pada tanggal laporan" (DECISIONS 275).
   *
   * Hanya `Date` yang dipalsukan; timer lain dibiarkan asli supaya Prisma dan
   * jaringannya tetap berjalan normal.
   */
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SAAT_GANTI);
});

afterAll(async () => {
  vi.useRealTimers();
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("dasar rencana = baseline aktif", () => {
  it("minggunya sama-sama 2 — jadi selisihnya memang bukan soal minggu", async () => {
    const layar = await getLocationProgress(locId);
    const dokumen = await getLocationProgress(locId, { asOf: ASOF });
    expect(layar.weekNumber).toBe(2);
    expect(dokumen.weekNumber).toBe(2);
  });

  it("layar workspace memakai baseline AKTIF (yang baru)", async () => {
    const layar = await getLocationProgress(locId);
    expect(layar.planPct).toBeCloseTo(1.7, 5);
  });

  it("dokumen hari ini memakai baseline aktif — sama dengan layar", async () => {
    // Inilah keluhan aslinya: dokumen mencetak 23,30% (jadwal yang sudah
    // dibatalkan siang tadi) sementara layar menulis 1,7%.
    const dokumen = await getLocationProgress(locId, { asOf: ASOF });
    expect(dokumen.planPct).toBeCloseTo(1.7, 5);
  });

  it("laporan BACKDATED juga memakai baseline aktif", async () => {
    // Konsekuensi yang DISENGAJA dari keputusan user: ganti kurva-S, maka
    // deviasi di seluruh dokumen ikut bergeser — termasuk yang bertanggal
    // lampau — karena deviasi diukur terhadap rencana yang BERLAKU, bukan
    // terhadap rencana yang sudah dibatalkan. 30 Juli = minggu 1 → kurva BARU.
    const lampau = await getLocationProgress(locId, { asOf: parseDateKey("2026-07-30")! });
    expect(lampau.weekNumber).toBe(1);
    expect(lampau.planPct).toBeCloseTo(0.8, 5);
    expect(lampau.planPct).not.toBeCloseTo(11.5, 5); // bukan kurva lama
  });

  it("`asOf` tetap membatasi LAPORAN yang dihitung — itu inti CALC-01", async () => {
    // Yang dibuang cuma pemilihan VERSI. Batas waktu laporan tidak ikut
    // dibuang: dokumen bertanggal 30 Juli tidak boleh memuat realisasi 6
    // Agustus hanya karena dicetak hari ini.
    const lampau = await getLocationProgress(locId, { asOf: parseDateKey("2026-07-30")! });
    const kini = await getLocationProgress(locId);
    expect(lampau.realizedValue).toBe(0n);
    expect(kini.realizedValue).toBeGreaterThan(0n);
  });
});
