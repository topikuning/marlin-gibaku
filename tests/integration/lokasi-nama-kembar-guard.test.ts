// DUA NAMA KEMBAR DI SATU PAKET TIDAK BOLEH BISA DIBUAT.
//
// Pertanyaan user 2026-09-16: *"ada nama lokasi yang double sama, satu masuk
// kontrak a, satu kontrak b. saat lokasi a dipindah ke lokasi b, apa yang
// terjadi. dan kenapa ini bisa terjadi?"*
//
// Jawabannya: perpindahannya BERHASIL tanpa peringatan apa pun, karena
// `Location` tidak punya kunci alami yang unik (indeks itu hanya ada di
// `MasterLocation`) dan tidak satu pun jalur pembuatan/pemindahan lokasi
// memeriksa nama. Angkanya sendiri tetap benar — semua agregasi lewat
// `location.id` — tapi `matchLocation` (src/lib/gdrive/classify.ts) memilah
// berkas Google Drive LEWAT NAMA dari daftar lokasi SATU paket dan memakai yang
// pertama cocok. Begitu dua nama kembar berada di paket yang sama, berkas
// lapangan bisa terarsip ke lokasi yang salah, diam-diam.
//
// Uji ini menutup dua pintu masuknya: menambah lokasi target, dan memindahkan
// lokasi antar paket.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tanpa izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { addTargetLocation } = await import("@/lib/package/actions");
const { pindahkanLokasi, PindahLokasiError } = await import("@/lib/package/pindah-lokasi");

const suffix = `nk${Date.now().toString(36)}`;

let paketA = "";
let paketB = "";
let lokasiA = "";

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

const isianLokasi = (nama: string, packageId: string) => ({
  packageId,
  name: nama,
  village: "Sukamaju",
  district: "Wedung",
  regency: "Demak",
  province: "Jawa Tengah",
});

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  sessionOrgId = org.id;
  sessionUserId = (
    await db.user.create({
      data: { orgId: org.id, username: `u-${suffix}`, fullName: "Admin", passwordHash: "x", role: "super_admin" },
      select: { id: true },
    })
  ).id;

  paketA = (await db.package.create({ data: { orgId: org.id, name: `Paket A ${suffix}`, stage: "prospek" } })).id;
  paketB = (await db.package.create({ data: { orgId: org.id, name: `Paket B ${suffix}`, stage: "prospek" } })).id;

  const r = await addTargetLocation(undefined, fd(isianLokasi("Sukamaju", paketA)));
  if (!r?.success) throw new Error(`lokasi awal gagal dibuat: ${JSON.stringify(r)}`);
  lokasiA = (
    await db.location.findFirstOrThrow({ where: { packageId: paketA }, select: { id: true } })
  ).id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("tambah lokasi target", () => {
  it("nama kembar di paket yang sama DITOLAK, dan penyebabnya disebut", async () => {
    const r = await addTargetLocation(undefined, fd(isianLokasi("SUKAMAJU", paketA)));
    expect(r?.error ?? "").toMatch(/sudah ada lokasi bernama/i);
    expect(await db.location.count({ where: { packageId: paketA } })).toBe(1);
  });

  it("nama sama di PAKET LAIN tetap boleh – desa senama di kabupaten lain itu nyata", async () => {
    const r = await addTargetLocation(
      undefined,
      fd({ ...isianLokasi("Sukamaju", paketB), regency: "Pati" }),
    );
    expect(r?.error).toBeUndefined();
    expect(await db.location.count({ where: { packageId: paketB } })).toBe(1);
  });

  it("desa yang SAMA PERSIS (kunci alaminya) ditolak walau di paket lain", async () => {
    const r = await addTargetLocation(undefined, fd(isianLokasi("Sukamaju Dua", paketB)));
    expect(r?.error ?? "").toMatch(/sudah terdaftar|sudah ada/i);
  });
});

describe("pindahkan lokasi ke paket lain", () => {
  it("DITOLAK bila paket tujuan sudah punya lokasi bernama sama", async () => {
    await expect(
      pindahkanLokasi(
        { locationId: lokasiA, tujuanPackageId: paketB, mode: "paksa", alasan: "salah paket" },
        { id: sessionUserId, orgId: sessionOrgId },
        null,
      ),
    ).rejects.toBeInstanceOf(PindahLokasiError);

    // Dan lokasinya memang TIDAK berpindah.
    const tetap = await db.location.findUniqueOrThrow({
      where: { id: lokasiA },
      select: { packageId: true },
    });
    expect(tetap.packageId).toBe(paketA);
  });

  it("boleh lagi sesudah salah satunya diberi nama pembeda", async () => {
    await db.location.updateMany({ where: { packageId: paketB }, data: { name: "Sukamaju (Pati)" } });
    const hasil = await pindahkanLokasi(
      { locationId: lokasiA, tujuanPackageId: paketB, mode: "paksa", alasan: "salah paket" },
      { id: sessionUserId, orgId: sessionOrgId },
      null,
    );
    expect(hasil.kePaket).toContain("Paket B");
    const pindah = await db.location.findUniqueOrThrow({
      where: { id: lokasiA },
      select: { packageId: true },
    });
    expect(pindah.packageId).toBe(paketB);
  });
});
