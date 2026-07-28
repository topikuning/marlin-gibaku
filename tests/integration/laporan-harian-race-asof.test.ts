// TEST-01 — dua lubang yang belum tertutup uji:
//
// 1. RACE SUBMIT PARALEL (CALC-02). Guard volume membaca AGREGAT laporan LAIN
//    lalu menulis status laporan INI. Optimistic lock `where: {id, status}`
//    hanya melindungi baris yang sama, jadi dua laporan BERBEDA di lokasi yang
//    sama bisa lolos bersamaan dan total counted melampaui volume RAB.
//    Penutupnya advisory lock per lokasi; uji ini menjalankan dua submit
//    BERSAMAAN dan menuntut tepat satu gagal.
//
// 2. GOLDEN TEST AS-OF (CALC-01). Snapshot laporan final harus memotret progres
//    PADA TANGGAL LAPORAN, bukan progres hari ini. Uji ini memfinalkan laporan
//    lama SESUDAH ada laporan yang lebih baru, lalu menuntut angkanya tetap
//    angka tanggal itu.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { getOrCreateDraft, upsertItem, submitReport, approveReport, finalizeReport } = await import(
  "@/lib/daily-report/service"
);
const { getLocationProgress } = await import("@/lib/progress");

const suffix = `ra${Date.now().toString(36)}`;
let userId: string;
let orgId: string;
let nomor = 0;

/**
 * Tiap blok uji memakai LOKASI SENDIRI. Kalau berbagi satu lokasi, volume yang
 * terpakai di uji race akan menghabiskan kuota RAB dan membuat uji as-of gagal
 * bukan karena bugnya — kegagalan palsu yang menyesatkan.
 */
async function buatLokasi() {
  const tag = `${suffix}-${++nomor}`;
  const pkg = await db.package.create({ data: { orgId, name: `Paket RA ${tag}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor RA ${tag}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${tag}`,
      contractValue: 100_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 153,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-11-01"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi RA ${tag}`,
      slug: `lokasi-${tag}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  const rev = await db.rabRevision.create({
    data: {
      locationId: loc.id,
      revisionNo: 1,
      source: "hps_awal",
      status: "aktif",
      totalValue: 100_000_000n,
      // Back-date: revisi harus SUDAH ADA pada tanggal yang diuji as-of.
      // Perhitungan as-of sengaja memakai revisi yang efektif saat itu, jadi
      // revisi yang dibuat belakangan memang tidak berlaku surut.
      createdAt: new Date("2026-06-01T00:00:00Z"),
    },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      kind: "kategori",
      code: "I",
      name: "PEKERJAAN UJI",
      amount: 100_000_000n,
      lineageKey: "I",
      sortOrder: 1,
    },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kat.id,
      kind: "item",
      code: "1",
      name: "Pasangan batu",
      volume: 100,
      unit: "m3",
      unitPrice: 1_000_000,
      amount: 100_000_000n,
      lineageKey: "I#1",
      sortOrder: 2,
    },
  });
  return { locationId: loc.id, nodeId: node.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RA ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const user = await db.user.create({
    data: { orgId: org.id, username: `ra-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

/** Siapkan satu laporan draft berisi `volume` m3 pada tanggal tertentu. */
async function draftDenganVolume(lok: { locationId: string; nodeId: string }, dateKey: string, volume: number) {
  const draft = await getOrCreateDraft(lok.locationId, dateKey, userId);
  await upsertItem(draft.id, { rabNodeId: lok.nodeId, volumeDone: volume }, userId);
  return draft;
}

describe("CALC-02 — dua submit PARALEL di satu lokasi tidak boleh sama-sama lolos", () => {
  it("dua laporan BERBEDA masing-masing 60 m3 atas RAB 100 m3 → tepat satu ditolak", async () => {
    const lok = await buatLokasi();
    const a = await draftDenganVolume(lok, "2026-07-10", 60);
    const b = await draftDenganVolume(lok, "2026-07-11", 60);

    const hasil = await Promise.allSettled([submitReport(a.id, userId), submitReport(b.id, userId)]);
    const sukses = hasil.filter((r) => r.status === "fulfilled");
    const gagal = hasil.filter((r) => r.status === "rejected");

    expect(sukses, "tepat satu submit boleh lolos").toHaveLength(1);
    expect(gagal, "yang satunya harus ditolak guard volume").toHaveLength(1);

    // Total volume berstatus counted tidak boleh melampaui volume RAB.
    const counted = await db.dailyReportItem.aggregate({
      where: {
        lineageKey: "I#1",
        report: { locationId: lok.locationId, status: { in: ["dikirim", "disetujui", "final"] } },
      },
      _sum: { volumeDone: true },
    });
    expect(Number(counted._sum.volumeDone ?? 0)).toBeLessThanOrEqual(100);
  });
});

describe("CALC-01 — snapshot final memotret progres PADA TANGGAL LAPORAN", () => {
  let lok: { locationId: string; nodeId: string };
  let idLama: string;

  it("laporan lama difinalkan setelah ada laporan baru → angkanya tetap angka tanggal itu", async () => {
    lok = await buatLokasi();
    // Laporan LAMA 20 m3 (20%), lalu laporan BARU 30 m3 (kumulatif 50%).
    const lama = await draftDenganVolume(lok, "2026-07-05", 20);
    idLama = lama.id;
    await submitReport(lama.id, userId);
    await approveReport(lama.id, userId);

    const baru = await draftDenganVolume(lok, "2026-07-20", 30);
    await submitReport(baru.id, userId);
    await approveReport(baru.id, userId);

    // Progres "sekarang" sudah 50% — pembanding supaya salah-hitung terlihat.
    const sekarang = await getLocationProgress(lok.locationId);
    expect(sekarang.realizedPct).toBeCloseTo(50, 3);

    // Finalisasi laporan LAMA dilakukan BELAKANGAN.
    await finalizeReport(lama.id, userId);
    const row = await db.dailyReport.findUniqueOrThrow({
      where: { id: idLama },
      select: { finalSnapshot: true },
    });
    const snap = row.finalSnapshot as unknown as { progress: { realizedPct: number } };

    expect(snap.progress.realizedPct, "snapshot harus 20% (as-of 5 Juli), bukan 50%").toBeCloseTo(20, 3);
  });

  it("getLocationProgress dengan asOf mengembalikan angka tanggal itu, bukan hari ini", async () => {
    const perTanggalLama = await getLocationProgress(lok.locationId, { asOf: new Date("2026-07-05T00:00:00Z") });
    const perTanggalBaru = await getLocationProgress(lok.locationId, { asOf: new Date("2026-07-20T00:00:00Z") });
    expect(perTanggalLama.realizedPct).toBeCloseTo(20, 3);
    expect(perTanggalBaru.realizedPct).toBeCloseTo(50, 3);
  });
});
