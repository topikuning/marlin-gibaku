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

describe("Fixture emas — angka bulat, hitungan manual", () => {
  /**
   * Calculation Integrity Protocol menuntut fixture dengan expected yang bisa
   * dihitung tangan. Lokasi terpisah dengan angka bulat supaya selisih sekecil
   * apa pun terlihat.
   *
   * RAB: 1 kategori Rp100.000.000 = 1 item 100 m3 × Rp1.000.000 (bobot 100%).
   * Realisasi 10 m3 → 10% prestasi → 10% bobot → realizedValue Rp10.000.000.
   */
  let emasLoc: string;
  let emasNode: string;

  beforeAll(async () => {
    const org = await db.organization.findFirstOrThrow({ where: { slug: `orgp-${suffix}` } });
    const pkg = await db.package.findFirstOrThrow({ where: { orgId: org.id } });
    const loc = await db.location.create({
      data: {
        packageId: pkg.id, name: "Lokasi Emas", slug: `lokasi-emas-${suffix}`,
        village: "Desa", regency: "Kab", province: "Prov",
      },
    });
    emasLoc = loc.id;
    const rev = await db.rabRevision.create({
      data: { locationId: emasLoc, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
    });
    await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN I", amount: 100_000_000n, lineageKey: "I", sortOrder: 0 },
    });
    const node = await db.rabNode.create({
      data: {
        revisionId: rev.id, kind: "item", code: "1.1", name: "Item Emas",
        volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n,
        lineageKey: "I#1.1", sortOrder: 1,
      },
    });
    emasNode = node.id;
    const baseline = await db.baseline.create({
      data: { locationId: emasLoc, baselineNo: 1, source: "auto", status: "aktif", rabRevisionId: rev.id, contractDays: WEEKS * 7 },
    });
    await db.baselinePoint.createMany({
      data: Array.from({ length: WEEKS }, (_, i) => ({
        baselineId: baseline.id, weekNumber: i + 1, plannedPct: ((i + 1) / WEEKS) * 100,
      })),
    });
  });

  it("#1+#2 RAB Rp100.000.000, realisasi 10 dari 100 unit → 10,00% / Rp10.000.000", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const kosong = await getLocationProgress(emasLoc);
    expect(kosong.grandTotal).toBe(100_000_000n);
    expect(kosong.realizedPct, "belum ada laporan → 0%").toBe(0);

    const rep = await db.dailyReport.create({
      data: { locationId: emasLoc, reportDate: d(START), status: "final", createdById: userId },
    });
    await db.dailyReportItem.create({
      data: { reportId: rep.id, rabNodeId: emasNode, lineageKey: "I#1.1", volumeDone: 10, valueDone: 10_000_000n },
    });

    const p = await getLocationProgress(emasLoc);
    expect(p.realizedValue).toBe(10_000_000n); // 10/100 × Rp100.000.000
    expect(p.realizedPct).toBeCloseTo(10, 9); // Rp10jt / Rp100jt × 100
  });

  it("#3 status draft TIDAK dihitung", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const rep = await db.dailyReport.create({
      data: { locationId: emasLoc, reportDate: plusDays(START, 1), status: "draft", createdById: userId },
    });
    await db.dailyReportItem.create({
      data: { reportId: rep.id, rabNodeId: emasNode, lineageKey: "I#1.1", volumeDone: 40, valueDone: 40_000_000n },
    });
    const p = await getLocationProgress(emasLoc);
    expect(p.realizedPct, "draft tidak boleh menaikkan progress").toBeCloseTo(10, 9);

    // #4/#5/#6: begitu naik ke dikirim/disetujui/final, ketiganya menghitung sama.
    for (const status of ["dikirim", "disetujui", "final"] as const) {
      await db.dailyReport.update({ where: { id: rep.id }, data: { status } });
      const q = await getLocationProgress(emasLoc);
      expect(q.realizedPct, `status ${status}`).toBeCloseTo(50, 9); // (10+40)/100
    }
    await db.dailyReport.delete({ where: { id: rep.id } });
  });

  it("#12 grand total nol tidak menghasilkan NaN/Infinity", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const org = await db.organization.findFirstOrThrow({ where: { slug: `orgp-${suffix}` } });
    const pkg = await db.package.findFirstOrThrow({ where: { orgId: org.id } });
    const loc = await db.location.create({
      data: {
        packageId: pkg.id, name: "Lokasi Kosong", slug: `lokasi-kosong-${suffix}`,
        village: "Desa", regency: "Kab", province: "Prov",
      },
    });
    const p = await getLocationProgress(loc.id);
    expect(p.grandTotal).toBe(0n);
    expect(Number.isFinite(p.realizedPct)).toBe(true);
    expect(p.realizedPct).toBe(0);
    expect(Number.isFinite(p.deviationPct)).toBe(true);
    // Laporan periodik untuk lokasi tanpa RAB aktif → null, bukan crash.
    expect(await getPeriodReport(loc.id, "mingguan", 1)).toBeNull();
  });

  it("#14 dua lokasi dalam satu paket tidak tercampur", async () => {
    const { getLocationsProgress } = await import("@/lib/progress");
    const m = await getLocationsProgress([emasLoc, locationId]);
    const emas = m.get(emasLoc)!;
    const utama = m.get(locationId)!;
    expect(emas.grandTotal).toBe(100_000_000n);
    expect(utama.grandTotal).toBe(GRAND);
    expect(emas.realizedPct).toBeCloseTo(10, 9);
    // Lokasi utama punya realisasi jauh lebih besar — kalau tercampur, kedua
    // angka ini akan saling menular.
    expect(utama.realizedPct).toBeGreaterThan(50);
  });
});

describe("Reconciliation gate — satu lokasi, satu dataAsOf, satu angka", () => {
  /**
   * Calculation Integrity Protocol: untuk lokasi & tanggal yang sama, seluruh
   * output WAJIB identik. Diuji lewat calculation layer yang dikonsumsi tiap
   * output, bukan lewat render — PDF/Excel/komponen cetak memakai objek
   * `PeriodReport` yang sama persis, jadi kesamaannya struktural.
   */
  it("dashboard = kurva-S ringkasan lokasi = laporan mingguan terakhir", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const { getScurveSeries } = await import("@/lib/baseline");

    const [p, s, r] = await Promise.all([
      getLocationProgress(locationId),
      getScurveSeries(locationId),
      getPeriodReport(locationId, "mingguan", WEEKS),
    ]);

    // Titik terakhir kurva ringkasan lokasi yang terisi (minggu berjalan).
    const filled = s.actualPct.filter((v): v is number => v != null);
    const kurvaLokasi = filled[filled.length - 1];

    expect(p.realizedPct, "dashboard vs laporan").toBeCloseTo(r!.totals.bobotSd, 6);
    expect(kurvaLokasi, "kurva ringkasan lokasi vs laporan").toBeCloseTo(r!.totals.bobotSd, 6);
    expect(kurvaLokasi, "kurva ringkasan lokasi vs dashboard").toBeCloseTo(p.realizedPct, 6);
  });

  it("panel saran rencana memakai deviasi yang sama dengan dashboard", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const { suggestWeeklyPlan } = await import("@/lib/plan/suggest");
    const [p, plan] = await Promise.all([
      getLocationProgress(locationId),
      suggestWeeklyPlan(locationId, WEEKS),
    ]);
    // suggest memakai grandTotal Σ(volume×harga) sedangkan progress memakai
    // Σ amount kategori; pada RAB yang konsisten keduanya sama.
    expect(plan!.actualPct).toBeCloseTo(Math.round(p.realizedPct * 100) / 100, 1);
  });

  it("kurva ringkasan lokasi tidak pernah melewati 100% walau volume over", async () => {
    const { getScurveSeries } = await import("@/lib/baseline");
    const s = await getScurveSeries(locationId);
    for (const v of s.actualPct) {
      if (v == null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100 + 1e-9);
    }
  });
});

describe("Date-as-of gate", () => {
  it("laporan minggu n tidak memasukkan realisasi minggu sesudahnya", async () => {
    // Minggu 4 punya realisasi; laporan minggu 3 tidak boleh melihatnya.
    const w3 = await getPeriodReport(locationId, "mingguan", 3);
    const w4 = await getPeriodReport(locationId, "mingguan", 4);
    expect(w4!.totals.bobotSd).toBeGreaterThan(w3!.totals.bobotSd);
    // "ini" minggu 4 = selisih s/d — tidak ada realisasi yang bocor mundur.
    expect(w4!.totals.bobotIni).toBeCloseTo(w4!.totals.bobotSd - w3!.totals.bobotSd, 9);
  });

  it("periode minggu n memakai batas tanggal yang benar", async () => {
    for (const n of [1, 3, WEEKS]) {
      const r = await getPeriodReport(locationId, "mingguan", n);
      const expStart = plusDays(START, (n - 1) * 7);
      expect(r!.header.periodeStart.toISOString().slice(0, 10)).toBe(expStart.toISOString().slice(0, 10));
      expect(r!.header.periodeEnd.getTime() - r!.header.periodeStart.getTime()).toBe(6 * DAY);
    }
  });

  it("laporan periode lampau tidak berubah oleh 'hari ini'", async () => {
    // Semua data fixture ada di minggu 1..4 dan kontraknya sudah lewat, jadi
    // laporan minggu 4 harus stabil dipanggil berkali-kali.
    const a = await getPeriodReport(locationId, "mingguan", 4);
    const b = await getPeriodReport(locationId, "mingguan", 4);
    expect(a!.totals).toEqual(b!.totals);
    expect(a!.actualPct).toBe(b!.actualPct);
  });
});

describe("Revision & lineage gate", () => {
  it("laporan dua tanggal dengan lineage sama dijumlah, tidak dobel-hitung", async () => {
    const r = await getPeriodReport(locationId, "mingguan", WEEKS);
    const galian = allRows(r!).find((x) => x.code === "1.1")!;
    // 20 (mgg 1) + 30 (mgg 2) + 60 (mgg 3) = 110 volume mentah.
    expect(galian.volSd).toBeCloseTo(110, 6);
    // Prestasinya tetap dibatasi 100% karena volume kontraknya 100.
    expect(galian.prestasiSd).toBe(100);
  });

  /**
   * Adendum di dunia nyata TIDAK menghapus node RAB (foreign key laporan
   * melindunginya) — revisi lama di-supersede dan revisi BARU jadi aktif.
   * Lokasi terpisah supaya fixture utama tidak terganggu.
   */
  it("lineage yang hilang di revisi aktif baru TIDAK masuk realisasi aktif, histori tetap utuh", async () => {
    const org = await db.organization.findFirstOrThrow({ where: { slug: `orgp-${suffix}` } });
    const pkg = await db.package.findFirstOrThrow({ where: { orgId: org.id } });
    const loc = await db.location.create({
      data: {
        packageId: pkg.id,
        name: "Lokasi Adendum",
        slug: `lokasi-adendum-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
      },
    });

    // Revisi 1: dua item, masing-masing Rp50 juta (bobot 50/50).
    const rev1 = await db.rabRevision.create({
      data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
    });
    await db.rabNode.create({
      data: { revisionId: rev1.id, kind: "kategori", code: "I", name: "PEKERJAAN I", amount: 100_000_000n, lineageKey: "I", sortOrder: 0 },
    });
    const mk = (revId: string, key: string, code: string, sort: number) =>
      db.rabNode.create({
        data: {
          revisionId: revId, kind: "item", code, name: `Item ${code}`,
          volume: 50, unit: "m3", unitPrice: 1_000_000, amount: 50_000_000n,
          lineageKey: key, sortOrder: sort,
        },
      });
    const a1 = await mk(rev1.id, "I#A", "1.1", 1);
    const b1 = await mk(rev1.id, "I#B", "1.2", 2);

    const rep = await db.dailyReport.create({
      data: { locationId: loc.id, reportDate: d(START), status: "final", createdById: userId },
    });
    for (const [node, key] of [[a1, "I#A"], [b1, "I#B"]] as const) {
      await db.dailyReportItem.create({
        data: { reportId: rep.id, rabNodeId: node.id, lineageKey: key, volumeDone: 50, valueDone: 50_000_000n },
      });
    }

    const { getLocationProgress } = await import("@/lib/progress");
    const before = await getLocationProgress(loc.id);
    expect(before.realizedPct, "kedua item selesai penuh").toBeCloseTo(100, 6);

    // Adendum: revisi 2 aktif, item I#B DIHAPUS dari lingkup.
    await db.rabRevision.update({ where: { id: rev1.id }, data: { status: "digantikan", supersededAt: new Date() } });
    const rev2 = await db.rabRevision.create({
      data: { locationId: loc.id, revisionNo: 2, source: "adendum", status: "aktif", totalValue: 50_000_000n },
    });
    await db.rabNode.create({
      data: { revisionId: rev2.id, kind: "kategori", code: "I", name: "PEKERJAAN I", amount: 50_000_000n, lineageKey: "I", sortOrder: 0 },
    });
    await mk(rev2.id, "I#A", "1.1", 1);

    const after = await getLocationProgress(loc.id);
    // Basis tinggal I#A (bobot 100%) dan realisasinya penuh → tetap 100%,
    // BUKAN 200% (kalau realisasi I#B ikut terhitung ke basis yang mengecil).
    expect(after.realizedPct, "lineage mati tidak boleh ikut").toBeCloseTo(100, 6);

    // Histori laporan TIDAK dihapus oleh adendum.
    const stillThere = await db.dailyReportItem.count({ where: { reportId: rep.id } });
    expect(stillThere).toBe(2);

    // Realisasi yang dibawa lintas revisi lewat lineageKey tidak dihitung dua kali.
    const items = await db.dailyReportItem.findMany({ where: { lineageKey: "I#A", report: { locationId: loc.id } } });
    expect(items).toHaveLength(1);
  });
});

describe("Tindak lanjut audit independen 2026-07-27", () => {
  /** C1 — dua revisi aktif pada satu lokasi = fan-out join = realisasi dobel. */
  it("C1: dua revisi RAB 'aktif' pada satu lokasi DITOLAK database", async () => {
    const rev = await db.rabRevision.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { locationId: true },
    });
    await expect(
      db.rabRevision.create({
        data: {
          locationId: rev.locationId,
          revisionNo: 99,
          source: "adendum",
          status: "aktif",
          totalValue: 1n,
        },
      }),
    ).rejects.toThrow();
  });

  it("C1: dua baseline 'aktif' pada satu lokasi DITOLAK database", async () => {
    const b = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { locationId: true },
    });
    await expect(
      db.baseline.create({
        data: { locationId: b.locationId, baselineNo: 99, source: "manual", status: "aktif", contractDays: 7 },
      }),
    ).rejects.toThrow();
  });

  /**
   * H2 — formula ditulis dua kali (SQL di progress.ts, TS di progress-calc.ts).
   * Hanya TS yang punya unit test; paritasnya sendiri tidak pernah diuji.
   */
  it("H2: raw SQL realisasi identik dengan realizedPctFromItems atas data yang sama", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const { realizedPctFromItems, bobotPct } = await import("@/lib/progress-calc");

    const rev = await db.rabRevision.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { id: true },
    });
    const [items, cats, vols] = await Promise.all([
      db.rabNode.findMany({
        where: { revisionId: rev.id, kind: "item" },
        select: { lineageKey: true, volume: true, amount: true },
      }),
      db.rabNode.aggregate({ where: { revisionId: rev.id, kind: "kategori" }, _sum: { amount: true } }),
      db.dailyReportItem.groupBy({
        by: ["lineageKey"],
        where: { report: { locationId, status: { in: ["dikirim", "disetujui", "final"] } } },
        _sum: { volumeDone: true },
      }),
    ]);
    const volByLineage = new Map(vols.map((v) => [v.lineageKey, Number(v._sum.volumeDone ?? 0)]));
    const grand = Number(cats._sum.amount ?? 0n);
    const ts = realizedPctFromItems(
      items.map((n) => ({
        volK: n.volume != null ? Number(n.volume) : 0,
        volSd: volByLineage.get(n.lineageKey) ?? 0,
        bobot: bobotPct(Number(n.amount), grand),
      })),
    );
    const sql = await getLocationProgress(locationId);
    // Toleransi kecil: SQL membulatkan ke rupiah bulat sebelum dibagi.
    expect(sql.realizedPct).toBeCloseTo(ts, 6);
  });

  it("H2: volume negatif neto tidak membuat SQL & TS berselisih tanda", async () => {
    const { prestasiPct } = await import("@/lib/progress-calc");
    // TS meng-clamp ke 0; SQL kini memakai GREATEST(0, …) yang sepadan.
    expect(prestasiPct(-10, 100)).toBe(0);
    const rows = await db.$queryRaw<{ v: number }[]>`
      SELECT GREATEST(0.0, LEAST(1.0, (-10)::numeric / NULLIF(GREATEST(100, 0), 0)))::float AS v
    `;
    expect(rows[0].v).toBe(0);
  });

  /**
   * M8 — pembilang realisasi menjumlah ITEM, penyebut grandTotal menjumlah
   * KATEGORI. Kalau keduanya drift, realizedPct salah tanpa gejala apa pun.
   */
  it("M8: Σ amount kategori == Σ amount item pada revisi aktif", async () => {
    const rev = await db.rabRevision.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { id: true },
    });
    const [kat, item] = await Promise.all([
      db.rabNode.aggregate({ where: { revisionId: rev.id, kind: "kategori" }, _sum: { amount: true } }),
      db.rabNode.aggregate({ where: { revisionId: rev.id, kind: "item" }, _sum: { amount: true } }),
    ]);
    expect(kat._sum.amount).toBe(item._sum.amount);
  });

  /**
   * M7 — satu-satunya fixture CIP yang benar-benar belum tertutup: siklus
   * koreksi. Penolakan volume > kontrak dan PPN/contractMismatch SUDAH diuji
   * (daily-report-flow.test.ts & money.test.ts); audit keliru pada dua itu.
   */
  it("M7: laporan dikembalikan → diperbaiki → dikirim ulang dihitung SEKALI", async () => {
    const { getLocationProgress } = await import("@/lib/progress");
    const org = await db.organization.findFirstOrThrow({ where: { slug: `orgp-${suffix}` } });
    const pkg = await db.package.findFirstOrThrow({ where: { orgId: org.id } });
    const loc = await db.location.create({
      data: {
        packageId: pkg.id, name: "Lokasi Koreksi", slug: `lokasi-koreksi-${suffix}`,
        village: "Desa", regency: "Kab", province: "Prov",
      },
    });
    const rev = await db.rabRevision.create({
      data: { locationId: loc.id, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
    });
    await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN I", amount: 100_000_000n, lineageKey: "I", sortOrder: 0 },
    });
    const node = await db.rabNode.create({
      data: {
        revisionId: rev.id, kind: "item", code: "1.1", name: "Item Koreksi",
        volume: 100, unit: "m3", unitPrice: 1_000_000, amount: 100_000_000n,
        lineageKey: "I#1.1", sortOrder: 1,
      },
    });
    const rep = await db.dailyReport.create({
      data: { locationId: loc.id, reportDate: d(START), status: "dikirim", createdById: userId },
    });
    await db.dailyReportItem.create({
      data: { reportId: rep.id, rabNodeId: node.id, lineageKey: "I#1.1", volumeDone: 30, valueDone: 30_000_000n },
    });
    expect((await getLocationProgress(loc.id)).realizedPct).toBeCloseTo(30, 9);

    // Dikembalikan untuk koreksi → keluar dari status counted.
    await db.dailyReport.update({ where: { id: rep.id }, data: { status: "perlu_koreksi" } });
    expect((await getLocationProgress(loc.id)).realizedPct, "perlu_koreksi tidak dihitung").toBeCloseTo(0, 9);

    // Volume diperbaiki (upsert pada lineage yang sama, BUKAN baris baru) lalu
    // dikirim ulang → disetujui → final. Harus 45%, bukan 30+45.
    await db.dailyReportItem.update({
      where: { reportId_lineageKey: { reportId: rep.id, lineageKey: "I#1.1" } },
      data: { volumeDone: 45, valueDone: 45_000_000n },
    });
    for (const status of ["dikirim", "disetujui", "final"] as const) {
      await db.dailyReport.update({ where: { id: rep.id }, data: { status } });
      expect((await getLocationProgress(loc.id)).realizedPct, `setelah koreksi · ${status}`).toBeCloseTo(45, 9);
    }
    expect(await db.dailyReportItem.count({ where: { reportId: rep.id } })).toBe(1);
  });
});

describe("REGRESI B2 (audit 2026-07-27): blanko harian jalur LIVE ikut cap 100%", () => {
  it("item over-volume tampil 100% di pratinjau harian, sama dengan blanko mingguan", async () => {
    // Fixture utama: I#1.1 kumulatif 110 dari volume kontrak 100 (minggu 3
    // menambah 60). Laporan dibuat langsung via db TANPA finalSnapshot →
    // getKkpDailyData memakai jalur LIVE — jalur yang dulu menyalin rumus
    // tanpa cap dan menampilkan 110%.
    const { getKkpDailyData } = await import("@/lib/daily-report/queries");
    const loc = await db.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { slug: true },
    });
    const week3 = plusDays(START, 2 * 7); // laporan minggu 3, day 0
    const data = await getKkpDailyData(loc.slug, week3.toISOString().slice(0, 10));
    expect(data).not.toBeNull();
    const galian = data!.items.find((it) => it.code === "1.1");
    expect(galian).toBeDefined();
    expect(galian!.volumeCumulative).toBeCloseTo(110, 6); // volume mentah tetap jujur
    expect(galian!.pctCumulative).toBe(100); // persentase di-cap, konsisten blanko mingguan
    for (const it of data!.items) {
      if (it.pctCumulative != null) expect(it.pctCumulative).toBeLessThanOrEqual(100);
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
