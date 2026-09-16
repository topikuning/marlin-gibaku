// JADWAL TERSIMPAN YANG TIDAK LAGI MEMUAT SELURUH KATEGORI RAB AKTIF.
//
// Baseline membekukan satu baris jadwal per kategori SAAT ITU. RAB bisa
// bertambah kategori sesudahnya (adendum, revisi, impor ulang) tanpa baseline
// ikut dibuat ulang — dan baris kategori baru itu tidak pernah ada di matriks
// tersimpan.
//
// `deriveCategorySchedule` (src/lib/baseline.ts) sudah menuntut SETIAP kategori
// RAB aktif punya baris; `getPeriodReport` tidak — ia hanya memeriksa panjang
// baris yang KEBETULAN tersimpan. Jadi tabel kategori, ekspor Time Schedule,
// dan template "Perbarui Kurva-S" terbit dengan kategori yang hilang: bobotnya
// berhenti di bawah 100%, dan impor balik template itu akan DITOLAK sendiri oleh
// MARLIN karena kurva-S wajib tuntas 100%.
//
// Satu dokumen, dua jadwal rencana — persis yang dilarang G-1. Ditemukan saat
// menyelidiki E2E `perbarui-kurva-s.spec.ts` yang merah 2026-09-16; sebab
// kemerahan itu sendiri lain (kode kategori kembar, DECISIONS 582).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getPeriodReport } = await import("@/lib/periodic-report");
const { deriveCategorySchedule } = await import("@/lib/baseline");

const suffix = `kh${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

const START = "2026-09-07"; // Senin
const WEEKS = 4;

/** Kategori II lahir SESUDAH baseline dibuat – tidak ada di matriks tersimpan. */
const KAT = [
  { key: "I", name: "PERSIAPAN", amount: 700_000_000n, dijadwalkan: true },
  { key: "II", name: "PEKERJAAN LEVELLING LAHAN", amount: 300_000_000n, dijadwalkan: false },
];
const GRAND = KAT.reduce((s, k) => s + k.amount, 0n);

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
      packageId: pkg.id, name: "Lokasi KH", slug: `lok-${suffix}`,
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
    data: [25, 50, 75, 100].map((p, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: p })),
  });
  // HANYA kategori I yang punya baris – dan barisnya sah: panjangnya benar,
  // isinya tidak nol. Yang salah bukan barisnya, melainkan yang TIDAK ADA.
  await db.baselineScheduleItem.createMany({
    data: KAT.filter((k) => k.dijadwalkan).map((k) => ({
      baselineId: baseline.id, lineageKey: k.key, name: k.name,
      weightPct: (Number(k.amount) / Number(GRAND)) * 100,
      weekly: [10, 20, 20, 20],
    })),
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("baseline tertinggal di belakang RAB aktif", () => {
  it("tabel kategori laporan periodik tetap memuat SELURUH kategori RAB", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T09:00:00+07:00"));
    try {
      const rep = await getPeriodReport(locationId, "mingguan", WEEKS);
      if (!rep) throw new Error("laporan periodik tidak terbentuk");

      const kunci = rep.kurvaSchedule.map((c) => c.lineageKey).sort();
      expect(kunci).toEqual(["I", "II"]);

      // Dan bobotnya tuntas 100% – inilah yang membuat template hasil ekspor
      // bisa diimpor balik tanpa ditolak.
      const total = rep.kurvaSchedule.reduce(
        (s, c) => s + c.weekly.reduce((a, b) => a + b, 0),
        0,
      );
      expect(total).toBeCloseTo(100, 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("editor jadwal sepakat: dua pembaca kanonik memberi kategori yang sama", async () => {
    const sched = await deriveCategorySchedule(locationId);
    if (!sched) throw new Error("jadwal kategori tidak terbentuk");
    expect(sched.rows.map((r) => r.lineageKey).sort()).toEqual(["I", "II"]);
  });
});
