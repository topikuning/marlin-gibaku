// GANTI MODE MINGGU TIDAK BOLEH MEMBUANG JADWAL YANG SUDAH ADA (DECISIONS 427d).
//
// Pemanggilnya (`package/actions.ts`) menangkap hasil "dilewati" dengan
// `regenerateBaseline` — yang MENGHITUNG ULANG kurva dari jendela otomatis dan
// dengan itu membuang jadwal impor Excel maupun editan manual. Jadi setiap
// alasan "dilewati" yang bukan benar-benar kosong adalah kehilangan data.
//
// Alasan yang nyata: panjang grid LAMA dihitung ulang dari tanggal kontrak,
// sementara baseline yang tersimpan dibuat oleh penghitung minggu yang lain
// (`totalWeeksFor` = ceil(durasi/7)). Selisih satu kolom sudah cukup.
// Audit 2026-09-15 (G-2).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { konversiBaselineModeMinggu } = await import("@/lib/baseline");

const suffix = `kg${Date.now().toString(36)}`;
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** Durasi kelipatan 7 — kasus yang membuat dua penghitung berselisih satu. */
const DURASI = 119;
/** Yang TERSIMPAN: 17 minggu (ceil(119/7)). */
const MINGGU_TERSIMPAN = 17;
/** Yang dihitung ulang dari tanggal: 18 minggu. */
const MINGGU_DIHITUNG = 18;

const KAT = [
  { key: "I", name: "PERSIAPAN", bobot: 20 },
  { key: "II", name: "STRUKTUR", bobot: 80 },
];

let locationId = "";
let userId = "";

/** Jadwal IMPOR: seluruh bobot kategori menumpuk di satu minggu tertentu. */
function weeklyImpor(bobot: number, mingguIsi: number): number[] {
  const w = new Array<number>(MINGGU_TERSIMPAN).fill(0);
  w[mingguIsi - 1] = bobot;
  return w;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: 100_000_000n, signedDate: d("2026-03-05"), durationDays: DURASI,
      startDate: d("2026-03-05"), endDate: d("2026-07-02"), weekMode: "tujuh_hari",
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi KG", slug: `lok-${suffix}`,
      village: "Desa", regency: "Kab", province: "Prov",
    },
  });
  locationId = loc.id;

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  const baseline = await db.baseline.create({
    data: {
      locationId, baselineNo: 1, source: "manual", status: "aktif",
      rabRevisionId: rev.id, contractDays: DURASI, note: "Impor Excel apa adanya",
    },
  });
  // Kurva = Σ matriks: 20% tuntas di M4, sisanya di M12.
  const kum: number[] = [];
  let acc = 0;
  for (let w = 1; w <= MINGGU_TERSIMPAN; w++) {
    if (w === 4) acc += 20;
    if (w === 12) acc += 80;
    kum.push(acc);
  }
  await db.baselinePoint.createMany({
    data: kum.map((p, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: p })),
  });
  await db.baselineScheduleItem.createMany({
    data: [
      { baselineId: baseline.id, lineageKey: "I", name: KAT[0].name, weightPct: 20, weekly: weeklyImpor(20, 4) },
      { baselineId: baseline.id, lineageKey: "II", name: KAT[1].name, weightPct: 80, weekly: weeklyImpor(80, 12) },
    ],
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("konversi grid minggu saat dua penghitung berselisih satu kolom", () => {
  it("jadwal impor DIKONVERSI, bukan diserahkan ke hitung-ulang otomatis", async () => {
    const hasil = await konversiBaselineModeMinggu(locationId, {
      // Grid lama menurut tanggal = 18, sementara yang tersimpan 17.
      oldEndFracs: null,
      oldTotalWeeks: MINGGU_DIHITUNG,
      newEndFracs: null,
      newTotalWeeks: MINGGU_DIHITUNG,
      userId,
      note: "Uji konversi",
    });
    expect(hasil).toBe("dikonversi");

    const baru = await db.baseline.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: {
        scheduleItems: { select: { lineageKey: true, weekly: true } },
        points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } },
      },
    });
    expect(baru.points).toHaveLength(MINGGU_DIHITUNG);
    expect(Number(baru.points[baru.points.length - 1].plannedPct)).toBeCloseTo(100, 3);

    // Bobot tiap kategori UTUH – tidak ada yang hilang dalam pemindahan grid.
    const byKey = new Map(baru.scheduleItems.map((s) => [s.lineageKey, s.weekly as number[]]));
    for (const k of KAT) {
      const w = byKey.get(k.key);
      if (!w) throw new Error(`kategori ${k.key} hilang dari jadwal`);
      expect(w).toHaveLength(MINGGU_DIHITUNG);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(k.bobot, 3);
    }

    // Dan bentuknya tetap bertumpuk, bukan disebar rata oleh generator otomatis:
    // kategori II masih menyelesaikan seluruh bobotnya dalam satu–dua minggu.
    const ii = byKey.get("II")!;
    expect(ii.filter((v) => v > 1e-6).length).toBeLessThanOrEqual(2);
  });
});
