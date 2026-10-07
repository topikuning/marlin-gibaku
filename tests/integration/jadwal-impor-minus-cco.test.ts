// JADWAL IMPOR DENGAN NILAI MINUS SESUDAH CCO (DECISIONS baru 2026-10-07).
//
// Keputusan user: *"supaya lebih flexibel mungkin ijinkan saja minus importnya
// yg penting jumlah totalnya 100%"*. Minggu yang sudah terlapor tidak diubah;
// bobot yang turun karena CCO diserap minggu sesudahnya, jadi satu pekerjaan –
// kadang total satu minggu – bisa minus (contoh nyata: Time Schedule KNMP
// Sidorejo–Batang, Levelling Lahan M12 −0,839).
//
// Yang dijaga lewat jalur simpan SUNGGUHAN (`saveCategoryWeekly`):
//   1. sel minus tersimpan apa adanya di jadwal kategori baseline;
//   2. kurva resmi = kumulatif Excel, boleh turun di minggu itu, berakhir 100;
//   3. editor jadwal dan tabel kategori blanko KKP membaca matriks yang sama,
//      termasuk minusnya – tidak jatuh ke jadwal otomatis;
//   4. kumulatif yang lewat 100% di tengah jalan tetap ditolak, baseline lama
//      tidak tersentuh.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { saveCategoryWeekly, deriveCategorySchedule } = await import("@/lib/baseline");
const { getPeriodReport } = await import("@/lib/periodic-report");

const suffix = `jm${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const START = "2026-09-07"; // Senin
const WEEKS = 4;

const KAT = [
  { key: "I", name: "PERSIAPAN", amount: 100_000_000n },
  { key: "II", name: "STRUKTUR", amount: 700_000_000n },
  { key: "III", name: "LEVELLING", amount: 200_000_000n },
];
const GRAND = KAT.reduce((s, k) => s + k.amount, 0n);

/** Levelling minggu 3 = −8: rencana yang sudah terlapor dikoreksi sesudah CCO. */
const EXCEL = [
  { lineageKey: "I", weekly: [10, 0, 0, 0] },
  { lineageKey: "II", weekly: [0, 30, 20, 20] },
  { lineageKey: "III", weekly: [0, 20, -8, 8] },
];

let locationId = "";
let userId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  userId = (
    await db.user.create({ data: { orgId: org.id, username: `u-${suffix}`, fullName: "Penguji", passwordHash: "x", role: "super_admin" } })
  ).id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: GRAND, signedDate: d(START), durationDays: WEEKS * 7,
      startDate: d(START), endDate: d("2026-10-04"),
    },
  });
  locationId = (
    await db.location.create({
      data: { packageId: pkg.id, name: "Lokasi Minus", slug: `lok-${suffix}`, village: "Desa", regency: "Kab", province: "Prov" },
    })
  ).id;
  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: GRAND },
  });
  let sort = 0;
  for (const k of KAT) {
    const kat = await db.rabNode.create({
      data: { revisionId: rev.id, kind: "kategori", code: k.key, name: k.name, amount: k.amount, lineageKey: k.key, sortOrder: sort++ },
    });
    await db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: `Pekerjaan ${k.key}`,
        volume: 1, unit: "ls", unitPrice: Number(k.amount), amount: k.amount, lineageKey: `${k.key}#1`, sortOrder: sort++,
      },
    });
  }
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("impor jadwal ber-minus", () => {
  it("kumulatif yang lewat 100% di tengah jalan ditolak; belum ada baseline yang dibuat", async () => {
    await expect(
      saveCategoryWeekly(
        locationId,
        [
          { lineageKey: "I", weekly: [10, 0, 0, 0] },
          { lineageKey: "II", weekly: [0, 95, 0, -25] },
          { lineageKey: "III", weekly: [0, 0, 20, 0] },
        ],
        userId,
        "uji",
        "apaadanya",
      ),
    ).rejects.toThrow(/minggu 2.*105/);
    expect(await db.baseline.count({ where: { locationId } })).toBe(0);
  });

  it("disimpan apa adanya: sel minus utuh, kurva resmi boleh turun dan tuntas 100%", async () => {
    const h = await saveCategoryWeekly(locationId, EXCEL, userId, "Impor jadwal sesudah CCO", "apaadanya");
    expect(h.verbatim?.selMinus).toEqual([{ name: "LEVELLING", minggu: [3] }]);
    expect(h.verbatim?.mingguTurun).toEqual([]);
    const b = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      include: { points: { orderBy: { weekNumber: "asc" } }, scheduleItems: true },
    });
    expect(b.points.map((p) => Number(p.plannedPct))).toEqual([10, 60, 72, 100]);
    const lev = b.scheduleItems.find((s) => s.lineageKey === "III")!;
    expect(lev.weekly).toEqual([0, 20, -8, 8]);
  });

  it("editor jadwal dan tabel kategori KKP membaca matriks yang sama, termasuk minusnya", async () => {
    const sched = await deriveCategorySchedule(locationId);
    expect(sched?.origin).toBe("tersimpan");
    expect(sched?.rows.find((r) => r.lineageKey === "III")?.weekly).toEqual([0, 20, -8, 8]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T09:00:00+07:00"));
    try {
      const rep = await getPeriodReport(locationId, "mingguan", WEEKS);
      if (!rep) throw new Error("laporan periodik tidak terbentuk");
      expect(rep.kurvaSchedule.find((c) => c.lineageKey === "III")?.weekly).toEqual([0, 20, -8, 8]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kurva yang turun di satu minggu diterima dan minggunya dilaporkan", async () => {
    const h = await saveCategoryWeekly(
      locationId,
      [
        { lineageKey: "I", weekly: [10, 0, 0, 0] },
        { lineageKey: "II", weekly: [0, 50, -8, 28] },
        { lineageKey: "III", weekly: [0, 0, 5, 15] },
      ],
      userId,
      "Impor jadwal – kurva turun",
      "apaadanya",
    );
    expect(h.verbatim?.mingguTurun).toEqual([3]);
    const b = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      include: { points: { orderBy: { weekNumber: "asc" } } },
    });
    expect(b.points.map((p) => Number(p.plannedPct))).toEqual([10, 60, 57, 100]);
  });
});
