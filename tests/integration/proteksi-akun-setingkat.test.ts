// Penolakan proteksi akun harus jadi PESAN, bukan halaman error (DECISIONS 165).
//
// Laporan produksi 2026-08-15: super admin menekan "Nonaktifkan" / "Reset
// password" pada super admin LAIN → layar putih dengan
// "An error occurred in the Server Components render", digest 1953120346.
//
// Pagarnya sendiri benar dan memang disengaja: `outranks` menolak akun
// SETINGKAT. Yang salah adalah cara menolaknya — `ForbiddenError` dilempar dari
// server action yang tidak menangkapnya, jadi Next melemparnya ke error
// boundary. Bedanya besar bagi yang memakai: "tidak boleh, ini alasannya" bisa
// ditindaklanjuti; layar error tidak bisa dibedakan dari sistem rusak.
//
// `setUserRole` sudah benar sejak awal (punya try/catch dengan komentar yang
// menjelaskan alasannya) — uji ini menutup saudara-saudaranya yang terlewat.
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
const { setUserActive, resetUserPassword, setAssignments, updateUserProfile } = await import(
  "@/lib/users/actions"
);

const suffix = `ps${Date.now().toString(36)}`;
let orgId = "";
let orgLainId = "";
/** Super admin LAIN di organisasi yang sama — target yang memicu laporan. */
let superAdminLainId = "";
/** Akun berperingkat di bawah aktor — pembanding jalur yang memang boleh. */
let siteManagerId = "";
/** Akun di organisasi berbeda — tidak boleh bocor keberadaannya. */
let orangOrgLainId = "";

async function buatUser(nama: string, peran: string, org = orgId) {
  const u = await db.user.create({
    data: {
      orgId: org,
      username: `${nama}-${suffix}`,
      fullName: nama,
      role: peran as never,
      passwordHash: "x",
      // Eksplisit false (default kolomnya true) supaya asersi "tidak tersentuh"
      // benar-benar membuktikan sesuatu — bukan kebetulan cocok dengan default.
      mustChangePassword: false,
    },
    select: { id: true },
  });
  return u.id;
}

function fdReset(userId: string): FormData {
  const f = new FormData();
  f.set("userId", userId);
  f.set("password", "password-baru-123");
  return f;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org PS ${suffix}`, slug: `ps-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  const lain = await db.organization.create({
    data: { name: `Org PS lain ${suffix}`, slug: `ps-lain-${suffix}` },
  });
  orgLainId = lain.id;

  sessionUserId = await buatUser("aktor", "super_admin");
  superAdminLainId = await buatUser("super-lain", "super_admin");
  siteManagerId = await buatUser("sm", "site_manager");
  orangOrgLainId = await buatUser("org-lain", "site_manager", orgLainId);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  role = "super_admin";
  dicabut.length = 0;
  await db.user.updateMany({ where: { orgId }, data: { isActive: true } });
});

describe("menonaktifkan akun setingkat", () => {
  it("DITOLAK dengan pesan, bukan dengan melempar ke halaman error", async () => {
    // Inilah bug yang dilaporkan. `toThrow` yang lulus di sini = layar error.
    const hasil = await setUserActive(superAdminLainId, false);
    expect(hasil?.error).toMatch(/setingkat atau lebih tinggi/i);
    expect(hasil?.success).toBeUndefined();
  });

  it("akunnya benar-benar TIDAK berubah saat ditolak", async () => {
    await setUserActive(superAdminLainId, false);
    const u = await db.user.findUnique({ where: { id: superAdminLainId }, select: { isActive: true } });
    expect(u?.isActive).toBe(true);
    expect(dicabut).not.toContain(superAdminLainId);
  });

  it("menonaktifkan diri sendiri juga ditolak dengan pesan", async () => {
    const hasil = await setUserActive(sessionUserId, false);
    expect(hasil?.error).toMatch(/akun sendiri/i);
  });

  it("akun di organisasi lain: ditolak tanpa membocorkan keberadaannya", async () => {
    const hasil = await setUserActive(orangOrgLainId, false);
    expect(hasil?.error).toMatch(/tidak ditemukan/i);
  });

  it("yang peringkatnya DI BAWAH tetap bisa dinonaktifkan — pagarnya tidak kebablasan", async () => {
    const hasil = await setUserActive(siteManagerId, false);
    expect(hasil?.error).toBeUndefined();
    expect(hasil?.success).toBeTruthy();
    const u = await db.user.findUnique({ where: { id: siteManagerId }, select: { isActive: true } });
    expect(u?.isActive).toBe(false);
    expect(dicabut).toContain(siteManagerId);
  });

  it("MENGAKTIFKAN kembali tidak butuh peringkat — memulihkan akses bukan menyerangnya", async () => {
    await db.user.update({ where: { id: superAdminLainId }, data: { isActive: false } });
    const hasil = await setUserActive(superAdminLainId, true);
    expect(hasil?.error).toBeUndefined();
    const u = await db.user.findUnique({ where: { id: superAdminLainId }, select: { isActive: true } });
    expect(u?.isActive).toBe(true);
  });
});

describe("reset password akun setingkat", () => {
  it("DITOLAK dengan pesan, bukan dengan melempar ke halaman error", async () => {
    const hasil = await resetUserPassword(undefined, fdReset(superAdminLainId));
    expect(hasil?.error).toMatch(/setingkat atau lebih tinggi/i);
  });

  it("password target tidak tersentuh saat ditolak", async () => {
    await resetUserPassword(undefined, fdReset(superAdminLainId));
    const u = await db.user.findUnique({
      where: { id: superAdminLainId },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(u?.passwordHash).toBe("x");
    expect(u?.mustChangePassword).toBe(false);
    expect(dicabut).not.toContain(superAdminLainId);
  });

  it("akun organisasi lain ditolak sebagai “tidak ditemukan”", async () => {
    const hasil = await resetUserPassword(undefined, fdReset(orangOrgLainId));
    expect(hasil?.error).toMatch(/tidak ditemukan/i);
  });

  it("bawahan tetap bisa direset", async () => {
    const hasil = await resetUserPassword(undefined, fdReset(siteManagerId));
    expect(hasil?.success).toBeTruthy();
    expect(dicabut).toContain(siteManagerId);
  });
});

describe("penugasan lokasi: akun di luar organisasi", () => {
  it("ditolak dengan pesan, bukan melempar", async () => {
    const f = new FormData();
    f.set("userId", orangOrgLainId);
    const hasil = await setAssignments(undefined, f);
    expect(hasil?.error).toMatch(/tidak ditemukan/i);
  });
});

describe("edit profil akun setingkat", () => {
  it("DITOLAK — email adalah identifier login, jadi mengubahnya = menyentuh akunnya", async () => {
    // Login menerima username ATAU email (`auth/actions.ts`). Membiarkan admin
    // setingkat mengubah email peer-nya berarti ia bisa mencabut satu jalan
    // masuk akun yang password-nya saja tidak boleh ia reset — pagar DECISIONS
    // 165 bocor lewat pintu yang tidak dijaga.
    const f = new FormData();
    f.set("userId", superAdminLainId);
    f.set("fullName", "Nama Dibajak");
    f.set("email", `bajak-${suffix}@example.com`);
    const hasil = await updateUserProfile(undefined, f);
    expect(hasil?.error).toMatch(/setingkat atau lebih tinggi/i);

    const u = await db.user.findUnique({
      where: { id: superAdminLainId },
      select: { fullName: true, email: true },
    });
    expect(u?.fullName).toBe("super-lain");
    expect(u?.email).toBeNull();
  });

  it("mengubah profil SENDIRI tetap boleh", async () => {
    const f = new FormData();
    f.set("userId", sessionUserId);
    f.set("fullName", "Aktor Diperbarui");
    const hasil = await updateUserProfile(undefined, f);
    expect(hasil?.success).toBeTruthy();
  });

  it("bawahan tetap bisa diedit", async () => {
    const f = new FormData();
    f.set("userId", siteManagerId);
    f.set("fullName", "SM Diperbarui");
    const hasil = await updateUserProfile(undefined, f);
    expect(hasil?.success).toBeTruthy();
  });
});
