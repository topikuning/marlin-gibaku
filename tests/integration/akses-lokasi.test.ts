// SIAPA PUNYA AKSES KE SATU LOKASI, DAN SEBAGAI APA (DECISIONS 571).
//
// Permintaan user 2026-09-13: *"di halaman lokasi, entah dimana, juga harus ada
// informasi siapa saja pengguna yang punya akses dan sebagai apa. bahkan untuk
// super admin tambahkan menu untuk bisa langsung tambahkan pengguna ke
// lokasi."*
//
// Yang paling mudah salah di daftar seperti ini: akses datang dari DUA jalan —
// penugasan per lokasi, dan peran lintas-lokasi yang melihat semuanya tanpa
// pernah ditugaskan. Daftar yang menyebut salah satunya saja terbaca LENGKAP,
// dan itu justru lebih berbahaya daripada tidak ada daftar sama sekali.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { db } = await import("@/lib/db");
const { aksesLokasi, beriAkses, cabutAkses, calonDitugaskan, AksesLokasiError } = await import(
  "@/lib/users/akses-lokasi"
);

const suffix = `ak${Date.now().toString(36)}`;
let orgId: string;
let orgLain: string;
let locationId: string;
let aktor: { id: string; orgId: string };
const orang: Record<string, string> = {};

async function buatUser(tag: string, role: string, org = orgId) {
  const u = await db.user.create({
    data: {
      orgId: org,
      username: `${tag}-${suffix}`,
      fullName: `Uji ${tag}`,
      passwordHash: "x",
      role: role as never,
    },
  });
  orang[tag] = u.id;
  return u.id;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AK ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const lain = await db.organization.create({ data: { name: `Org LAIN ${suffix}`, slug: `lain-${suffix}` } });
  orgLain = lain.id;

  const pkg = await db.package.create({ data: { orgId, name: `Paket AK ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi AK",
      slug: `lokasi-${suffix}`,
      village: "D",
      regency: "K",
      province: "P",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  await buatUser("sa", "super_admin");
  await buatUser("pd", "program_director");
  await buatUser("sm", "site_manager");
  await buatUser("pelaksana", "field_supervisor");
  await buatUser("smLain", "site_manager", orgLain);
  aktor = { id: orang.sa!, orgId };

  await db.locationAssignment.create({ data: { userId: orang.sm!, locationId } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("daftar akses lokasi", () => {
  it("menyebut yang DITUGASKAN dan yang berakses karena PERAN, dengan bedanya", async () => {
    const baris = await aksesLokasi(locationId, orgId);
    const sm = baris.find((b) => b.userId === orang.sm);
    const pd = baris.find((b) => b.userId === orang.pd);
    expect(sm).toMatchObject({ jalan: "penugasan", peran: "Site Manager" });
    expect(pd, "peran lintas-lokasi tidak disebut – daftarnya terbaca lengkap padahal kurang").toMatchObject(
      { jalan: "peran", peran: "Program Director" },
    );
    // Yang ditugaskan disebut lebih dulu: merekalah yang mengerjakan lokasi ini.
    expect(baris[0]!.jalan).toBe("penugasan");
  });

  it("yang tidak ditugaskan dan tidak lintas-lokasi TIDAK ikut", async () => {
    const baris = await aksesLokasi(locationId, orgId);
    expect(baris.some((b) => b.userId === orang.pelaksana)).toBe(false);
  });

  it("organisasi lain tidak pernah bocor ke daftar", async () => {
    const baris = await aksesLokasi(locationId, orgId);
    expect(baris.some((b) => b.userId === orang.smLain)).toBe(false);
  });

  it("calon hanya yang belum punya akses, tanpa peran lintas-lokasi", async () => {
    const calon = await calonDitugaskan(locationId, orgId);
    const id = calon.map((c) => c.id);
    expect(id).toContain(orang.pelaksana);
    expect(id, "yang sudah ditugaskan masih ditawarkan").not.toContain(orang.sm);
    expect(id, "peran lintas-lokasi ditawarkan padahal sudah bisa membuka semua").not.toContain(orang.pd);
    expect(id).not.toContain(orang.smLain);
  });
});

describe("memberi & mencabut akses", () => {
  it("memberi akses membuat orangnya muncul sebagai ditugaskan", async () => {
    await beriAkses(locationId, orang.pelaksana!, aktor);
    const baris = await aksesLokasi(locationId, orgId);
    expect(baris.find((b) => b.userId === orang.pelaksana)).toMatchObject({ jalan: "penugasan" });
  });

  it("mencabut TIDAK menghapus barisnya, hanya menutup masanya", async () => {
    // Riwayat siapa pernah memegang lokasi ini bagian dari jejak, bukan sampah.
    await cabutAkses(locationId, orang.pelaksana!, aktor);
    const baris = await aksesLokasi(locationId, orgId);
    expect(baris.some((b) => b.userId === orang.pelaksana)).toBe(false);
    const row = await db.locationAssignment.findFirstOrThrow({
      where: { locationId, userId: orang.pelaksana! },
    });
    expect(row.unassignedAt).not.toBeNull();
  });

  it("memberi akses lagi menghidupkan baris lama, tidak menggandakannya", async () => {
    await beriAkses(locationId, orang.pelaksana!, aktor);
    const n = await db.locationAssignment.count({ where: { locationId, userId: orang.pelaksana! } });
    expect(n).toBe(1);
    await cabutAkses(locationId, orang.pelaksana!, aktor);
  });

  it("pengguna organisasi LAIN ditolak (AUTH-03)", async () => {
    // Kalau ini lolos, orang organisasi lain melihat seluruh isi lokasi ini.
    await expect(beriAkses(locationId, orang.smLain!, aktor)).rejects.toBeInstanceOf(AksesLokasiError);
  });

  it("peran lintas-lokasi ditolak dengan alasannya, bukan ditambahkan diam-diam", async () => {
    await expect(beriAkses(locationId, orang.pd!, aktor)).rejects.toThrow(/sudah bisa membuka semua lokasi/i);
  });

  it("mencabut yang tidak ditugaskan ditolak jelas", async () => {
    await expect(cabutAkses(locationId, orang.pd!, aktor)).rejects.toThrow(/tidak ditemukan/i);
  });
});
