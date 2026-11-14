// SAKELAR TANDA TANGAN KETIK DI HALAMAN LOKASI (DECISIONS 766) – terhadap DATABASE ASLI.
//
// Permintaan user 2026-11-14: *"untuk fitur tanda tangan yang auto terisi, perlu
// toggle on/off dengan default off. yang kontrolnya ada di lokasi"*.
//
// Yang dijaga:
// 1. nyala lalu mati lagi, tercatat di audit dengan keadaan sebelum & sesudah;
// 2. hanya lokasi yang dituju yang berubah;
// 3. peran tanpa `location.signer` dan lokasi organisasi lain ditolak, tidak ada
//    yang ditulis; isian tidak sah ditolak.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let sesi = { id: "", orgId: "", role: "site_manager" };
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  class ForbiddenError extends Error {}
  const user = () => ({ ...sesi, fullName: "Tester", username: "tester" });
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    hasLocationAccess: async () => true,
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(sesi.role as never, cap as never)) throw new ForbiddenError("Anda tidak punya izin untuk tindakan ini.");
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { setTtdKetikLokasi } = await import("@/lib/laporan/pelaksana-actions");

const suffix = `sk${Date.now().toString(36)}`;
let lokasi = "";
let tetangga = "";
let lokasiLain = "";

const kirim = (isi: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return setTtdKetikLokasi(undefined, f);
};
const sakelar = async (id: string) =>
  (await db.location.findUniqueOrThrow({ where: { id }, select: { ttdKetik: true } })).ttdKetik;

beforeAll(async () => {
  const buatLokasi = async (orgId: string, tag: string) => {
    const pkg = await db.package.create({ data: { orgId, name: `Paket ${tag} ${suffix}`, stage: "pelaksanaan" } });
    return (
      await db.location.create({
        data: { packageId: pkg.id, name: `Lokasi ${tag}`, slug: `lok-${tag}-${suffix}`, village: "D", regency: "K", province: "P" },
      })
    ).id;
  };
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `sm-${suffix}`, fullName: "SM Uji", role: "site_manager", passwordHash: "x" },
  });
  sesi = { id: u.id, orgId: org.id, role: "site_manager" };
  lokasi = await buatLokasi(org.id, "a");
  tetangga = await buatLokasi(org.id, "b");
  const orgLain = await db.organization.create({ data: { name: `Org lain ${suffix}`, slug: `ol-${suffix}` } });
  lokasiLain = await buatLokasi(orgLain.id, "c");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sakelar tanda tangan ketik di halaman lokasi", () => {
  it("bawaan mati", async () => {
    expect(await sakelar(lokasi)).toBe(false);
  });

  it("Site Manager menyalakannya: hanya lokasi itu yang berubah, tercatat di audit", async () => {
    const r = await kirim({ locationId: lokasi, aktif: "1" });
    expect(r?.success).toMatch(/DINYALAKAN/);
    expect(await sakelar(lokasi)).toBe(true);
    expect(await sakelar(tetangga)).toBe(false);
    const log = await db.auditLog.findFirst({
      where: { action: "lokasi.ttd_ketik", resourceId: lokasi },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.userId).toBe(sesi.id);
    expect(log?.payload).toMatchObject({ sebelum: false, sesudah: true });
  });

  it("lalu mematikannya lagi", async () => {
    const r = await kirim({ locationId: lokasi, aktif: "0" });
    expect(r?.success).toMatch(/DIMATIKAN/);
    expect(await sakelar(lokasi)).toBe(false);
    expect(await db.auditLog.count({ where: { action: "lokasi.ttd_ketik", resourceId: lokasi } })).toBe(2);
  });

  it("peran tanpa izin penanda tangan lokasi ditolak, tidak ada yang ditulis", async () => {
    const asli = sesi.role;
    sesi.role = "field_supervisor";
    try {
      await expect(kirim({ locationId: lokasi, aktif: "1" })).rejects.toThrow(/izin/);
      expect(await sakelar(lokasi)).toBe(false);
    } finally {
      sesi.role = asli;
    }
  });

  it("lokasi organisasi lain dan isian tidak sah ditolak", async () => {
    expect((await kirim({ locationId: lokasiLain, aktif: "1" }))?.error).toMatch(/tidak ditemukan/);
    expect(await sakelar(lokasiLain)).toBe(false);
    expect((await kirim({ locationId: lokasi, aktif: "ya" }))?.error).toBeTruthy();
    expect((await kirim({ locationId: "bukan-uuid", aktif: "1" }))?.error).toBeTruthy();
    expect(await sakelar(lokasi)).toBe(false);
  });
});
