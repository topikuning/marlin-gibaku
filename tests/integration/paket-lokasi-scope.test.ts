// Daftar lokasi di dalam paket ikut penugasan (DECISIONS 201).
//
// Keluhan user 2026-08-01: "di paket A, ada lokasi A,B,C,D — user di assign B,C.
// saat masuk paket, lalu lihat lokasi, semua lokasi terlist… klik A memang 404,
// tapi kalau bisa sekalian dibatasi sejak level tampilan."
//
// Penahanan di klik memang mencegah akses DATANYA, tapi keberadaan & nama
// lokasi lain sudah bocor lebih dulu — dan daftar itu terbaca sebagai "ini
// semua tanggung jawabmu", yang salah.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => {
  // `cache()` React tidak jalan di luar request — di tes cukup identitas.
  const actual = await orig<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

let role = "site_manager";
let sessionUserId = "";
let sessionOrgId = "";
let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", async () => {
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => scopedLocations,
    requireCapability: async () => user(),
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { getPackageWorkspace } = await import("@/lib/package/queries");

const suffix = `pl${Date.now().toString(36)}`;
let orgId = "";
let packageId = "";
const lokasi: Record<"A" | "B" | "C" | "D", string> = { A: "", B: "", C: "", D: "" };

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PL ${suffix}`, slug: `pl-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  const u = await db.user.create({
    data: { orgId, username: `pl-${suffix}`, fullName: "Tester", role: "site_manager", passwordHash: "x" },
  });
  sessionUserId = u.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket A ${suffix}` } });
  packageId = pkg.id;
  for (const nama of ["A", "B", "C", "D"] as const) {
    const l = await db.location.create({
      data: {
        packageId,
        name: `Lokasi ${nama}`,
        slug: `lokasi-${nama.toLowerCase()}-${suffix}`,
        village: `Desa ${nama}`,
        regency: "Kab",
        province: "Prov",
      },
      select: { id: true },
    });
    lokasi[nama] = l.id;
  }
});

afterAll(async () => {
  await db.location.deleteMany({ where: { packageId } });
  await db.package.deleteMany({ where: { id: packageId } });
  await db.user.deleteMany({ where: { orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.$disconnect();
});

describe("KASUS INTI: paket A punya lokasi A–D, user ditugaskan B & C", () => {
  it("hanya B & C yang muncul; A & D tidak ikut terkirim ke browser", async () => {
    role = "site_manager";
    scopedLocations = [lokasi.B, lokasi.C];
    const pkg = await getPackageWorkspace(packageId);
    expect(pkg).not.toBeNull();
    const nama = pkg!.locations.map((l) => l.name).sort();
    expect(nama).toEqual(["Lokasi B", "Lokasi C"]);
    // Bukan sekadar tak terlihat di layar: id & nama lokasi lain tidak pernah
    // ikut dalam data halaman.
    const semua = JSON.stringify(pkg!.locations);
    expect(semua).not.toContain(lokasi.A);
    expect(semua).not.toContain(lokasi.D);
    expect(semua).not.toContain("Lokasi A");
  });

  it("yang disembunyikan DISEBUT jumlahnya – 'tidak muncul' ≠ 'tidak ada'", async () => {
    scopedLocations = [lokasi.B, lokasi.C];
    const pkg = await getPackageWorkspace(packageId);
    expect(pkg!.locationsHidden).toBe(2);
  });

  it("tanpa penugasan sama sekali: nol lokasi, tapi jumlahnya tetap disebut", async () => {
    scopedLocations = [];
    const pkg = await getPackageWorkspace(packageId);
    // Paketnya sendiri boleh jadi tak terbuka utk scope kosong; bila terbuka,
    // daftarnya wajib kosong dan angka tersembunyinya utuh.
    if (pkg) {
      expect(pkg.locations).toHaveLength(0);
      expect(pkg.locationsHidden).toBe(4);
    }
  });
});

describe("peran lintas lokasi tidak terpengaruh", () => {
  it("super_admin melihat keempat lokasi, tanpa angka tersembunyi", async () => {
    role = "super_admin";
    scopedLocations = null; // null = lintas lokasi
    const pkg = await getPackageWorkspace(packageId);
    expect(pkg!.locations.map((l) => l.name).sort()).toEqual([
      "Lokasi A",
      "Lokasi B",
      "Lokasi C",
      "Lokasi D",
    ]);
    expect(pkg!.locationsHidden).toBe(0);
  });
});
