/*
 * HAK AKSES PER PERAN DIATUR SUPER ADMIN DARI LAYAR SISTEM (DECISIONS 793).
 *
 * Permintaan user 2026-11-26: *"jika ada levelling seperti ini lebih baik ada
 * kontrol langsung di aplikasi yang aku tinggal atur siapa yang boleh dan tidak
 * melalui login super admin"*. Kasus pemicunya: Project Manager ditolak
 * mengembalikan foto ke Foto Cepat (DECISIONS 792).
 *
 * Yang dibuktikan, ujung ke ujung:
 * - Super Admin mencabut "urus foto orang lain" dari Project Manager → PM
 *   ditolak sungguhan di aksi foto; Site Manager (bawahannya) ikut tercabut;
 * - Super Admin memberinya lagi → PM bisa;
 * - selain Super Admin ditolak; sel terkunci ditolak; semua tercatat di audit;
 * - "kembalikan semua ke bawaan" membuang semua pengaturan.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `ha${Date.now().toString(36)}`;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

type Peran = "super_admin" | "program_director" | "project_manager" | "site_manager" | "field_supervisor";
type UserUji = { id: string; orgId: string; username: string; role: Peran };
let sebagai: UserUji;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireUser: async () => sebagai,
    getCurrentUser: async () => sebagai,
    hasLocationAccess: async () => true,
    // Penjaga kapabilitas yang SUNGGUHAN memakai can() – pengaturan harus terasa di sini.
    requireCapability: async (c: Parameters<typeof can>[1]) => {
      if (!can(sebagai.role, c)) throw new asli.ForbiddenError();
      return sebagai;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { can } = await import("@/lib/authz");
const { ubahHakAksesAction, kembalikanBawaanHakAksesAction } = await import("@/lib/hak-akses/actions");
const { segarkanHakAkses } = await import("@/lib/hak-akses/muat");
const { returnPhotoToKantongAction } = await import("@/lib/daily-report/actions");
const { getOrCreateDraft } = await import("@/lib/daily-report/service");

let orang: Record<Peran, UserUji>;
let locationId: string;

beforeAll(async () => {
  await db.hakAksesPeran.deleteMany({});
  await segarkanHakAkses();
  const org = await db.organization.create({ data: { name: `Org HA ${suffix}`, slug: `org-${suffix}` } });
  const buat = async (role: Peran): Promise<UserUji> => {
    const u = await db.user.create({
      data: { orgId: org.id, username: `${role}-${suffix}`, fullName: role, passwordHash: "x", role },
    });
    return { id: u.id, orgId: org.id, username: u.username!, role };
  };
  orang = {
    super_admin: await buat("super_admin"),
    program_director: await buat("program_director"),
    project_manager: await buat("project_manager"),
    site_manager: await buat("site_manager"),
    field_supervisor: await buat("field_supervisor"),
  };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}` } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: `Lokasi ${suffix}`, slug: `lok-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
});

afterAll(async () => {
  // Tabel ini global: jangan tinggalkan pengaturan untuk berkas uji berikutnya.
  await db.hakAksesPeran.deleteMany({});
  await segarkanHakAkses();
});

let hari = 1;
/** Foto tanpa pekerjaan di laporan Draft, diunggah Pelaksana. */
async function fotoYatim() {
  const r = await getOrCreateDraft(locationId, `2026-09-${String(hari++).padStart(2, "0")}`, orang.field_supervisor.id);
  const sha = randomUUID().replace(/-/g, "");
  return db.photo.create({
    data: { r2Key: `uji/${sha}.jpg`, sha256: sha, bytes: 1, locationId, reportId: r.id, uploadedById: orang.field_supervisor.id },
  });
}

async function atur(oleh: UserUji, role: string, capability: string, boleh: boolean) {
  sebagai = oleh;
  const fd = new FormData();
  fd.set("role", role);
  fd.set("capability", capability);
  fd.set("boleh", boleh ? "1" : "0");
  return ubahHakAksesAction(undefined, fd);
}

async function kembalikanOleh(u: UserUji, photoId: string) {
  sebagai = u;
  const fd = new FormData();
  fd.set("photoId", photoId);
  return returnPhotoToKantongAction(undefined, fd);
}

describe("hak akses diatur Super Admin", () => {
  it("cabut 'urus foto orang lain' dari Project Manager: PM ditolak sungguhan, Site Manager ikut, atasan tetap", async () => {
    const r = await atur(orang.super_admin, "project_manager", "photo.manage_others", false);
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/dicabut dari Project Manager, Site Manager/);

    expect(can("project_manager", "photo.manage_others")).toBe(false);
    expect(can("site_manager", "photo.manage_others")).toBe(false);
    expect(can("regional_manager", "photo.manage_others")).toBe(true);
    expect(
      (await db.hakAksesPeran.findMany({ where: { capability: "photo.manage_others" }, orderBy: { role: "asc" } })).map(
        (x) => [x.role, x.boleh],
      ),
    ).toEqual([
      ["project_manager", false],
      ["site_manager", false],
    ]);

    const f = await fotoYatim();
    expect((await kembalikanOleh(orang.project_manager, f.id))?.error).toMatch(/Hanya pengunggah foto/);
    expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).reportId).not.toBeNull();

    const jejak = await db.auditLog.findFirstOrThrow({ where: { action: "hak_akses.ubah", userId: orang.super_admin.id } });
    expect(jejak.payload).toMatchObject({ capability: "photo.manage_others", diminta: { role: "project_manager", boleh: false } });
  });

  it("diberi lagi ke Project Manager: PM bisa mengembalikan foto, barisnya kembali ke bawaan", async () => {
    const r = await atur(orang.super_admin, "project_manager", "photo.manage_others", true);
    expect(r?.success).toMatch(/kini berlaku untuk Project Manager/);
    expect(can("project_manager", "photo.manage_others")).toBe(true);
    // Site Manager tetap tercabut sampai diberi sendiri.
    expect(can("site_manager", "photo.manage_others")).toBe(false);
    const f = await fotoYatim();
    expect((await kembalikanOleh(orang.project_manager, f.id))?.error).toBeUndefined();
    expect(await db.hakAksesPeran.count({ where: { role: "project_manager" } })).toBe(0);
  });

  it("selain Super Admin ditolak – juga Program Director", async () => {
    const r = await atur(orang.program_director, "site_manager", "photo.manage_others", true);
    expect(r?.error).toBeTruthy();
    expect(can("site_manager", "photo.manage_others")).toBe(false);
  });

  it("sel terkunci ditolak dengan alasannya", async () => {
    const r = await atur(orang.super_admin, "field_supervisor", "money.view", true);
    expect(r?.error).toMatch(/Pelaksana tidak melihat rupiah/);
    expect(can("field_supervisor", "money.view")).toBe(false);
  });

  it("kembalikan semua ke bawaan: pengaturan dibuang, hak kembali seperti program", async () => {
    sebagai = orang.super_admin;
    const r = await kembalikanBawaanHakAksesAction(undefined, new FormData());
    expect(r?.success).toMatch(/kembali ke bawaan/);
    expect(await db.hakAksesPeran.count()).toBe(0);
    expect(can("site_manager", "photo.manage_others")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "hak_akses.kembali_bawaan", userId: orang.super_admin.id } })).toBe(1);
  });
});
