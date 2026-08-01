// Executive View BUTUH penugasan (permintaan user 2026-07-31, DECISIONS 190).
// Sebelumnya exec_viewer ada di CROSS_LOCATION_ROLES sehingga otomatis melihat
// SELURUH lokasi organisasi tanpa ditugaskan apa pun. Uji ini memakai
// accessibleLocationIds & hasLocationAccess yang ASLI (bukan mock) supaya yang
// dibuktikan adalah perilaku nyata, bukan sekadar isi konstanta.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { accessibleLocationIds, hasLocationAccess } = await import("@/lib/auth/session");
const { locationScopeWhere, packageScopeWhere } = await import("@/lib/auth/scope");

const suffix = `ev${Date.now().toString(36)}`;
let orgId = "";
let orgLainId = "";
let locA = "";
let locB = "";
let locOrgLain = "";
let execTanpaTugas = "";
let execDitugaskan = "";
let programDirector = "";

type U = Parameters<typeof accessibleLocationIds>[0];
const u = (id: string, role: string, org = orgId): U =>
  ({
    id,
    orgId: org,
    role,
    fullName: "T",
    username: "t",
    email: null,
    mustChangePassword: false,
  }) as U;

async function buatLokasi(oid: string, desa: string) {
  const pkg = await db.package.create({ data: { orgId: oid, name: `Paket ${desa} ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: desa,
      slug: `${desa.toLowerCase()}-${suffix}`,
      village: desa,
      regency: "Kab",
      province: "Prov",
    },
  });
  return { pkgId: pkg.id, locId: loc.id };
}

async function buatUser(oid: string, username: string, role: string) {
  const user = await db.user.create({
    data: {
      orgId: oid,
      username: `${username}-${suffix}`,
      fullName: username,
      role: role as never,
      passwordHash: "x",
    },
  });
  return user.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const org2 = await db.organization.create({ data: { name: `Org2 ${suffix}`, slug: `o2-${suffix}` } });
  orgId = org.id;
  orgLainId = org2.id;

  ({ locId: locA } = await buatLokasi(orgId, `Alfa${suffix}`));
  ({ locId: locB } = await buatLokasi(orgId, `Beta${suffix}`));
  ({ locId: locOrgLain } = await buatLokasi(orgLainId, `Gama${suffix}`));

  execTanpaTugas = await buatUser(orgId, "exec-kosong", "exec_viewer");
  execDitugaskan = await buatUser(orgId, "exec-tugas", "exec_viewer");
  programDirector = await buatUser(orgId, "pd", "program_director");

  // Hanya exec kedua yang ditugaskan, dan hanya ke locA.
  await db.locationAssignment.create({ data: { userId: execDitugaskan, locationId: locA } });
});

afterAll(async () => {
  await db.locationAssignment.deleteMany({ where: { userId: { in: [execDitugaskan] } } });
  await db.user.deleteMany({ where: { id: { in: [execTanpaTugas, execDitugaskan, programDirector] } } });
  await db.location.deleteMany({ where: { id: { in: [locA, locB, locOrgLain] } } });
  await db.package.deleteMany({ where: { orgId: { in: [orgId, orgLainId] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgId, orgLainId] } } });
  await db.$disconnect();
});

describe("exec_viewer TANPA penugasan", () => {
  it("KASUS INTI: melihat NOL lokasi, bukan semuanya", async () => {
    const ids = await accessibleLocationIds(u(execTanpaTugas, "exec_viewer"));
    // null = lintas lokasi (lihat semua). Yang benar: array kosong.
    expect(ids).not.toBeNull();
    expect(ids).toEqual([]);
  });

  it("filter Prisma yang dihasilkan tidak cocok dengan lokasi mana pun", async () => {
    const user = u(execTanpaTugas, "exec_viewer");
    const ids = await accessibleLocationIds(user);
    const jumlah = await db.location.count({ where: locationScopeWhere(user, ids) });
    expect(jumlah).toBe(0);
    const paket = await db.package.count({ where: packageScopeWhere(user, ids) });
    expect(paket).toBe(0);
  });

  it("tidak bisa membuka lokasi lewat URL (penjaga per-lokasi ikut menutup)", async () => {
    const user = u(execTanpaTugas, "exec_viewer");
    expect(await hasLocationAccess(user, locA)).toBe(false);
    expect(await hasLocationAccess(user, locB)).toBe(false);
  });
});

describe("exec_viewer DENGAN penugasan", () => {
  it("hanya melihat lokasi yang ditugaskan", async () => {
    const ids = await accessibleLocationIds(u(execDitugaskan, "exec_viewer"));
    expect(ids).toEqual([locA]);
  });

  it("lokasi lain di organisasi yang sama tetap tertutup", async () => {
    const user = u(execDitugaskan, "exec_viewer");
    expect(await hasLocationAccess(user, locA)).toBe(true);
    expect(await hasLocationAccess(user, locB)).toBe(false);
  });

  it("penugasan yang dicabut langsung menutup akses", async () => {
    const user = u(execDitugaskan, "exec_viewer");
    await db.locationAssignment.updateMany({
      where: { userId: execDitugaskan, locationId: locA },
      data: { unassignedAt: new Date() },
    });
    expect(await hasLocationAccess(user, locA)).toBe(false);
    expect(await accessibleLocationIds(user)).toEqual([]);
    // pulihkan supaya urutan test tidak saling mempengaruhi
    await db.locationAssignment.updateMany({
      where: { userId: execDitugaskan, locationId: locA },
      data: { unassignedAt: null },
    });
  });

  it("penugasan TIDAK menembus organisasi lain", async () => {
    // Sengaja ditugaskan lintas-org (yang seharusnya dicegah di action), lalu
    // dibuktikan penjaga per-lokasi tetap menolak karena cek orgId duluan.
    await db.locationAssignment.create({
      data: { userId: execDitugaskan, locationId: locOrgLain },
    });
    expect(await hasLocationAccess(u(execDitugaskan, "exec_viewer"), locOrgLain)).toBe(false);
    await db.locationAssignment.deleteMany({
      where: { userId: execDitugaskan, locationId: locOrgLain },
    });
  });
});

describe("peran lintas lokasi tidak ikut berubah", () => {
  it("program_director tetap melihat semua tanpa penugasan", async () => {
    expect(await accessibleLocationIds(u(programDirector, "program_director"))).toBeNull();
    expect(await hasLocationAccess(u(programDirector, "program_director"), locA)).toBe(true);
    expect(await hasLocationAccess(u(programDirector, "program_director"), locB)).toBe(true);
  });

  it("program_director tetap dibatasi organisasinya sendiri", async () => {
    expect(await hasLocationAccess(u(programDirector, "program_director"), locOrgLain)).toBe(false);
  });
});
