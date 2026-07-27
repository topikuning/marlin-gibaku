// Integration test laporan periodik (mingguan/bulanan) format KKP.
//
// Yang dijaga di sini adalah INVARIAN ANGKA — kelas kesalahan yang sama dengan
// laporan harian (DECISIONS 147): kolom yang tidak jumlah, "s/d" yang mundur
// antar minggu, dan tabel yang tidak sepakat dengan kurva-S di halaman yang sama.
//
// Jalankan: DATABASE_URL=...marlin_test APP_ENV=test pnpm vitest run tests/integration
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport, getPeriodBounds } = await import("@/lib/periodic-report");

const suffix = Date.now().toString(36);
let locationId: string;
let userId: string;

/** Kontrak mulai 2026-01-05 (Senin), 8 minggu. */
const START = "2026-01-05";
const WEEKS = 8;
const DAY = 24 * 3600 * 1000;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const plusDays = (key: string, n: number) => new Date(d(key).getTime() + n * DAY);

/**
 * RAB dua kategori, empat item. Nilai dipilih supaya bobot tidak bulat —
 * pembulatan yang menyembunyikan selisih jadi ketahuan.
 */
const ITEMS = [
  { cat: "I", code: "1.1", name: "Galian tanah", vol: 100, price: 150_000, lineage: "I#1.1" },
  { cat: "I", code: "1.2", name: "Urugan pasir", vol: 40, price: 220_000, lineage: "I#1.2" },
  { cat: "II", code: "2.1", name: "Pasangan batu", vol: 60, price: 900_000, lineage: "II#2.1" },
  { cat: "II", code: "2.2", name: "Plesteran", vol: 250, price: 75_000, lineage: "II#2.2" },
];
const amountOf = (it: (typeof ITEMS)[number]) => BigInt(it.vol * it.price);
const CAT_TOTAL: Record<string, bigint> = {
  I: ITEMS.filter((i) => i.cat === "I").reduce((s, i) => s + amountOf(i), 0n),
  II: ITEMS.filter((i) => i.cat === "II").reduce((s, i) => s + amountOf(i), 0n),
};
const GRAND = CAT_TOTAL.I + CAT_TOTAL.II;

const nodeIdByLineage = new Map<string, string>();

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org P ${suffix}`, slug: `orgp-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `pr-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT Uji ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket P ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR-${suffix}`,
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
      name: "Lokasi Periodik",
      slug: `lokasi-p-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: GRAND },
  });
  // Kategori dulu (sortOrder 0,1) lalu item — urutan RAB adalah sumber urutan tabel.
  let sort = 0;
  for (const cat of ["I", "II"]) {
    await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "kategori",
        code: cat,
        name: `PEKERJAAN ${cat}`,
        amount: CAT_TOTAL[cat],
        lineageKey: cat,
        sortOrder: sort++,
      },
    });
  }
  for (const it of ITEMS) {
    const node = await db.rabNode.create({
      data: {
        revisionId: rev.id,
        kind: "item",
        code: it.code,
        name: it.name,
        volume: it.vol,
        unit: "m3",
        unitPrice: it.price,
        amount: amountOf(it),
        lineageKey: it.lineage,
        sortOrder: sort++,
      },
    });
    nodeIdByLineage.set(it.lineage, node.id);
  }

  // Baseline linear 8 minggu.
  const baseline = await db.baseline.create({
    data: { locationId, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: WEEKS * 7 },
  });
  await db.baselinePoint.createMany({
    data: Array.from({ length: WEEKS }, (_, i) => ({
      baselineId: baseline.id,
      weekNumber: i + 1,
      plannedPct: ((i + 1) / WEEKS) * 100,
    })),
  });

  // Realisasi: tiap minggu 1..4 ada laporan. Minggu 3 SENGAJA melebihi volume
  // kontrak pada satu item (kasus nyata: operator salah input / pekerjaan
  // tambah) — di situlah pembatas 100% mulai bekerja.
  const plan: { week: number; day: number; vols: Record<string, number> }[] = [
    { week: 1, day: 1, vols: { "I#1.1": 20, "II#2.2": 50 } },
    { week: 2, day: 2, vols: { "I#1.1": 30, "I#1.2": 10 } },
    { week: 3, day: 0, vols: { "I#1.1": 60, "II#2.1": 20 } }, // I#1.1 → 110 dari vk 100
    { week: 4, day: 3, vols: { "II#2.1": 25, "II#2.2": 100 } },
  ];
  for (const p of plan) {
    const date = plusDays(START, (p.week - 1) * 7 + p.day);
    const report = await db.dailyReport.create({
      data: { locationId, reportDate: date, status: "final", createdById: userId, weather: "cerah" },
    });
    for (const [lineage, vol] of Object.entries(p.vols)) {
      const it = ITEMS.find((x) => x.lineage === lineage)!;
      await db.dailyReportItem.create({
        data: {
          reportId: report.id,
          rabNodeId: nodeIdByLineage.get(lineage)!,
          lineageKey: lineage,
          volumeDone: vol,
          valueDone: BigInt(Math.round(vol * it.price)),
        },
      });
    }
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

const allRows = (r: NonNullable<Awaited<ReturnType<typeof getPeriodReport>>>) =>
  r.categories.flatMap((c) => c.rows);

describe("laporan mingguan — invarian angka", () => {
  it("prasyarat periode terbaca (8 minggu)", async () => {
    const b = await getPeriodBounds(locationId);
    expect(b?.totalWeeks).toBe(WEEKS);
  });

  it("Σ bobot seluruh item = 100% (tabel tidak kehilangan pekerjaan)", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 4);
    expect(r).not.toBeNull();
    const sum = allRows(r!).reduce((s, x) => s + x.bobot, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("urutan kategori & baris mengikuti urutan RAB, bukan urutan input", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 4);
    expect(r!.categories.map((c) => c.code)).toEqual(["I", "II"]);
    expect(allRows(r!).map((x) => x.code)).toEqual(["1.1", "1.2", "2.1", "2.2"]);
    // Penomoran urut tanpa lompat.
    expect(allRows(r!).map((x) => x.no)).toEqual([1, 2, 3, 4]);
    expect(r!.kurvaSchedule.map((k) => k.code)).toEqual(["I", "II"]);
  });

  it("setiap baris: volume lalu + ini = s/d", async () => {
    for (let n = 1; n <= WEEKS; n++) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      for (const row of allRows(r!)) {
        expect(row.volLalu + row.volIni, `minggu ${n} · ${row.name}`).toBeCloseTo(row.volSd, 6);
      }
    }
  });

  it("REGRESI: bobot lalu + bobot ini = bobot s/d, termasuk saat volume melebihi kontrak", async () => {
    // Minggu 3 membuat I#1.1 jadi 110 dari volume kontrak 100. Kalau prestasi
    // dibatasi 100% per kolom secara terpisah, "lalu + ini" jadi lebih besar
    // dari "s/d" dan baris di blanko KKP tidak jumlah.
    for (let n = 1; n <= WEEKS; n++) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      for (const row of allRows(r!)) {
        expect(row.bobotLalu + row.bobotIni, `minggu ${n} · ${row.name} (bobot)`).toBeCloseTo(row.bobotSd, 9);
        expect(row.prestasiLalu + row.prestasiIni, `minggu ${n} · ${row.name} (prestasi)`).toBeCloseTo(
          row.prestasiSd,
          9,
        );
      }
      expect(r!.totals.bobotLalu + r!.totals.bobotIni, `minggu ${n} · total`).toBeCloseTo(r!.totals.bobotSd, 9);
    }
  });

  it("REGRESI: 's/d' tidak pernah mundur antar minggu", async () => {
    // Gejala yang pernah terjadi di laporan harian: Selasa s/d 120, Rabu s/d 41.
    let prev = -1;
    for (let n = 1; n <= WEEKS; n++) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      expect(r!.totals.bobotSd, `minggu ${n}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r!.totals.bobotSd;
    }
  });

  it("'lalu' minggu n = 's/d' minggu n−1 (tidak ada realisasi yang hilang/dobel)", async () => {
    for (let n = 2; n <= WEEKS; n++) {
      const prev = await getPeriodReport(locationId, "mingguan", n - 1);
      const cur = await getPeriodReport(locationId, "mingguan", n);
      expect(cur!.totals.bobotLalu, `minggu ${n}`).toBeCloseTo(prev!.totals.bobotSd, 9);
      for (const row of allRows(cur!)) {
        const before = allRows(prev!).find((x) => x.code === row.code)!;
        expect(row.volLalu, `minggu ${n} · ${row.name}`).toBeCloseTo(before.volSd, 6);
      }
    }
  });

  it("minggu 1 tidak punya 'lalu' (tidak ada realisasi sebelum kontrak mulai)", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 1);
    expect(r!.totals.bobotLalu).toBeCloseTo(0, 9);
    for (const row of allRows(r!)) expect(row.volLalu).toBe(0);
  });

  it("REGRESI: total tabel = angka kurva-S di halaman yang sama", async () => {
    // Satu halaman KKP menampilkan dua angka untuk hal yang sama: total "bobot
    // s/d" di tabel dan realisasi kurva-S. Kalau keduanya dihitung dari sumber
    // berbeda (volume vs valueDone), pembaca melihat dua angka berbeda.
    for (let n = 1; n <= WEEKS; n++) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      expect(r!.actualPct, `minggu ${n} · tabel vs kurva`).toBeCloseTo(r!.totals.bobotSd, 6);
    }
  });

  it("REGRESI: deret kurva-S pada minggu n = actualPct laporan minggu n", async () => {
    for (let n = 1; n <= WEEKS; n++) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      const atN = r!.scurve.actualPct[n - 1];
      if (atN == null) continue; // minggu di depan minggu berjalan sengaja kosong
      expect(atN, `minggu ${n} · titik kurva`).toBeCloseTo(r!.actualPct, 6);
    }
  });

  it("kurva-S rencana & realisasi: realisasi tidak diisi melewati minggu laporan", async () => {
    const r = await getPeriodReport(locationId, "mingguan", 2);
    expect(r!.scurve.actualPct.slice(0, 2).every((v) => v != null)).toBe(true);
    expect(r!.scurve.actualPct.slice(2).every((v) => v == null)).toBe(true);
    expect(r!.deviationPct).toBeCloseTo(r!.actualPct - r!.planPct, 9);
  });

  it("sisa volume & sisa prestasi konsisten dengan s/d", async () => {
    const r = await getPeriodReport(locationId, "mingguan", WEEKS);
    for (const row of allRows(r!)) {
      expect(row.sisaVol).toBeCloseTo(Math.max(0, row.volK - row.volSd), 6);
      expect(row.sisaPrestasi).toBeCloseTo(Math.max(0, 100 - row.prestasiSd), 6);
    }
  });

  it("n di luar rentang ditolak", async () => {
    expect(await getPeriodReport(locationId, "mingguan", 0)).toBeNull();
    expect(await getPeriodReport(locationId, "mingguan", WEEKS + 1)).toBeNull();
  });
});

describe("REGRESI: dashboard & laporan resmi tidak boleh beda angka", () => {
  it("realizedPct dashboard = total 'bobot s/d' laporan minggu terakhir", async () => {
    // Kontrak fixture sudah lewat, jadi minggu berjalan = minggu terakhir dan
    // laporan minggu ke-8 memuat SELURUH realisasi — angka yang sama persis
    // dengan yang dipampang dashboard/portofolio.
    const { getLocationProgress } = await import("@/lib/progress");
    const p = await getLocationProgress(locationId);
    const r = await getPeriodReport(locationId, "mingguan", WEEKS);
    expect(p.realizedPct).toBeCloseTo(r!.totals.bobotSd, 6);
  });

  it("realizedPct dashboard tidak terpengaruh harga beku di laporan lama", async () => {
    // `valueDone` dibekukan memakai harga satuan saat laporan dibuat. Kalau
    // dashboard memakai kolom itu, satu adendum yang mengubah harga langsung
    // membuat dashboard dan blanko KKP berbeda tanpa ada salah input.
    const item = await db.dailyReportItem.findFirst({
      where: { report: { locationId }, lineageKey: "II#2.2" },
      select: { id: true, valueDone: true },
    });
    await db.dailyReportItem.update({
      where: { id: item!.id },
      data: { valueDone: item!.valueDone * 3n }, // seolah harga lama 3× harga aktif
    });
    try {
      const { getLocationProgress } = await import("@/lib/progress");
      const p = await getLocationProgress(locationId);
      const r = await getPeriodReport(locationId, "mingguan", WEEKS);
      expect(p.realizedPct).toBeCloseTo(r!.totals.bobotSd, 6);
    } finally {
      await db.dailyReportItem.update({ where: { id: item!.id }, data: { valueDone: item!.valueDone } });
    }
  });
});

describe("laporan bulanan — invarian yang sama", () => {
  it("total tabel = angka kurva-S", async () => {
    const b = await getPeriodBounds(locationId);
    for (let n = 1; n <= b!.totalMonths; n++) {
      const r = await getPeriodReport(locationId, "bulanan", n);
      if (!r) continue;
      expect(r.actualPct, `bulan ${n}`).toBeCloseTo(r.totals.bobotSd, 6);
      expect(r.totals.bobotLalu + r.totals.bobotIni, `bulan ${n}`).toBeCloseTo(r.totals.bobotSd, 9);
    }
  });
});
