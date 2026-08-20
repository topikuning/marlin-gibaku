// SUPER ADMIN UTAMA ditetapkan dari variabel lingkungan (DECISIONS 315).
//
// Permintaan user 2026-08-15: "seharusnya ada set super admin utama di .env
// atau di variabel railway".
//
// Yang dijawab: sebelumnya akun super admin adalah PINTU SATU ARAH — bisa
// dicetak bebas, tidak bisa dinonaktifkan/diturunkan siapa pun, dan
// pemulihannya cuma SQL langsung ke produksi.
//
// Yang paling penting diuji di sini BUKAN jalur nyamannya (akar bisa
// menonaktifkan super admin biasa), melainkan bahwa akar TIDAK BISA DICETAK
// DARI DALAM APLIKASI. Kalau bisa, seluruh gagasan "akarnya di luar database"
// batal oleh satu formulir.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

const suffix = `ak${Date.now().toString(36)}`;
const USER_AKAR = `akar-${suffix}`;
/** Username yang TERCANTUM di env tapi akunnya belum ada — kursi kosong. */
const USER_KURSI_KOSONG = `kursi-${suffix}`;

// Dibaca `lib/env.ts` saat modul diimpor, jadi WAJIB diset sebelum import mana pun.
process.env.SUPER_ADMIN_UTAMA = `${USER_AKAR}, ${USER_KURSI_KOSONG}`;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let sessionUserId = "";
let sessionUsername: string | null = "";
let role = "super_admin";
let sessionOrgId = "";
const dicabut: string[] = [];

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({
    id: sessionUserId,
    orgId: sessionOrgId,
    role,
    fullName: "Aktor",
    username: sessionUsername,
  });
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
const { setUserActive, resetUserPassword, setUserRole, createUser, updateUserProfile } = await import(
  "@/lib/users/actions"
);

let orgId = "";
let akarId = "";
let superBiasaId = "";
let siteManagerId = "";

async function buatUser(username: string, peran: string) {
  const u = await db.user.create({
    data: {
      orgId,
      username,
      fullName: username,
      role: peran as never,
      passwordHash: "x",
      mustChangePassword: false,
    },
    select: { id: true },
  });
  return u.id;
}

/** Masuk sebagai akun tertentu. */
function sebagai(id: string, username: string, peran = "super_admin") {
  sessionUserId = id;
  sessionUsername = username;
  role = peran;
}

function fdBuat(username: string, peran: string): FormData {
  const f = new FormData();
  f.set("username", username);
  f.set("fullName", "Akun Baru");
  f.set("role", peran);
  f.set("password", "password-panjang-123");
  return f;
}

function fdPeran(userId: string, peran: string): FormData {
  const f = new FormData();
  f.set("userId", userId);
  f.set("role", peran);
  return f;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AK ${suffix}`, slug: `ak-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  akarId = await buatUser(USER_AKAR, "super_admin");
  superBiasaId = await buatUser(`super-biasa-${suffix}`, "super_admin");
  siteManagerId = await buatUser(`sm-${suffix}`, "site_manager");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
  delete process.env.SUPER_ADMIN_UTAMA;
});

beforeEach(async () => {
  dicabut.length = 0;
  await db.user.updateMany({ where: { orgId }, data: { isActive: true } });
  await db.user.update({ where: { id: superBiasaId }, data: { role: "super_admin" } });
  await db.user.deleteMany({ where: { orgId, username: USER_KURSI_KOSONG } });
});

describe("akar membuka pintu satu arah", () => {
  it("akar BISA menonaktifkan super admin biasa", async () => {
    sebagai(akarId, USER_AKAR);
    const hasil = await setUserActive(superBiasaId, false);
    expect(hasil?.error).toBeUndefined();
    const u = await db.user.findUnique({ where: { id: superBiasaId }, select: { isActive: true } });
    expect(u?.isActive).toBe(false);
    expect(dicabut).toContain(superBiasaId);
  });

  it("akar BISA menurunkan peran super admin biasa", async () => {
    sebagai(akarId, USER_AKAR);
    const hasil = await setUserRole(undefined, fdPeran(superBiasaId, "site_manager"));
    expect(hasil?.error).toBeUndefined();
    const u = await db.user.findUnique({ where: { id: superBiasaId }, select: { role: true } });
    expect(u?.role).toBe("site_manager");
  });

  it("akar BISA mereset password super admin biasa", async () => {
    sebagai(akarId, USER_AKAR);
    const f = new FormData();
    f.set("userId", superBiasaId);
    f.set("password", "password-baru-123");
    const hasil = await resetUserPassword(undefined, f);
    expect(hasil?.success).toBeTruthy();
  });

  it("super admin BIASA tetap tidak bisa menyentuh sesamanya", async () => {
    // Kebijakan lama tetap berlaku untuk yang bukan akar — env memberi SATU
    // jalan keluar, bukan membuka pagarnya untuk semua orang.
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const lain = await buatUser(`super-c-${suffix}`, "super_admin");
    const hasil = await setUserActive(lain, false);
    expect(hasil?.error).toMatch(/setingkat atau lebih tinggi/i);
    await db.user.delete({ where: { id: lain } });
  });
});

describe("akun akar tidak bisa disentuh siapa pun", () => {
  it("super admin biasa tidak bisa menonaktifkan akar", async () => {
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const hasil = await setUserActive(akarId, false);
    expect(hasil?.error).toMatch(/super admin utama/i);
    const u = await db.user.findUnique({ where: { id: akarId }, select: { isActive: true } });
    expect(u?.isActive).toBe(true);
  });

  it("akar lain pun tidak bisa – daftarnya di env yang menentukan, bukan siapa cepat", async () => {
    const akarKedua = await buatUser(USER_KURSI_KOSONG, "super_admin");
    sebagai(akarKedua, USER_KURSI_KOSONG);
    const hasil = await setUserActive(akarId, false);
    expect(hasil?.error).toMatch(/super admin utama/i);
  });

  it("akar tidak bisa diturunkan perannya", async () => {
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const hasil = await setUserRole(undefined, fdPeran(akarId, "site_manager"));
    expect(hasil?.error).toMatch(/super admin utama/i);
  });

  it("email akar tidak bisa diganti – email adalah identifier login", async () => {
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const f = new FormData();
    f.set("userId", akarId);
    f.set("fullName", "Dibajak");
    f.set("email", `bajak-${suffix}@example.com`);
    const hasil = await updateUserProfile(undefined, f);
    expect(hasil?.error).toMatch(/super admin utama/i);
  });

  it("akar tetap bisa mengubah profilnya SENDIRI", async () => {
    sebagai(akarId, USER_AKAR);
    const f = new FormData();
    f.set("userId", akarId);
    f.set("fullName", "Akar Diperbarui");
    const hasil = await updateUserProfile(undefined, f);
    expect(hasil?.success).toBeTruthy();
  });

  it("akar tetap tidak bisa menonaktifkan dirinya sendiri", async () => {
    sebagai(akarId, USER_AKAR);
    const hasil = await setUserActive(akarId, false);
    expect(hasil?.error).toMatch(/akun sendiri/i);
  });
});

describe("akar TIDAK BISA dicetak dari dalam aplikasi", () => {
  it("super admin biasa tidak bisa MEMBUAT akun yang namanya tercantum di env", async () => {
    // Kursi kosong: username ada di SUPER_ADMIN_UTAMA tapi akunnya belum
    // dibuat. Tanpa pagar ini, siapa pun yang bisa membuat super admin tinggal
    // memakai nama itu dan langsung jadi akar.
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const hasil = await createUser(undefined, fdBuat(USER_KURSI_KOSONG, "super_admin"));
    expect(hasil?.error).toMatch(/super admin utama/i);
    const ada = await db.user.findFirst({ where: { username: USER_KURSI_KOSONG } });
    expect(ada).toBeNull();
  });

  it("akar sendiri BOLEH mengisi kursi yang kosong", async () => {
    sebagai(akarId, USER_AKAR);
    const hasil = await createUser(undefined, fdBuat(USER_KURSI_KOSONG, "super_admin"));
    expect(hasil?.error).toBeUndefined();
    const ada = await db.user.findFirst({ where: { username: USER_KURSI_KOSONG } });
    expect(ada).not.toBeNull();
  });

  it("nama tercantum TAPI perannya bukan super admin: bukan akar, jadi boleh dibuat", async () => {
    // Env menunjuk siapa di antara para super admin yang jadi akar; ia tidak
    // mengangkat siapa pun. Membuat mandor bernama sama tidak memberi apa-apa.
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const hasil = await createUser(undefined, fdBuat(USER_KURSI_KOSONG, "field_supervisor"));
    expect(hasil?.error).toBeUndefined();
    const u = await db.user.findFirst({
      where: { username: USER_KURSI_KOSONG },
      select: { role: true },
    });
    expect(u?.role).toBe("field_supervisor");
  });

  it("PROMOSI ke super admin juga ditutup – jalan memutar yang sama", async () => {
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    await createUser(undefined, fdBuat(USER_KURSI_KOSONG, "field_supervisor"));
    const calon = await db.user.findFirstOrThrow({
      where: { username: USER_KURSI_KOSONG },
      select: { id: true },
    });
    const hasil = await setUserRole(undefined, fdPeran(calon.id, "super_admin"));
    expect(hasil?.error).toMatch(/super admin utama/i);
    const u = await db.user.findUnique({ where: { id: calon.id }, select: { role: true } });
    expect(u?.role).toBe("field_supervisor");
  });

  it("akar boleh mengangkatnya", async () => {
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    await createUser(undefined, fdBuat(USER_KURSI_KOSONG, "field_supervisor"));
    const calon = await db.user.findFirstOrThrow({
      where: { username: USER_KURSI_KOSONG },
      select: { id: true },
    });
    sebagai(akarId, USER_AKAR);
    const hasil = await setUserRole(undefined, fdPeran(calon.id, "super_admin"));
    expect(hasil?.error).toBeUndefined();
  });
});

describe("akun biasa tidak terpengaruh", () => {
  it("site manager tetap bisa dinonaktifkan super admin biasa", async () => {
    sebagai(superBiasaId, `super-biasa-${suffix}`);
    const hasil = await setUserActive(siteManagerId, false);
    expect(hasil?.error).toBeUndefined();
  });
});
