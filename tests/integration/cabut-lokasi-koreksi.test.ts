// KOREKSI SUSUNAN LOKASI HARUS BISA DUA ARAH.
//
// `correctAddLocationAction` (DECISIONS 187) sudah ada sejak lama: paket yang
// SUDAH berkontrak boleh ditambahi lokasi yang terlewat, sebagai koreksi data —
// bukan adendum. Pasangannya tidak pernah dibuat. Begitu paket dikonversi ke
// kontrak, SEMUA lokasinya jadi `isActive` sekaligus mendapat baris
// `LocationStatusHistory`, dan `removeTargetLocation` menolak keduanya. Jadi
// lokasi yang salah masuk ke paket berkontrak TIDAK BISA dikeluarkan lewat layar
// mana pun — hanya lewat basis data.
//
// Kasus nyata user 2026-09-16: desa Kemadang berjalan di Paket A, lalu ikut
// terpilih sebagai lokasi awal Paket B dan Paket B sudah dikonversi ke kontrak.
// Yang di Paket B kosong, tapi tidak bisa dibuang — dan selama ia ada,
// perpindahan Kemadang dari A ke B ditolak guard nama kembar (DECISIONS 581).
//
// Yang diuji di sini: jalurnya ADA, dan pengamannya benar-benar menggigit.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { correctRemoveLocationAction } = await import("@/lib/package/actions");

const suffix = `cl${Date.now().toString(36)}`;
const ALASAN = "Desa ini sudah berjalan di paket lain – salah pilih saat paket dibuat.";

let packageId = "";
let kosongId = "";
let berisiId = "";

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

/** Lokasi AKTIF ber-riwayat – persis bentuk lokasi sesudah konversi kontrak. */
async function buatLokasiAktif(nama: string) {
  const loc = await db.location.create({
    data: {
      packageId,
      name: nama,
      slug: `${nama}-${suffix}`.toLowerCase().replace(/\s+/g, "-"),
      village: nama,
      regency: "Gunungkidul",
      province: "DI Yogyakarta",
      status: "persiapan",
      isActive: true,
    },
    select: { id: true },
  });
  await db.locationStatusHistory.create({
    data: { locationId: loc.id, fromStatus: null, toStatus: "persiapan", changedById: sessionUserId },
  });
  return loc.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  sessionOrgId = org.id;
  sessionUserId = (
    await db.user.create({
      data: { orgId: org.id, username: `u-${suffix}`, fullName: "Admin", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    })
  ).id;

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT ${suffix}` } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket B ${suffix}`, stage: "pelaksanaan" },
  });
  packageId = pkg.id;
  await db.contract.create({
    data: {
      packageId: pkg.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`,
      contractValue: 500_000_000n, signedDate: new Date("2026-08-01"), durationDays: 90,
      startDate: new Date("2026-08-01"), endDate: new Date("2026-10-29"),
    },
  });

  kosongId = await buatLokasiAktif("Kemadang");
  berisiId = await buatLokasiAktif("Ngestirejo");
  // Yang berisi: satu revisi RAB saja sudah cukup membuatnya tidak boleh dicabut.
  await db.rabRevision.create({
    data: { locationId: berisiId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 1_000n },
  });
});

beforeEach(() => {
  role = "super_admin";
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("cabut lokasi dari paket berkontrak (koreksi data)", () => {
  it("lokasi yang BERISI ditolak, dan penyebabnya disebut", async () => {
    const r = await correctRemoveLocationAction(
      undefined,
      fd({ locationId: berisiId, reason: ALASAN }),
    );
    expect(r?.error ?? "").toMatch(/RAB/i);
    expect(await db.location.count({ where: { id: berisiId } })).toBe(1);
  });

  it("alasan wajib – koreksi tanpa jejak sama saja dengan penghapusan diam-diam", async () => {
    const r = await correctRemoveLocationAction(undefined, fd({ locationId: kosongId, reason: "singkat" }));
    expect(r?.error ?? "").toMatch(/[Aa]lasan/);
    expect(await db.location.count({ where: { id: kosongId } })).toBe(1);
  });

  it("bukan super admin DITOLAK walau lokasinya kosong", async () => {
    role = "project_manager";
    // `requireCapability` melempar, seperti seluruh aksi lain di berkas ini –
    // yang diuji bahwa penolakannya terjadi SEBELUM apa pun dihapus.
    await expect(
      correctRemoveLocationAction(undefined, fd({ locationId: kosongId, reason: ALASAN })),
    ).rejects.toThrow(/location\.correct/);
    expect(await db.location.count({ where: { id: kosongId } })).toBe(1);
  });

  it("lokasi kosong dicabut – riwayat statusnya ikut, jejaknya tertinggal", async () => {
    const r = await correctRemoveLocationAction(
      undefined,
      fd({ locationId: kosongId, reason: ALASAN }),
    );
    expect(r?.error).toBeUndefined();
    expect(r?.success ?? "").toMatch(/Kemadang/);

    expect(await db.location.count({ where: { id: kosongId } })).toBe(0);
    expect(await db.locationStatusHistory.count({ where: { locationId: kosongId } })).toBe(0);

    // Jejaknya ada di DUA tempat: lini masa paket dan audit log.
    const histori = await db.packageStageHistory.findFirst({
      where: { packageId, note: { contains: "Kemadang" } },
      select: { note: true },
    });
    if (!histori) throw new Error("koreksi tidak tercatat di histori paket");
    expect(histori.note).toContain(ALASAN);

    const jejak = await db.auditLog.findFirst({
      where: { action: "package.location_correct_remove", resourceId: packageId },
      select: { id: true },
    });
    expect(jejak).not.toBeNull();

    // Lokasi lain di paket yang sama tidak tersentuh.
    expect(await db.location.count({ where: { id: berisiId } })).toBe(1);
  });
});

/*
 * Pelonggaran cascade di migrasi 20260916120000 hanya sah kalau jaminan
 * append-only-nya TIDAK ikut longgar. Dua uji berikut yang menjaganya; tanpa
 * mereka, "DELETE boleh sebagai ikutan" bisa melebar jadi "DELETE boleh".
 */
describe("riwayat status lokasi tetap append-only", () => {
  it("DELETE langsung DITOLAK selama lokasinya masih ada", async () => {
    await expect(
      db.locationStatusHistory.deleteMany({ where: { locationId: berisiId } }),
    ).rejects.toThrow(/append-only/i);
    expect(await db.locationStatusHistory.count({ where: { locationId: berisiId } })).toBe(1);
  });

  it("UPDATE DITOLAK, titik – koreksi status = baris baru", async () => {
    await expect(
      db.locationStatusHistory.updateMany({
        where: { locationId: berisiId },
        data: { toStatus: "berjalan" },
      }),
    ).rejects.toThrow(/append-only/i);
  });
});
