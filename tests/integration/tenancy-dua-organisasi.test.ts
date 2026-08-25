// TEST-01 — MATRIKS NEGATIF DUA ORGANISASI.
//
// Model deployment yang dipilih (DECISIONS 162) adalah satu instalasi = satu
// organisasi = satu database, jadi hari ini kebocoran lintas-organisasi tidak
// mungkin terjadi di produksi. Justru karena itu uji ini penting: tanpa data
// dua organisasi di satu database, scoping `orgId` yang baru dipasang TIDAK
// PERNAH benar-benar diuji — ia terlihat "lulus" hanya karena tidak ada tetangga.
//
// Uji ini membuat DUA organisasi lengkap di satu database dan menuntut:
//   · peran lintas-lokasi (super_admin) TIDAK melihat lokasi organisasi lain;
//   · `hasLocationAccess` menolak lokasi organisasi lain walau id-nya ditebak;
//   · where-clause scope tidak pernah kosong untuk peran lintas-lokasi.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { hasLocationAccess, accessibleLocationIds } = await import("@/lib/auth/session");
const { locationScopeWhere, locationRelScopeWhere } = await import("@/lib/auth/scope");

const suffix = `td${Date.now().toString(36)}`;

async function buatOrg(tag: string) {
  const org = await db.organization.create({ data: { name: `Org ${tag} ${suffix}`, slug: `org-${tag}-${suffix}` } });
  const adminRow = await db.user.create({
    data: {
      orgId: org.id,
      username: `admin-${tag}-${suffix}`,
      fullName: `Admin ${tag}`,
      passwordHash: "x",
      role: "super_admin",
    },
  });
  const smRow = await db.user.create({
    data: {
      orgId: org.id,
      username: `sm-${tag}-${suffix}`,
      fullName: `SM ${tag}`,
      passwordHash: "x",
      role: "site_manager",
    },
  });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${tag} ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${tag}`,
      slug: `lokasi-${tag}-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  await db.locationAssignment.create({ data: { userId: smRow.id, locationId: loc.id } });
  const sesi = (u: typeof adminRow) => ({
    id: u.id,
    orgId: u.orgId,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  });
  return { org, admin: sesi(adminRow), sm: sesi(smRow), locationId: loc.id, packageId: pkg.id };
}

let A: Awaited<ReturnType<typeof buatOrg>>;
let B: Awaited<ReturnType<typeof buatOrg>>;

beforeAll(async () => {
  A = await buatOrg("a");
  B = await buatOrg("b");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("TEST-01 – isolasi antar-organisasi", () => {
  it("super_admin org A TIDAK punya akses ke lokasi org B (dan sebaliknya)", async () => {
    expect(await hasLocationAccess(A.admin, A.locationId)).toBe(true);
    expect(await hasLocationAccess(A.admin, B.locationId)).toBe(false);
    expect(await hasLocationAccess(B.admin, A.locationId)).toBe(false);
    expect(await hasLocationAccess(B.admin, B.locationId)).toBe(true);
  });

  it("site_manager hanya lokasi yang ditugaskan – lintas organisasi tetap ditolak", async () => {
    expect(await hasLocationAccess(A.sm, A.locationId)).toBe(true);
    expect(await hasLocationAccess(A.sm, B.locationId)).toBe(false);
    expect(await accessibleLocationIds(A.sm)).toEqual([A.locationId]);
  });

  it("peran lintas-lokasi berarti 'semua lokasi ORGANISASI', bukan seluruh database", async () => {
    // accessibleLocationIds = null untuk super_admin; artinya where-clause-nya
    // WAJIB tetap membawa filter organisasi — inilah yang dulu jadi `{}`.
    const ids = await accessibleLocationIds(A.admin);
    expect(ids).toBeNull();

    const terlihat = await db.location.findMany({
      where: locationScopeWhere(A.admin, ids),
      select: { id: true },
    });
    expect(terlihat.map((l) => l.id)).toEqual([A.locationId]);
    expect(terlihat.map((l) => l.id)).not.toContain(B.locationId);
  });

  it("varian relasi (laporan harian dsb.) juga tidak bocor lintas organisasi", async () => {
    const hariIni = new Date("2026-04-01T00:00:00Z");
    for (const org of [A, B]) {
      await db.dailyReport.create({
        data: { locationId: org.locationId, reportDate: hariIni, status: "draft", createdById: org.sm.id },
      });
    }
    const ids = await accessibleLocationIds(A.admin);
    const laporan = await db.dailyReport.findMany({
      where: locationRelScopeWhere(A.admin, ids),
      select: { locationId: true },
    });
    expect(laporan).toHaveLength(1);
    expect(laporan[0].locationId).toBe(A.locationId);
  });

  it("paket organisasi lain tidak ikut terbaca lewat filter organisasi", async () => {
    const paket = await db.package.findMany({ where: { orgId: A.admin.orgId }, select: { id: true } });
    expect(paket.map((p) => p.id)).toEqual([A.packageId]);
  });
});
