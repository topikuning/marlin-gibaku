// MASUK KAWAL MEMAKAI COOKIE "INGAT SAYA" DARI PERAMBAN (DECISIONS 769) – terhadap
// DATABASE ASLI dan Kawal TIRUAN.
//
// Permintaan user 2026-11-15: *"aku punya cookies selalu ingat saya yang masih
// aktif di browser, sepertinya ada kendala di login, jadi untuk itu apakah kita
// bisa manfaatkan cookies yang selalu ingat saya ini?"*
//
// Yang dijaga:
// 1. cookie disimpan TERSANDI, tidak pernah polos di basis data atau di audit;
// 2. alamat + cookie saja sudah cukup – sinkron jalan tanpa nama akun/sandi;
// 3. cookie dipakai, formulir masuk TIDAK pernah dikirim, juga saat cookie ditolak
//    dan sandi tersimpan (supaya akun tidak terkunci karena dicoba berulang);
// 4. "Hapus cookie tersimpan" membuang cookie, sandi lama tetap.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { barisKawal, responsKawal } from "../fixtures/kawal-sintetis";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.AI_SECRET_ENCRYPTION_KEY = "kunci-uji-kawal-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let aktor: { id: string; orgId: string; role: string; mustChangePassword: boolean } | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => aktor,
  requireCapability: async () => aktor,
}));

const { db } = await import("@/lib/db");
const { kawalAkunAction } = await import("@/lib/kawal/actions");
const { sinkronKawal } = await import("@/lib/kawal/sinkron");
const { getAkunKawal, getAkunKawalTampil, setAkunKawal, KAWAL_ALAMAT_KEY, KAWAL_AKUN_KEY, KAWAL_SANDI_KEY, KAWAL_COOKIE_KEY } =
  await import("@/lib/kawal/setelan");

const suffix = `kc${Date.now().toString(36)}`;
const ALAMAT = "https://kawal.contoh.test";
const NILAI_INGAT = `nilai-ingat-${suffix}`;
const TEMPEL = `Cookie: XSRF-TOKEN=abc; remember_web_59ba=${NILAI_INGAT}; laravel_session=xyz`;
const SEMUA_KUNCI = [KAWAL_ALAMAT_KEY, KAWAL_AKUN_KEY, KAWAL_SANDI_KEY, KAWAL_COOKIE_KEY];

const FORM = `<html><head><meta name="csrf-token" content="t"></head><body>
<form method="post" action="/login"><input type="hidden" name="_token" value="t">
<input type="email" name="email"><input type="password" name="password"></form></body></html>`;

/** Kawal tiruan: API menerima cookie "ingat saya" yang sah; selain itu dialihkan ke /login. */
const permintaan: { metode: string; jalur: string }[] = [];
let ingatSah = true;
const fetchTiruan = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const metode = init?.method ?? "GET";
  permintaan.push({ metode, jalur: url.pathname });
  const cookie = new Headers(init?.headers).get("cookie") ?? "";
  if (url.pathname === "/api/knmp/locations" && ingatSah && cookie.includes(`remember_web_59ba=${NILAI_INGAT}`)) {
    const isi = responsKawal([barisKawal({ id: 1, desa: "Jauh", kabupaten: "Entah", kontrak: "KTR/LAIN/1" })]);
    return new Response(JSON.stringify(isi), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/login" && metode === "POST") {
    return new Response(null, { status: 302, headers: { location: "/knmp", "set-cookie": "sesi=masuk; Path=/" } });
  }
  if (url.pathname === "/api/knmp/locations") return new Response(null, { status: 302, headers: { location: "/login" } });
  return new Response(FORM, { status: 200, headers: { "content-type": "text/html" } });
}) as typeof fetch;

async function bersih() {
  // Snapshot sisa putaran sebelumnya membuat sinkron menjawab "tidak berubah".
  await db.$executeRawUnsafe(
    "TRUNCATE TABLE kawal_sarana_snapshots, kawal_location_snapshots, kawal_snapshots, kawal_location_maps, kawal_sync_runs",
  );
  await db.appSetting.deleteMany({ where: { key: { in: SEMUA_KUNCI } } });
}

function form(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  await bersih();
  const org = await db.organization.create({ data: { name: `Org KC ${suffix}`, slug: `org-kc-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `kc-${suffix}`, fullName: "Uji Cookie", passwordHash: "x", role: "super_admin" },
  });
  aktor = { id: u.id, orgId: org.id, role: "super_admin", mustChangePassword: false };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await bersih();
  // audit_logs append-only: org & pengguna uji ikut dibersihkan TRUNCATE berkas lain.
  await db.$disconnect();
});

describe("Kawal masuk dengan cookie 'ingat saya'", () => {
  it("cookie yang tidak terbaca ditolak dengan pesan yang jelas, tidak ada yang tersimpan", async () => {
    const r = await kawalAkunAction(undefined, form({ aksi: "simpan", alamat: ALAMAT, cookie: "bukan cookie" }));
    expect(r?.error).toMatch(/^Cookie tidak terbaca/);
    expect(await db.appSetting.count({ where: { key: { in: SEMUA_KUNCI } } })).toBe(0);
  });

  it("tanpa cookie dan tanpa sandi: diminta mengisi salah satunya", async () => {
    const r = await kawalAkunAction(undefined, form({ aksi: "simpan", alamat: ALAMAT }));
    expect(r?.error).toBe("Isi alamat Kawal, lalu cookie peramban, atau nama akun dan sandi.");
  });

  it("alamat + cookie saja cukup; cookie tersimpan tersandi dan tidak masuk audit", async () => {
    const r = await kawalAkunAction(undefined, form({ aksi: "simpan", alamat: ALAMAT, cookie: TEMPEL }));
    expect(r?.success).toMatch(/^Akun Kawal tersimpan/);

    const baris = await db.appSetting.findMany({ where: { key: KAWAL_COOKIE_KEY } });
    expect(baris).toHaveLength(1);
    expect(baris[0]!.value).not.toContain(NILAI_INGAT);

    const akun = await getAkunKawal();
    expect(akun).toMatchObject({ alamat: ALAMAT, akun: "", sandi: "" });
    // Kepala "Cookie:" dibuang, pasangan nama=nilai dipertahankan.
    expect(akun?.cookie).toBe(`XSRF-TOKEN=abc; remember_web_59ba=${NILAI_INGAT}; laravel_session=xyz`);
    expect(await getAkunKawalTampil()).toMatchObject({ adaCookie: true, adaSandi: false });

    const log = await db.auditLog.findFirst({
      where: { action: "system.kawal_akun", userId: aktor!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.payload).toMatchObject({ cookieDiganti: true, cookieDihapus: false });
    expect(JSON.stringify(log?.payload)).not.toContain(NILAI_INGAT);
  });

  it("sinkron memakai cookie: data diterima tanpa formulir masuk", async () => {
    permintaan.length = 0;
    ingatSah = true;
    const h = await sinkronKawal({ pemicu: "manual", fetchFn: fetchTiruan });
    expect(h.status, "pesan" in h ? h.pesan : "").toBe("berhasil");
    expect(permintaan.some((p) => p.metode === "POST")).toBe(false);
    expect(permintaan.some((p) => p.jalur === "/login")).toBe(false);
  });

  it("uji sambungan: cookie ditolak → gagal dengan sebabnya, sandi TIDAK dicoba walau tersimpan", async () => {
    await setAkunKawal({ alamat: ALAMAT, akun: "kontraktor@contoh.test", sandi: "rahasia" });
    permintaan.length = 0;
    ingatSah = false;
    vi.stubGlobal("fetch", fetchTiruan);
    const r = await kawalAkunAction(undefined, form({ aksi: "uji", alamat: "" }));
    vi.unstubAllGlobals();
    expect(r?.error).toMatch(/cookie 'ingat saya'/);
    expect(r?.error).toMatch(/Sandi sengaja tidak dicoba/);
    expect(permintaan.length).toBeGreaterThan(0);
    expect(permintaan.some((p) => p.metode === "POST")).toBe(false);
  });

  it("uji sambungan: cookie sah → berhasil, tetap tanpa formulir masuk", async () => {
    permintaan.length = 0;
    ingatSah = true;
    vi.stubGlobal("fetch", fetchTiruan);
    const r = await kawalAkunAction(undefined, form({ aksi: "uji", alamat: "" }));
    vi.unstubAllGlobals();
    expect(r?.success).toMatch(/^Berhasil masuk ke Kawal dan menerima 1 baris lokasi/);
    expect(permintaan.some((p) => p.metode === "POST")).toBe(false);
  });

  it("Hapus cookie tersimpan: cookie dibuang, sandi lama tetap dipakai", async () => {
    const r = await kawalAkunAction(undefined, form({ aksi: "simpan", alamat: "", hapusCookie: "1" }));
    expect(r?.success).toMatch(/^Akun Kawal tersimpan/);
    const akun = await getAkunKawal();
    expect(akun?.cookie ?? null).toBeNull();
    expect(akun).toMatchObject({ alamat: ALAMAT, akun: "kontraktor@contoh.test", sandi: "rahasia" });
    expect(await getAkunKawalTampil()).toMatchObject({ adaCookie: false, adaSandi: true });
  });
});
