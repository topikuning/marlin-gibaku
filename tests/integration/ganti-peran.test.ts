// Ganti peran akun (DECISIONS 200) — mutasi paling berbahaya di modul pengguna.
//
// Permintaan user 2026-08-01: "perlu bisa ganti jenis / level login, misal saat
// ini pelaksana, diganti jadi site manager."
//
// Yang diuji di sini BUKAN jalur suksesnya saja, tapi pagar-pagarnya: satu
// kelonggaran di sini artinya siapa pun yang bisa mengelola user bisa
// menaikkan dirinya atau orang lain ke wewenang mana pun.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";
const dicabut: string[] = [];

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Aktor" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    revokeAllSessions: async (id: string) => {
      dicabut.push(id);
    },
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { setUserRole } = await import("@/lib/users/actions");

const suffix = `gp${Date.now().toString(36)}`;
let orgId = "";
let pelaksanaId = "";
let adminLainId = "";

function fd(userId: string, peran: string): FormData {
  const f = new FormData();
  f.set("userId", userId);
  f.set("role", peran);
  return f;
}

async function buatUser(nama: string, peran: string) {
  const u = await db.user.create({
    data: {
      orgId,
      username: `${nama}-${suffix}`,
      fullName: nama,
      role: peran as never,
      passwordHash: "x",
    },
    select: { id: true },
  });
  return u.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org GP ${suffix}`, slug: `gp-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  sessionUserId = await buatUser("Aktor", "super_admin");
  adminLainId = await buatUser("Admin Lain", "super_admin");
});

afterAll(async () => {
  // audit_logs append-only (AUDIT-01) → user & organisasi sengaja dibiarkan.
  await db.$disconnect();
});

beforeEach(async () => {
  role = "super_admin";
  dicabut.length = 0;
  pelaksanaId = await buatUser(`Pelaksana ${Math.random().toString(36).slice(2, 7)}`, "field_supervisor");
});

describe("KASUS INTI: Pelaksana → Site Manager", () => {
  it("peran berubah, sesi lama dicabut, dan tercatat di audit", async () => {
    const res = await setUserRole(undefined, fd(pelaksanaId, "site_manager"));
    expect(res?.error).toBeUndefined();
    expect(res?.success).toMatch(/Site Manager/);
    // Sesi lama membawa role LAMA — tanpa pencabutan, penurunan/penaikan peran
    // baru berlaku setelah sesinya kedaluwarsa.
    expect(res?.success).toMatch(/masuk ulang/i);
    expect(dicabut).toContain(pelaksanaId);

    const u = await db.user.findUniqueOrThrow({ where: { id: pelaksanaId }, select: { role: true } });
    expect(u.role).toBe("site_manager");

    const log = await db.auditLog.findFirst({
      where: { action: "user.set_role" },
      orderBy: { createdAt: "desc" },
      select: { resourceType: true, payload: true },
    });
    expect(log?.resourceType).toBe("user");
    expect(log?.payload).toMatchObject({ dari: "field_supervisor", ke: "site_manager" });
  });

  it("penugasan lokasi TIDAK ikut terhapus — peran ≠ tempat", async () => {
    const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}${Math.random()}` } });
    const loc = await db.location.create({
      data: {
        packageId: pkg.id,
        name: "Alfa",
        slug: `alfa-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
        village: "Alfa",
        regency: "K",
        province: "P",
      },
    });
    await db.locationAssignment.create({ data: { userId: pelaksanaId, locationId: loc.id } });
    await setUserRole(undefined, fd(pelaksanaId, "site_manager"));
    const tetap = await db.locationAssignment.count({
      where: { userId: pelaksanaId, unassignedAt: null },
    });
    expect(tetap).toBe(1);
  });

  it("peran yang sama ditolak dengan pesan jelas (bukan diam-diam sukses)", async () => {
    const res = await setUserRole(undefined, fd(pelaksanaId, "field_supervisor"));
    expect(res?.error).toMatch(/memang sudah/i);
    expect(dicabut).toHaveLength(0);
  });
});

describe("pagar", () => {
  it("TIDAK bisa mengganti peran akun sendiri", async () => {
    const res = await setUserRole(undefined, fd(sessionUserId, "program_director"));
    expect(res?.error).toMatch(/akun sendiri/i);
    const u = await db.user.findUniqueOrThrow({ where: { id: sessionUserId }, select: { role: true } });
    expect(u.role).toBe("super_admin");
  });

  it("tidak bisa menyentuh akun setingkat atau lebih tinggi", async () => {
    const res = await setUserRole(undefined, fd(adminLainId, "site_manager"));
    expect(res?.error).toMatch(/setingkat atau lebih tinggi/i);
    const u = await db.user.findUniqueOrThrow({ where: { id: adminLainId }, select: { role: true } });
    expect(u.role).toBe("super_admin");
  });

  it("PM sama sekali tidak bisa mengganti peran — membuat akun ≠ mengelola akun", async () => {
    // PM punya `user.create` (boleh mengangkat SM/Pelaksana BARU) tapi TIDAK
    // punya `user.manage`. Gerbangnya sengaja `user.manage`, sama seperti reset
    // password & nonaktifkan: menaikkan peran orang yang sudah ada adalah
    // wewenang yang berbeda dari merekrut.
    const pmId = await buatUser(`PM ${Math.random().toString(36).slice(2, 7)}`, "project_manager");
    sessionUserId = pmId;
    role = "project_manager";
    for (const tujuan of ["program_director", "site_manager"] as const) {
      const res = await setUserRole(undefined, fd(pelaksanaId, tujuan));
      expect(res?.error).toMatch(/izin/i);
    }
    const u = await db.user.findUniqueOrThrow({ where: { id: pelaksanaId }, select: { role: true } });
    expect(u.role).toBe("field_supervisor");
  });

  it("PD tidak bisa mengangkat siapa pun jadi Super Admin", async () => {
    const pdId = await buatUser(`PD ${Math.random().toString(36).slice(2, 7)}`, "program_director");
    sessionUserId = pdId;
    role = "program_director";
    const res = await setUserRole(undefined, fd(pelaksanaId, "super_admin"));
    expect(res?.error).toMatch(/tidak berwenang/i);
    // Peran yang memang boleh dibuatnya tetap bisa.
    const ok = await setUserRole(undefined, fd(pelaksanaId, "site_manager"));
    expect(ok?.error).toBeUndefined();
  });

  it("tanpa izin user.manage ditolak", async () => {
    role = "site_manager"; // punya user.create, TIDAK punya user.manage
    const res = await setUserRole(undefined, fd(pelaksanaId, "project_manager"));
    expect(res?.error).toMatch(/izin/i);
  });

  it("peran liar ditolak skema", async () => {
    const res = await setUserRole(undefined, fd(pelaksanaId, "raja"));
    expect(res?.error).toBeTruthy();
  });

  it("Wakil PPK bisa diberikan seperti peran lain", async () => {
    const res = await setUserRole(undefined, fd(pelaksanaId, "wakil_ppk"));
    expect(res?.error).toBeUndefined();
    const u = await db.user.findUniqueOrThrow({ where: { id: pelaksanaId }, select: { role: true } });
    expect(u.role).toBe("wakil_ppk");
  });
});
