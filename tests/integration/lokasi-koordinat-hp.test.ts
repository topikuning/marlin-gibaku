// KOORDINAT LOKASI DARI GPS HP (DECISIONS 772) – DB asli, lewat aksi layar.
//
// Permintaan user 2026-11-24, di lapangan: *"ada beberapa lokasi tidak sesuai
// koordinatnya. aku mau ada fitur yg aku bisa update koordinat itu kamu ambil
// langsung dari koordinat hp"*.
//
// Yang dijaga: titik HP tersimpan dengan sumber & akurasinya di audit; titik
// yang lebih lemah dari ±100 m ditolak server (bukan cuma layar) tanpa
// mengubah koordinat; isian tangan tetap jalan seperti sebelumnya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let aktor: { id: string; orgId: string; role: string; mustChangePassword: boolean } | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => aktor,
  requireCapability: async () => aktor,
  requireLocationAccess: async () => undefined,
}));

const { db } = await import("@/lib/db");
const { updateLocationMaster } = await import("@/app/(app)/lokasi/[slug]/actions");

const suffix = `kh${Date.now().toString(36)}`;
let lokasiId = "";

function kirim(isi: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ locationId: lokasiId, village: "Desa Uji", regency: "Kab. Uji", province: "Jawa Tengah", ...isi }))
    f.set(k, v);
  return updateLocationMaster(undefined, f);
}

const koordinat = async () => {
  const l = await db.location.findUniqueOrThrow({ where: { id: lokasiId }, select: { gpsLat: true, gpsLng: true } });
  return `${l.gpsLat?.toString()},${l.gpsLng?.toString()}`;
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org KH ${suffix}`, slug: `org-kh-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `kh-${suffix}`, fullName: "Uji Koordinat", passwordHash: "x", role: "super_admin" },
  });
  aktor = { id: u.id, orgId: org.id, role: "super_admin", mustChangePassword: false };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket KH ${suffix}`, stage: "pelaksanaan" } });
  lokasiId = (
    await db.location.create({
      data: {
        packageId: pkg.id,
        name: "Lokasi KH",
        slug: `kh-${suffix}`,
        village: "Desa Uji",
        regency: "Kab. Uji",
        province: "Jawa Tengah",
        gpsLat: "-6.8700000",
        gpsLng: "109.2500000",
      },
    })
  ).id;
});

afterAll(async () => {
  // audit_logs append-only: org & data uji ikut TRUNCATE berkas lain.
  await db.$disconnect();
});

describe("koordinat dari GPS HP", () => {
  it("titik HP ±8 m tersimpan; audit menyebut sumber & akurasi; pesan menyebut pergeseran", async () => {
    const r = await kirim({ gpsLat: "-6.8710000", gpsLng: "109.2500000", gpsSumber: "hp", gpsAkurasi: "8" });
    expect(r?.error).toBeUndefined();
    expect(r?.success).toBe("Koordinat diperbarui dari GPS HP (±8 m). Bergeser 111 m dari titik lama.");
    expect(await koordinat()).toBe("-6.871,109.25");
    const log = await db.auditLog.findFirst({
      where: { action: "location.master_update", resourceId: lokasiId },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.payload).toMatchObject({ gpsSumber: "hp", gpsAkurasiM: 8, after: { gps: "-6.871,109.25" } });
  });

  it("titik HP lebih lemah dari ±100 m ditolak server, koordinat tidak berubah", async () => {
    const r = await kirim({ gpsLat: "-6.9000000", gpsLng: "109.3000000", gpsSumber: "hp", gpsAkurasi: "250" });
    expect(r?.error).toMatch(/kurang akurat \(±250 m\)/);
    expect(await koordinat()).toBe("-6.871,109.25");
  });

  it("titik HP tanpa akurasi ditolak", async () => {
    const r = await kirim({ gpsLat: "-6.9000000", gpsLng: "109.3000000", gpsSumber: "hp" });
    expect(r?.error).toMatch(/Akurasi GPS HP tidak terbaca/);
  });

  it("isian tangan tetap jalan, audit tanpa sumber HP", async () => {
    const r = await kirim({ gpsLat: "-6.8720000", gpsLng: "109.2510000" });
    expect(r?.success).toBe("Master data lokasi tersimpan.");
    const log = await db.auditLog.findFirst({
      where: { action: "location.master_update", resourceId: lokasiId },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.payload).not.toHaveProperty("gpsSumber");
  });
});
