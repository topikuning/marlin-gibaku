// LAPORAN HARIAN MENYESUAIKAN VOLUME BARU saat adendum diaktifkan.
//
// Permintaan user 2026-09-03: "saat pemetaan manual itu konfirmasi, maka
// laporan harian yang sebelumnya langsung menyesuaikan volume baru."
//
// Dijalankan saat AKTIVASI, bukan saat pemetaan dikonfirmasi: di titik itu
// adendumnya masih draft dan belum ditandatangani siapa pun, jadi mengubah
// laporan harian akan menggerakkan angka resmi atas dasar yang belum sah
// (DECISIONS 210).
//
// Pembagiannya PROPORSIONAL (keputusan user atas dua pilihan), dan laporan
// berstatus `final` IKUT disesuaikan - melewatinya hanya memindahkan
// ketidakcocokan, bukan menghilangkannya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
// WAJIB: `audit()` memanggil `headers()` untuk merekam IP. Tanpa mock ini ia
// gagal di luar request scope dan ditelan diam-diam, sehingga asersi audit di
// bawah mustahil hijau - pelajaran dari PR #243/#244.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { activateRevision } = await import("@/lib/rab/import");

const suffix = `sr${Date.now().toString(36)}`;
let locationId = "";
let userId = "";
let draftRevId = "";
const LK = "I#1";

/** 45,7 terkumpul dari tiga hari - bentuk yang sebenarnya di lapangan. */
const HARIAN: [string, number][] = [
  ["2026-08-10", 20],
  ["2026-08-12", 15.7],
  ["2026-08-15", 10],
];

async function buatRevisi(revisionNo: number, status: "aktif" | "draft", volume: number) {
  const rev = await db.rabRevision.create({
    data: {
      locationId,
      revisionNo,
      source: revisionNo === 1 ? "hps_awal" : "adendum",
      status,
      totalValue: BigInt(Math.round(volume * 88_734.87)),
    },
    select: { id: true },
  });
  const kat = await db.rabNode.create({
    data: {
      revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN TANAH",
      amount: BigInt(Math.round(volume * 88_734.87)), lineageKey: "I", sortOrder: 1,
    },
    select: { id: true },
  });
  const item = await db.rabNode.create({
    data: {
      revisionId: rev.id, parentId: kat.id, kind: "item", code: "1",
      name: "Pekerjaan Galian Tanah sampai dengan 1 m",
      volume, unit: "m3", unitPrice: 88_734.87,
      amount: BigInt(Math.round(volume * 88_734.87)), lineageKey: LK, sortOrder: 2,
    },
    select: { id: true },
  });
  return { revId: rev.id, itemId: item.id };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org SR ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `sr-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
    select: { id: true },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket SR ${suffix}`, stage: "pelaksanaan" }, select: { id: true } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id, name: "Lokasi SR", slug: `lokasi-sr-${suffix}`,
      village: "V", regency: "K", province: "P", status: "berjalan", isActive: true,
    },
    select: { id: true },
  });
  locationId = loc.id;

  // RAB aktif: item bervolume 45,7 - persis kasus user.
  const aktif = await buatRevisi(1, "aktif", 45.7);

  // Laporan harian: tiga hari, total 45,7. Yang terakhir dibuat FINAL supaya
  // keputusan "laporan final ikut disesuaikan" benar-benar teruji.
  for (const [tgl, vol] of HARIAN) {
    const rep = await db.dailyReport.create({
      data: {
        locationId, reportDate: new Date(`${tgl}T00:00:00.000Z`),
        status: tgl === "2026-08-15" ? "final" : "disetujui", createdById: userId,
      },
      select: { id: true },
    });
    await db.dailyReportItem.create({
      data: {
        reportId: rep.id, rabNodeId: aktif.itemId, lineageKey: LK,
        basis: "aktif", volumeDone: vol,
        valueDone: BigInt(Math.round(vol * 88_734.87)), reportedById: userId,
      },
    });
  }

  // Draft adendum: item yang sama, volumenya turun jadi 32,15.
  draftRevId = (await buatRevisi(2, "draft", 32.1493)).revId;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("KASUS INTI: realisasi turun mengikuti volume adendum", () => {
  it("sebelum aktivasi, laporan masih memakai angka lamanya", async () => {
    const rows = await db.dailyReportItem.findMany({ where: { lineageKey: LK }, select: { volumeDone: true } });
    const total = rows.reduce((t, r) => t + Number(r.volumeDone), 0);
    expect(Math.round(total * 1000) / 1000).toBe(45.7);
  });

  it("aktivasi membagi rata turun ke 32,149 dan menjumlah PERSIS", async () => {
    await activateRevision(draftRevId, userId);
    const rows = await db.dailyReportItem.findMany({
      where: { lineageKey: LK },
      select: { volumeDone: true, valueDone: true, report: { select: { reportDate: true, status: true } } },
      orderBy: { report: { reportDate: "asc" } },
    });
    const total = rows.reduce((t, r) => t + Number(r.volumeDone), 0);
    expect(Math.round(total * 1000) / 1000).toBe(32.149);

    // Proporsional: urutan besar-kecilnya tetap, tidak ada hari yang dinihilkan.
    const vols = rows.map((r) => Number(r.volumeDone));
    expect(vols[0]).toBeGreaterThan(vols[1]!);
    expect(vols[1]).toBeGreaterThan(vols[2]!);
    expect(vols.every((v) => v > 0)).toBe(true);
  });

  it("laporan FINAL ikut disesuaikan, tidak dilewati", async () => {
    const fin = await db.dailyReportItem.findFirstOrThrow({
      where: { lineageKey: LK, report: { status: "final" } },
      select: { volumeDone: true },
    });
    expect(Number(fin.volumeDone)).toBeLessThan(10);
  });

  it("valueDone ikut dihitung ulang, tidak tertinggal di angka lama", async () => {
    const rows = await db.dailyReportItem.findMany({
      where: { lineageKey: LK },
      select: { volumeDone: true, valueDone: true },
    });
    for (const r of rows) {
      expect(Number(r.valueDone)).toBe(Math.round(Number(r.volumeDone) * 88_734.87));
    }
  });

  it("audit menyebut angka sebelum dan sesudah, plus tanggal barisnya", async () => {
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "rab.adendum_sesuaikan_realisasi" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const p = log.payload as {
      lineageKey?: string;
      totalSebelum?: number;
      totalSesudah?: number;
      baris?: { tanggal: string; status: string; dari: number; ke: number }[];
    };
    expect(p.lineageKey).toBe(LK);
    expect(Math.round((p.totalSebelum ?? 0) * 1000) / 1000).toBe(45.7);
    expect(Math.round((p.totalSesudah ?? 0) * 1000) / 1000).toBe(32.149);
    expect(p.baris).toHaveLength(3);
    expect(p.baris?.some((b) => b.status === "final")).toBe(true);
  });
});
