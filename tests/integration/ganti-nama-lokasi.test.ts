// GANTI NAMA LOKASI: HANYA SUPER ADMIN DAN PROGRAM DIRECTOR.
//
// Ketetapan user 2026-10-17 (tangkapan layar pensil di samping nama lokasi):
// *"siapa yang memberikan akses edit nama lokasi di sini untuk pm atau
// level-level lain? yang punya akses harusnya cuma Program Director dan super
// admin."*
//
// Sebelumnya ganti nama menumpang `location.manage` (DECISIONS 117), yang juga
// dipegang Area Manager dan Project Manager – jadi bukan cuma pensilnya yang
// tampil, server action-nya pun menerima mereka. Uji ini lewat titik masuk yang
// dipakai layar (server action), dengan `can()` yang asli.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Aktor" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { renameLocation } = await import("@/lib/package/actions");
const { ALL_ROLES } = await import("@/lib/authz");

const suffix = `gn${Date.now().toString(36)}`;
let locationId = "";

function fd(nama: string): FormData {
  const f = new FormData();
  f.set("locationId", locationId);
  f.set("name", nama);
  return f;
}

async function namaSekarang(): Promise<string> {
  const l = await db.location.findUniqueOrThrow({ where: { id: locationId }, select: { name: true } });
  return l.name;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org GN ${suffix}`, slug: `gn-${suffix}` } });
  sessionOrgId = org.id;
  const aktor = await db.user.create({
    data: { orgId: org.id, username: `aktor-${suffix}`, fullName: "Aktor", passwordHash: "x", role: "super_admin" },
  });
  sessionUserId = aktor.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket GN ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi Asal",
      slug: `lokasi-${suffix}`,
      village: "D",
      regency: "K",
      province: "P",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
});

afterAll(async () => {
  // audit_logs append-only (AUDIT-01) → user & organisasi sengaja dibiarkan.
  await db.$disconnect();
});

const BOLEH = new Set(["super_admin", "program_director"]);

describe("ganti nama lokasi", () => {
  for (const peran of ALL_ROLES.filter((r) => !BOLEH.has(r))) {
    it(`${peran} DITOLAK, dan namanya tidak berubah`, async () => {
      role = peran;
      const sebelum = await namaSekarang();
      await expect(renameLocation(undefined, fd(`Diubah ${peran}`))).rejects.toThrow(/Tanpa izin/);
      expect(await namaSekarang()).toBe(sebelum);
    });
  }

  for (const peran of BOLEH) {
    it(`${peran} boleh`, async () => {
      role = peran;
      const res = await renameLocation(undefined, fd(`Nama oleh ${peran}`));
      expect(res?.error).toBeUndefined();
      expect(await namaSekarang()).toBe(`Nama oleh ${peran}`);
    });
  }
});
