// Hapus foto laporan harian — aturan izin & gerbang status.
//
// Sebelum ini foto laporan harian TIDAK BISA dihapus sama sekali: aksinya
// memang tidak pernah dibuat. Lebih buruk, menghapus item pekerjaan hanya
// MELEPAS fotonya (`reportItemId = null`) dan foto itu lalu tidak tampil di
// mana pun — mustahil dibersihkan, baik dari layar maupun dari bucket.
//
// Aturan (keputusan user 28 Juli 2026): yang boleh menghapus adalah PENGUNGGAH
// foto itu sendiri, Site Manager, atau Super Admin — dan hanya selama laporan
// masih draft / perlu koreksi.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// R2 tidak tersedia di lingkungan uji — penghapusan objeknya dilewati.
vi.mock("@/lib/r2", () => ({ isR2Configured: () => false, r2Delete: async () => {} }));

/** Sesi aktif yang bisa diganti-ganti per kasus uji. */
let sesi: { id: string; role: string } = { id: "", role: "super_admin" };

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(sesi.id),
    requireCapability: async () => pengguna(sesi.id),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { removeReportPhotoAction } = await import("@/lib/daily-report/actions");

const suffix = `hf${Date.now().toString(36)}`;
let locationId: string;
let reportId: string;
let mandorId: string;
let mandorLainId: string;
let smId: string;
let saId: string;

async function pengguna(id: string) {
  return db.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org HF ${suffix}`, slug: `org-${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket HF ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi HF",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = loc.id;

  const buatUser = async (tag: string, role: "field_supervisor" | "site_manager" | "super_admin") =>
    (
      await db.user.create({
        data: { orgId: org.id, username: `${tag}-${suffix}`, fullName: tag, passwordHash: "x", role },
      })
    ).id;
  mandorId = await buatUser("mandor", "field_supervisor");
  mandorLainId = await buatUser("mandor2", "field_supervisor");
  smId = await buatUser("sm", "site_manager");
  saId = await buatUser("sa", "super_admin");

  const report = await db.dailyReport.create({
    data: {
      locationId,
      reportDate: new Date("2026-07-01T00:00:00Z"),
      status: "draft",
      createdById: mandorId,
    },
  });
  reportId = report.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

let nomor = 0;

/** Satu foto milik `uploadedById`, menempel ke laporan (tanpa item = yatim). */
async function buatFoto(uploadedById: string): Promise<string> {
  const p = await db.photo.create({
    data: {
      locationId,
      reportId,
      uploadedById,
      r2Key: `photos/${suffix}/${++nomor}.webp`,
      sha256: `${suffix}${nomor}`,
      bytes: 100,
    },
  });
  return p.id;
}

async function hapus(photoId: string) {
  const fd = new FormData();
  fd.set("photoId", photoId);
  return removeReportPhotoAction(undefined, fd);
}

const ada = async (photoId: string) => (await db.photo.count({ where: { id: photoId } })) === 1;

beforeEach(async () => {
  await db.dailyReport.update({ where: { id: reportId }, data: { status: "draft" } });
});

describe("hapus foto laporan harian – siapa yang boleh", () => {
  it("pengunggah boleh menghapus fotonya sendiri", async () => {
    const foto = await buatFoto(mandorId);
    sesi = { id: mandorId, role: "field_supervisor" };
    expect((await hapus(foto))?.success).toBeTruthy();
    expect(await ada(foto)).toBe(false);
  });

  it("mandor LAIN tidak boleh menghapus foto orang", async () => {
    const foto = await buatFoto(mandorId);
    sesi = { id: mandorLainId, role: "field_supervisor" };
    const hasil = await hapus(foto);
    expect(hasil?.error).toMatch(/pengunggah foto/i);
    expect(await ada(foto), "foto harus tetap ada").toBe(true);
  });

  it("Site Manager boleh menghapus foto orang lain", async () => {
    const foto = await buatFoto(mandorId);
    sesi = { id: smId, role: "site_manager" };
    expect((await hapus(foto))?.success).toBeTruthy();
    expect(await ada(foto)).toBe(false);
  });

  it("Super Admin boleh menghapus foto orang lain", async () => {
    const foto = await buatFoto(mandorId);
    sesi = { id: saId, role: "super_admin" };
    expect((await hapus(foto))?.success).toBeTruthy();
    expect(await ada(foto)).toBe(false);
  });
});

describe("hapus foto laporan harian – gerbang status", () => {
  it("laporan DIKIRIM: ditolak, foto tetap utuh (bukti sudah jadi dasar verifikasi)", async () => {
    const foto = await buatFoto(mandorId);
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "dikirim" } });
    sesi = { id: saId, role: "super_admin" };
    const hasil = await hapus(foto);
    expect(hasil?.error).toMatch(/Draft atau Perlu Koreksi/i);
    expect(await ada(foto)).toBe(true);
  });

  it("laporan PERLU KOREKSI: boleh – memang untuk diperbaiki", async () => {
    const foto = await buatFoto(mandorId);
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "perlu_koreksi" } });
    sesi = { id: mandorId, role: "field_supervisor" };
    expect((await hapus(foto))?.success).toBeTruthy();
    expect(await ada(foto)).toBe(false);
  });

  it("laporan FINAL: ditolak", async () => {
    const foto = await buatFoto(mandorId);
    await db.dailyReport.update({ where: { id: reportId }, data: { status: "final" } });
    sesi = { id: saId, role: "super_admin" };
    expect((await hapus(foto))?.error).toBeTruthy();
    expect(await ada(foto)).toBe(true);
  });
});

describe("foto yatim tetap bisa dibersihkan", () => {
  it("foto tanpa item (item-nya sudah dihapus) tetap terjangkau dan bisa dihapus", async () => {
    // Persis kondisi yang dulu mustahil dibersihkan: reportId ada, item tidak.
    const foto = await buatFoto(mandorId);
    const row = await db.photo.findUniqueOrThrow({
      where: { id: foto },
      select: { reportId: true, reportItemId: true },
    });
    expect(row.reportId).toBe(reportId);
    expect(row.reportItemId, "yatim = tanpa item").toBeNull();

    sesi = { id: smId, role: "site_manager" };
    expect((await hapus(foto))?.success).toBeTruthy();
    expect(await ada(foto)).toBe(false);
  });
});
