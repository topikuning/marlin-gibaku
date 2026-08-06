// KATEGORI KURVA-S DIJODOHKAN LEWAT `lineageKey`, BUKAN NAMA (CALC-04).
//
// Temuan user 2026-08-06 dari berkas ekspor kurva-S: satu kategori muncul tanpa
// nomor romawi, dengan judul lama ("PEKERJAAN (kategori VIII — judul tidak ada
// di file)"), dan terlempar ke baris paling bawah — padahal di RAB kategori itu
// sudah diberi judul yang benar. Penyebabnya: laporan menjodohkan jadwal
// tersimpan pada baseline dengan kategori RAB berdasar NAMA, sementara nama bisa
// diganti lewat fitur "ganti judul kategori".
//
// Cacatnya SENYAP dan BUKAN cuma label. Kolom "Bobot Rencana" item di kategori
// yang tak berpasangan itu jatuh ke fallback fraksi rencana LOKASI, jadi
// ANGKANYA ikut salah — dan tetap menjumlah ke rencana resmi, sehingga tidak ada
// total yang terlihat janggal.
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = Date.now().toString(36);
const START = "2026-01-05";
const WEEKS = 8;
const DAY = 24 * 3600 * 1000;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const plusDays = (key: string, n: number) => new Date(d(key).getTime() + n * DAY);

/** Judul yang TERSIMPAN di baseline — sisa keadaan sebelum judul diperbaiki. */
const JUDUL_USANG = "PEKERJAAN (kategori II — judul tidak ada di file)";
/** Judul yang BERLAKU di RAB aktif sekarang. */
const JUDUL_RAB = "PEKERJAAN REVETMENT";

// Kategori I = 40% nilai, kategori II = 60%.
const CAT_AMOUNT: Record<string, bigint> = { I: 400_000_000n, II: 600_000_000n };
const GRAND = CAT_AMOUNT.I + CAT_AMOUNT.II;

// Jadwal SANGAT terpisah: I tuntas di minggu 1–2, II baru mulai minggu 7.
// Di akhir minggu 2 rencana kategori II = 0 — angka yang tidak mungkin muncul
// dari fallback fraksi lokasi (yang bernilai 25% pada minggu itu).
const WEEKLY: Record<string, number[]> = {
  I: [20, 20, 0, 0, 0, 0, 0, 0],
  II: [0, 0, 0, 0, 0, 0, 30, 30],
};

let locationId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org K ${suffix}`, slug: `orgk-${suffix}` } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Uji K ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket K ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR-K-${suffix}`,
      contractValue: GRAND,
      signedDate: d(START),
      durationDays: WEEKS * 7,
      startDate: d(START),
      endDate: plusDays(START, WEEKS * 7 - 1),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Kurva",
      slug: `lokasi-k-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: GRAND },
  });
  let sort = 0;
  // Kategori II SUDAH memakai judul yang diperbaiki di RAB.
  for (const [key, nama] of [
    ["I", "PEKERJAAN PERSIAPAN"],
    ["II", JUDUL_RAB],
  ] as const) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "kategori",
        code: key,
        name: nama,
        amount: CAT_AMOUNT[key],
        lineageKey: key,
        sortOrder: sort++,
      },
    });
  }
  for (const [key, code, nama] of [
    ["I", "1.1", "Mobilisasi"],
    ["II", "2.1", "Pasangan batu"],
  ] as const) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "item",
        code,
        name: nama,
        volume: 100,
        unit: "m3",
        unitPrice: Number(CAT_AMOUNT[key]) / 100,
        amount: CAT_AMOUNT[key],
        lineageKey: `${key}#${code}`,
        sortOrder: sort++,
      },
    });
  }

  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "manual", status: "aktif", rabRevisionId: rev.id, contractDays: WEEKS * 7 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: WEEKS }, (_, i) => ({
      baselineId: baseline.id,
      weekNumber: i + 1,
      plannedPct: ((i + 1) / WEEKS) * 100,
    })),
  });
  // Inti fixture: jadwal tersimpan menyimpan CUPLIKAN nama kategori II dari
  // sebelum judulnya diperbaiki. Persis keadaan data user.
  await db.baselineScheduleItem.createMany({
    data: [
      { baselineId: baseline.id, lineageKey: "I", name: "PEKERJAAN PERSIAPAN", weightPct: 40, weekly: WEEKLY.I },
      { baselineId: baseline.id, lineageKey: "II", name: JUDUL_USANG, weightPct: 60, weekly: WEEKLY.II },
    ],
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("jadwal kurva-S vs kategori RAB yang judulnya diganti", () => {
  it("kategori tetap punya nomor romawi — tidak jadi baris tanpa kode", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 2);
    expect(r).not.toBeNull();
    expect(r!.kurvaSchedule.map((k) => k.code)).toEqual(["I", "II"]);
  });

  it("judul yang tampil = judul RAB yang BERLAKU, bukan cuplikan usang", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 2);
    const nama = r!.kurvaSchedule.map((k) => k.name);
    expect(nama).toContain(JUDUL_RAB);
    expect(nama).not.toContain(JUDUL_USANG);
  });

  it("urutannya mengikuti RAB, bukan terlempar ke belakang", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 2);
    expect(r!.kurvaSchedule.map((k) => k.lineageKey)).toEqual(["I", "II"]);
  });

  it("BOBOT RENCANA memakai jadwal kategorinya sendiri — bukan fallback lokasi", async () => {
    // Ini gigi sesungguhnya: yang salah bukan hanya labelnya.
    // Minggu 2 → rencana resmi 25%. Jadwal kategori I sudah tuntas (fraksi 1),
    // kategori II belum mulai (fraksi 0), jadi SELURUH 25% itu milik kategori I.
    // Dengan pencocokan by-name, kategori II kehilangan jadwalnya dan memakai
    // fraksi rencana LOKASI (0,25) — sehingga ia ikut kebagian ±6,8 poin yang
    // sebenarnya bukan haknya, dan kategori I kekurangan sebanyak itu.
    const r = await getPeriodReport(locationId, "mingguan", 2);
    expect(r!.planPct).toBeCloseTo(25, 6);
    const byKey = new Map(r!.categories.map((c) => [c.lineageKey, c]));
    expect(byKey.get("II")!.subtotalBobotRencana).toBeCloseTo(0, 6);
    expect(byKey.get("I")!.subtotalBobotRencana).toBeCloseTo(25, 6);
  });

  it("total Bobot Rencana tetap = rencana resmi kurva (satu dokumen, satu angka)", async () => {
    for (const n of [1, 2, 4, 7, 8]) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      const total = r!.categories.reduce((s, c) => s + c.subtotalBobotRencana, 0);
      expect(total, `minggu ${n}`).toBeCloseTo(r!.planPct, 6);
    }
  });

  it("kategori yang HILANG dari RAB aktif tetap tampil apa adanya, tanpa kode palsu", async () => {
    // Kategori bisa benar-benar dibuang lewat adendum. Barisnya tetap muncul
    // dengan cuplikan namanya dan TANPA nomor romawi — itu keadaan yang benar,
    // bukan sesuatu yang boleh ditutupi dengan menebak kode.
    const base = await db.baseline.findFirstOrThrow({ where: { locationId, status: "aktif" } });
    await db.baselineScheduleItem.create({
      data: {
        baselineId: base.id,
        lineageKey: "ZZ",
        name: "PEKERJAAN YANG DIBATALKAN ADENDUM",
        weightPct: 0,
        weekly: [1, 0, 0, 0, 0, 0, 0, 0],
      },
    });
    const r = await getPeriodReport(locationId, "mingguan", 2);
    const hilang = r!.kurvaSchedule.find((k) => k.lineageKey === "ZZ");
    expect(hilang).toBeDefined();
    expect(hilang!.code).toBe("");
    expect(hilang!.name).toBe("PEKERJAAN YANG DIBATALKAN ADENDUM");
    expect(r!.kurvaSchedule.at(-1)!.lineageKey).toBe("ZZ");
    await db.baselineScheduleItem.deleteMany({ where: { baselineId: base.id, lineageKey: "ZZ" } });
  });
});
