/*
 * SAMBUNGAN GOOGLE CADANGAN LEWAT JALUR OAUTH YANG SAMA (DECISIONS 650) –
 * uji keamanan.
 *
 * `/api/gdrive/auth` dan `/api/gdrive/callback` kini melayani DUA akun: editor
 * folder KKP (141) dan akun cadangan. Rute ini menentukan ke mana izin Google
 * tersimpan, jadi yang dijaga:
 *   1. tujuan cadangan → token masuk ke akun cadangan, TIDAK menimpa akun KKP
 *   2. tujuan KKP → sebaliknya
 *   3. state anti-CSRF tidak cocok → ditolak, tidak ada yang tersimpan
 *   4. pengguna tanpa `system.manage` → ditolak, tidak ada yang tersimpan
 *   5. akun cadangan hanya meminta scope `drive.file`, KKP tetap `drive`
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.AI_SECRET_ENCRYPTION_KEY = "a".repeat(64);

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

let pengguna: { id: string; role: string; mustChangePassword: boolean } | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => pengguna,
}));

const { db } = await import("@/lib/db");
const { saveGDriveClient, getGDriveConfigDisplay, clearGDriveToken } = await import("@/lib/gdrive/config");
const { tampilanAkunCadangan, putuskanAkunCadangan } = await import("@/lib/cadangan/akun");
const { GET: callback } = await import("@/app/api/gdrive/callback/route");
const { GET: mulaiAuth } = await import("@/app/api/gdrive/auth/route");

const suffix = `co${Date.now().toString(36)}`;
let adminId: string;

const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

const fetchAsli = globalThis.fetch;
beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org CO ${suffix}`, slug: `org-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `co-${suffix}`, fullName: "Admin Uji", passwordHash: "x", role: "super_admin" },
  });
  adminId = u.id;
  await saveGDriveClient("client-uji.apps.googleusercontent.com", "rahasia-client");
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ refresh_token: "rt-baru", id_token: idToken("dua-tb@gmail.com") }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return fetchAsli(url as string);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = fetchAsli;
  await db.appSetting.deleteMany({ where: { key: { startsWith: "cadangan." } } });
  await db.appSetting.deleteMany({ where: { key: { startsWith: "gdrive." } } });
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  pengguna = { id: adminId, role: "super_admin", mustChangePassword: false };
  await clearGDriveToken();
  await putuskanAkunCadangan();
});

function permintaanCallback(cookie: string, state = "abc") {
  return new NextRequest(`https://marlin.uji/api/gdrive/callback?state=${state}&code=kode-uji`, {
    headers: { cookie, host: "marlin.uji", "x-forwarded-proto": "https" },
  });
}

describe("callback OAuth: izin disimpan ke akun yang dimaksud, tidak ke yang lain", () => {
  it("tujuan cadangan → akun cadangan tersambung, akun KKP tetap kosong", async () => {
    const res = await callback(permintaanCallback("gdrive_oauth_state=abc; gdrive_oauth_tujuan=cadangan"));
    expect(res.headers.get("location")).toContain("/sistem?cadangan=terhubung");
    const c = await tampilanAkunCadangan();
    expect(c.terhubung).toBe(true);
    expect(c.email).toBe("dua-tb@gmail.com");
    expect((await getGDriveConfigDisplay()).connected).toBe(false);
  });

  it("tujuan KKP → akun KKP tersambung, akun cadangan tetap kosong", async () => {
    const res = await callback(permintaanCallback("gdrive_oauth_state=abc; gdrive_oauth_tujuan=kkp"));
    expect(res.headers.get("location")).toContain("/sistem?gdrive=terhubung");
    expect((await getGDriveConfigDisplay()).connected).toBe(true);
    expect((await tampilanAkunCadangan()).terhubung).toBe(false);
  });

  it("state anti-CSRF tidak cocok → ditolak, tidak ada izin yang tersimpan", async () => {
    const res = await callback(permintaanCallback("gdrive_oauth_state=lain; gdrive_oauth_tujuan=cadangan"));
    expect(res.headers.get("location")).toContain("state-salah");
    expect((await tampilanAkunCadangan()).terhubung).toBe(false);
    expect((await getGDriveConfigDisplay()).connected).toBe(false);
  });

  it("pengguna tanpa hak mengatur sistem → ditolak, tidak ada izin yang tersimpan", async () => {
    pengguna = { id: adminId, role: "site_manager", mustChangePassword: false };
    const res = await callback(permintaanCallback("gdrive_oauth_state=abc; gdrive_oauth_tujuan=cadangan"));
    expect(res.headers.get("location")).toContain("tanpa-izin");
    expect((await tampilanAkunCadangan()).terhubung).toBe(false);
  });
});

describe("mulai OAuth: scope sesuai tujuan", () => {
  const mulai = (q: string) =>
    mulaiAuth(new NextRequest(`https://marlin.uji/api/gdrive/auth${q}`, { headers: { host: "marlin.uji", "x-forwarded-proto": "https" } }));

  it("akun cadangan hanya meminta drive.file, dan tujuannya dicatat di cookie", async () => {
    const res = await mulai("?tujuan=cadangan");
    const lokasi = new URL(res.headers.get("location")!);
    expect(lokasi.searchParams.get("scope")).toContain("auth/drive.file");
    expect(lokasi.searchParams.get("scope")).not.toMatch(/auth\/drive( |$)/);
    expect(res.cookies.get("gdrive_oauth_tujuan")?.value).toBe("cadangan");
  });

  it("tanpa tujuan tetap akun KKP dengan scope drive penuh seperti sebelumnya", async () => {
    const res = await mulai("");
    const lokasi = new URL(res.headers.get("location")!);
    expect(lokasi.searchParams.get("scope")).toMatch(/auth\/drive( |$)/);
    expect(res.cookies.get("gdrive_oauth_tujuan")?.value).toBe("kkp");
  });
});
