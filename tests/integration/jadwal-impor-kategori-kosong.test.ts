// JADWAL IMPOR "APA ADANYA" DENGAN SATU KATEGORI TANPA BARIS DI EXCEL.
//
// DECISIONS 203 mengizinkannya: `susunJadwalApaAdanya` menyimpan kategori itu
// sebagai baris nol dan banner impor menyebutnya ("1 pekerjaan tanpa jadwal di
// Excel dibiarkan kosong"). Titik kurva resmi (BaselinePoint) tetap dari Excel.
//
// Tetapi pembacanya mensyaratkan SETIAP kategori punya minggu > 0, jadi satu
// baris nol membuat seluruh matriks tersimpan dianggap tak terpakai: editor
// jadwal membuka "otomatis", dan tabel kategori blanko KKP dihitung ulang dari
// jendela otomatis — sementara baris "Kumulatif Rencana" di halaman yang sama
// tetap memakai titik impor. Satu dokumen, dua jadwal rencana.
// Audit 2026-09-15 (G-1).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { deriveCategorySchedule } = await import("@/lib/baseline");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `jk${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

const START = "2026-09-07"; // Senin
const WEEKS = 4;

/** Empat kategori; "Lain-lain" yang kecil tidak punya baris di Excel user. */
const KAT = [
  { key: "I", name: "PERSIAPAN", amount: 50_000_000n, weekly: [10, 0, 0, 0] },
  { key: "II", name: "STRUKTUR", amount: 695_000_000n, weekly: [0, 30, 30, 0] },
  { key: "III", name: "FINISHING", amount: 250_000_000n, weekly: [0, 0, 10, 20] },
  { key: "IV", name: "LAIN-LAIN", amount: 5_000_000n, weekly: [0, 0, 0, 0] },
];
const GRAND = KAT.reduce((s, k) => s + k.amount, 0n);
/** Kurva resmi = kumulatif Excel apa adanya: 10 / 40 / 80 / 100. */
const TITIK = [10, 40, 80, 100];

let locationId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: GRAND, signedDate: d(START), durationDays: WEEKS * 7,
      startDate: d(START), endDate: d("2026-10-04"),
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
  for (const k of KAT) {
    const kat = await db.rabNode.create({
      data: {
        revisionId: rev.id, kind: "kategori", code: k.key, name: k.name,
        amount: k.amount, lineageKey: k.key, sortOrder: sort++,
      },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: `Pekerjaan ${k.key}`,
        volume: 1, unit: "ls", unitPrice: Number(k.amount),
        amount: k.amount, lineageKey: `${k.key}#1`, sortOrder: sort++,
      },
    });
  }

  const baseline = await db.baseline.create({
    data: {
      locationId, baselineNo: 1, source: "manual", status: "aktif",
      rabRevisionId: rev.id, contractDays: WEEKS * 7,
    },
  });
  await db.baselinePoint.createMany({
    data: TITIK.map((p, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: p })),
  });
  await db.baselineScheduleItem.createMany({
    data: KAT.map((k) => ({
      baselineId: baseline.id, lineageKey: k.key, name: k.name,
      weightPct: (Number(k.amount) / Number(GRAND)) * 100,
      weekly: k.weekly,
    })),
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("satu kategori tanpa jadwal di Excel", () => {
  it("editor jadwal tetap membuka matriks TERSIMPAN, bukan jatuh ke otomatis", async () => {
    const sched = await deriveCategorySchedule(locationId);
    if (!sched) throw new Error("jadwal kategori tidak terbentuk");
    expect(sched.origin).toBe("tersimpan");
    const lain = sched.rows.find((r) => r.lineageKey === "IV");
    if (!lain) throw new Error("kategori IV hilang dari jadwal");
    // Kategori tanpa jadwal tetap KOSONG – bukan diisi sendiri oleh sistem.
    expect(lain.weekly.every((v) => v === 0)).toBe(true);
    const struktur = sched.rows.find((r) => r.lineageKey === "II")!;
    expect(struktur.weekly).toEqual([0, 30, 30, 0]);
  });

  it("tabel kategori KKP sepakat dengan kurva resmi di halaman yang sama", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T09:00:00+07:00"));
    try {
      const rep = await getPeriodReport(locationId, "mingguan", WEEKS);
      if (!rep) throw new Error("laporan periodik tidak terbentuk");
      for (let w = 0; w < WEEKS; w++) {
        const kum = rep.kurvaSchedule.reduce(
          (s, c) => s + c.weekly.slice(0, w + 1).reduce((a, b) => a + b, 0),
          0,
        );
        expect(kum, `minggu ke-${w + 1}`).toBeCloseTo(TITIK[w], 3);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
