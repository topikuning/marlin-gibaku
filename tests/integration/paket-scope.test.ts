// Scope PAKET (laporan user 2026-07-30): paket yang tidak memuat lokasi
// penugasan TIDAK boleh tampil untuk role ter-scope — dan workspace paket
// tidak boleh bisa dibuka lewat URL oleh yang bukan berhak (termasuk lintas
// organisasi). Semua lewat packageScopeWhere di satu tempat.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
// `cache()` React memoisasi per-request RSC; di test tidak ada request scope,
// jadi dilewati supaya panggilan user berbeda tidak saling menempel.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

let sessionUser = { id: "", orgId: "", role: "super_admin", fullName: "Tester" };
let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => sessionUser,
  getCurrentUser: async () => sessionUser,
  accessibleLocationIds: async () => scopedLocations,
  requestIp: async () => null,
}));

const { db } = await import("@/lib/db");
const { listPackages, getPackageStats, getPackageWorkspace } = await import("@/lib/package/queries");
const { packageScopeWhere } = await import("@/lib/auth/scope");

const suffix = `ps${Date.now().toString(36)}`;
let orgA = "";
let orgB = "";
let pkgDitugaskan = ""; // punya loc yang ditugaskan ke SM
let pkgLain = ""; // punya lokasi, TIDAK ditugaskan
let pkgKosong = ""; // tanpa lokasi sama sekali
let pkgOrgLain = ""; // milik organisasi B
let lokasiSm = "";

async function buatPaket(orgId: string, nama: string, desa?: string) {
  const pkg = await db.package.create({ data: { orgId, name: `${nama} ${suffix}` } });
  if (desa) {
    const loc = await db.location.create({
      data: {
        packageId: pkg.id,
        name: desa,
        slug: `${desa.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
        village: desa,
        regency: "Kab",
        province: "Prov",
      },
    });
    return { pkgId: pkg.id, locId: loc.id };
  }
  return { pkgId: pkg.id, locId: null };
}

beforeAll(async () => {
  const a = await db.organization.create({ data: { name: `Org A ${suffix}`, slug: `a-${suffix}` } });
  const b = await db.organization.create({ data: { name: `Org B ${suffix}`, slug: `b-${suffix}` } });
  orgA = a.id;
  orgB = b.id;

  const p1 = await buatPaket(orgA, "Paket Ditugaskan", "Kedungrejo");
  pkgDitugaskan = p1.pkgId;
  lokasiSm = p1.locId!;
  const p2 = await buatPaket(orgA, "Paket Lain", "Pesisir");
  pkgLain = p2.pkgId;
  const p3 = await buatPaket(orgA, "Paket Kosong");
  pkgKosong = p3.pkgId;
  const pb = await buatPaket(orgB, "Paket Org Lain", "Seberang");
  pkgOrgLain = pb.pkgId;

  sessionUser = { id: "", orgId: orgA, role: "super_admin", fullName: "Tester" };
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

function jadiAdminOrgA() {
  sessionUser = { ...sessionUser, orgId: orgA, role: "super_admin" };
  scopedLocations = null; // lintas lokasi
}
function jadiSmOrgA() {
  sessionUser = { ...sessionUser, orgId: orgA, role: "site_manager" };
  scopedLocations = [lokasiSm];
}
function jadiSmTanpaPenugasan() {
  sessionUser = { ...sessionUser, orgId: orgA, role: "site_manager" };
  scopedLocations = [];
}

beforeEach(jadiAdminOrgA);

const namaSaja = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("daftar paket (listPackages)", () => {
  it("role lintas lokasi melihat semua paket ORGANISASINYA — bukan organisasi lain", async () => {
    const rows = await listPackages(sessionUser as never, scopedLocations);
    expect(namaSaja(rows)).toEqual([pkgDitugaskan, pkgKosong, pkgLain].sort());
    expect(rows.map((r) => r.id)).not.toContain(pkgOrgLain);
  });

  it("role ter-scope hanya melihat paket yang memuat lokasi penugasannya", async () => {
    jadiSmOrgA();
    const rows = await listPackages(sessionUser as never, scopedLocations);
    expect(namaSaja(rows)).toEqual([pkgDitugaskan]);
  });

  it("tanpa penugasan sama sekali → daftar kosong, bukan semua paket", async () => {
    jadiSmTanpaPenugasan();
    expect(await listPackages(sessionUser as never, scopedLocations)).toEqual([]);
  });
});

describe("KPI paket (getPackageStats)", () => {
  it("angka mengikuti scope yang sama dengan daftarnya", async () => {
    expect((await getPackageStats(sessionUser as never, scopedLocations)).total).toBe(3);
    jadiSmOrgA();
    expect((await getPackageStats(sessionUser as never, scopedLocations)).total).toBe(1);
  });
});

describe("workspace paket (getPackageWorkspace) — penjaga URL", () => {
  it("role ter-scope tidak bisa membuka paket yang tidak ditugaskan (null = notFound)", async () => {
    jadiSmOrgA();
    expect(await getPackageWorkspace(pkgDitugaskan)).not.toBeNull();
    expect(await getPackageWorkspace(pkgLain)).toBeNull();
    expect(await getPackageWorkspace(pkgKosong)).toBeNull();
  });

  it("paket organisasi lain tidak bisa dibuka bahkan oleh super_admin", async () => {
    expect(await getPackageWorkspace(pkgOrgLain)).toBeNull();
    jadiSmOrgA();
    expect(await getPackageWorkspace(pkgOrgLain)).toBeNull();
  });
});

describe("packageScopeWhere — bentuk filternya sendiri", () => {
  it("null (lintas lokasi) tetap membatasi ke organisasi user", () => {
    expect(packageScopeWhere({ orgId: "o1" } as never, null)).toEqual({ orgId: "o1" });
  });

  it("ter-scope = organisasi + minimal satu lokasi penugasan", () => {
    expect(packageScopeWhere({ orgId: "o1" } as never, ["l1", "l2"])).toEqual({
      orgId: "o1",
      locations: { some: { id: { in: ["l1", "l2"] } } },
    });
  });
});
