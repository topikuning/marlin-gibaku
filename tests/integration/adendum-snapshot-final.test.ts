// AKTIVASI ADENDUM HARUS IKUT MEMBANGUN ULANG BLANKO HARIAN YANG SUDAH FINAL.
//
// `sesuaikanRealisasiKeVolumeBaru` (DECISIONS 507) menurunkan volumeDone laporan
// harian yang melebihi volume kontrak barunya — termasuk laporan berstatus
// FINAL. Tetapi blanko harian final TIDAK dibaca dari baris DB: ia dibaca dari
// `finalSnapshot` yang beku. Tanpa pembangunan ulang, dokumen yang justru jadi
// alasan fitur itu ("blanko harian menuliskan 45,7 m³ terpasang atas baris
// kontrak 32,15 m³") tetap salah, sementara laporan mingguan dan progres sudah
// memakai angka baru. Satu sistem, dua angka. Audit 2026-09-15 (B-4).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { activateRevision } = await import("@/lib/rab/import");
const { buildFinalSnapshot } = await import("@/lib/daily-report/service");

const suffix = `sf${Date.now().toString(36)}`;
/*
 * lineageKey yang UNIK untuk berkas uji ini. Uji tetangga
 * (`adendum-sesuaikan-realisasi`) mencari barisnya dengan `where: { lineageKey }`
 * tanpa menyaring lokasi, jadi memakai "I#1" yang sama membuat dua berkas uji
 * saling menghitung baris milik yang lain.
 */
const LK = "I#SF1";
const HARGA = 88_734.87;
let locationId = "";
let userId = "";
let draftRevId = "";
let finalReportId = "";

async function buatRevisi(revisionNo: number, status: "aktif" | "draft", volume: number) {
  const rev = await db.rabRevision.create({
    data: {
      locationId, revisionNo, source: revisionNo === 1 ? "hps_awal" : "adendum", status,
      totalValue: BigInt(Math.round(volume * HARGA)),
    },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN TANAH",
      amount: BigInt(Math.round(volume * HARGA)), lineageKey: "I", sortOrder: 1,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1", name: "Galian Tanah",
      volume, unit: "m3", unitPrice: HARGA,
      amount: BigInt(Math.round(volume * HARGA)), lineageKey: LK, sortOrder: 2,
    },
    select: { id: true },
  });
  return { revId: rev.id, itemId: item.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `u-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
    select: { id: true },
  });
  userId = user.id;
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
    select: { id: true },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi SF", slug: `lokasi-sf-${suffix}`,
      village: "V", regency: "K", province: "P", status: "berjalan", isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;

  const aktif = await buatRevisi(1, "aktif", 45.7);

  // Tiga hari, total 45,7 – yang terakhir FINAL dan snapshotnya sudah dibekukan.
  for (const [tgl, vol] of [["2026-08-10", 20], ["2026-08-12", 15.7], ["2026-08-15", 10]] as const) {
    const rep = await db.dailyReport.create({
      data: {
        locationId, reportDate: new Date(`${tgl}T00:00:00.000Z`),
        status: tgl === "2026-08-15" ? "final" : "disetujui", createdById: userId,
      },
      select: { id: true },
    });
    await db.dailyReportItem.create({
      data: {
        reportId: rep.id, rabNodeId: aktif.itemId, lineageKey: LK, basis: "aktif",
        volumeDone: vol, valueDone: BigInt(Math.round(vol * HARGA)), reportedById: userId,
      },
    });
    if (tgl === "2026-08-15") {
      finalReportId = rep.id;
      const snap = await buildFinalSnapshot(rep.id);
      await db.dailyReport.update({
        where: { id: rep.id },
        data: { finalSnapshot: snap as never },
      });
    }
  }

  draftRevId = (await buatRevisi(2, "draft", 32.1493)).revId;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

type SnapItem = { lineageKey: string; volumeToday: number; volumeCumulative: number };

async function itemSnapshot(): Promise<SnapItem[]> {
  const r = await db.dailyReport.findUniqueOrThrow({
    where: { id: finalReportId },
    select: { finalSnapshot: true },
  });
  return (r.finalSnapshot as unknown as { items: SnapItem[] }).items;
}

describe("blanko harian FINAL sesudah aktivasi adendum", () => {
  it("sebelum aktivasi, snapshot memuat angka lama", async () => {
    const items = await itemSnapshot();
    const it = items.find((i) => i.lineageKey === LK)!;
    expect(it.volumeToday).toBeCloseTo(10, 6);
    expect(it.volumeCumulative).toBeCloseTo(45.7, 6);
  });

  it("sesudah aktivasi, snapshot SAMA dengan baris di basis data", async () => {
    await activateRevision(draftRevId, userId);

    const baris = await db.dailyReportItem.findFirstOrThrow({
      where: { reportId: finalReportId, lineageKey: LK },
      select: { volumeDone: true },
    });
    const items = await itemSnapshot();
    const it = items.find((i) => i.lineageKey === LK)!;

    // Inilah invariannya: dokumen beku dan baris hidup menyebut angka yang sama.
    expect(it.volumeToday).toBeCloseTo(Number(baris.volumeDone), 6);
    // Dan kumulatifnya tidak lagi melebihi volume kontrak baru.
    expect(it.volumeCumulative).toBeLessThanOrEqual(32.1493 + 1e-6);
  });

  it("aktivasi melaporkan penyesuaiannya, bukan menyimpannya di audit saja", async () => {
    // DECISIONS 203: penyesuaian angka pengguna wajib DIKATAKAN.
    const rev = await db.rabRevision.findFirstOrThrow({
      where: { locationId, status: "aktif" },
      select: { revisionNo: true },
    });
    expect(rev.revisionNo).toBe(2);
    const jejak = await db.auditLog.findFirst({
      where: { action: "rab.revision_activate" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const p = jejak?.payload as { itemDisesuaikan?: number; snapshotDibangunUlang?: number } | null;
    expect(p?.itemDisesuaikan).toBe(1);
    expect(p?.snapshotDibangunUlang).toBeGreaterThanOrEqual(1);
  });
});
