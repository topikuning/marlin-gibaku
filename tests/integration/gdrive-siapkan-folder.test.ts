/*
 * SIAPKAN FOLDER DRIVE (DECISIONS 715) – aksi di halaman paket membuat
 * kerangka folder baku KKP yang belum ada di folder Drive paket.
 *
 * Klien Drive ditiru di memori; yang diuji di sini sambungannya: nama penyedia
 * dari kontrak, folder per lokasi dari lokasi aktif paket, gerbang kapabilitas,
 * jejak audit, dan bahwa menekan lagi tidak membuat apa pun.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let peran: "super_admin" | "site_manager" = "super_admin";
let pengguna: { id: string; orgId: string; role: string } | null = null;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(peran as never, cap)) throw new asli.ForbiddenError("Tidak berhak.");
      return { ...pengguna!, role: peran };
    },
    requestIp: async () => null,
  };
});

/** Drive tiruan: id → { nama, induk }. */
const folder = new Map<string, { name: string; parent: string }>();
let urut = 0;
vi.mock("@/lib/gdrive/client", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/gdrive/client")>();
  return {
    ...asli,
    daftarSubfolder: async (parentId: string) =>
      [...folder.entries()].filter(([, f]) => f.parent === parentId).map(([id, f]) => ({ id, name: f.name })),
    buatFolder: async (parentId: string, name: string) => {
      const id = `f${++urut}`;
      folder.set(id, { name, parent: parentId });
      return id;
    },
  };
});

const { db } = await import("@/lib/db");
const { siapkanFolderDriveAction } = await import("@/lib/gdrive/actions");

const suffix = `gs${Date.now().toString(36)}`;
const AKAR = `akar-${suffix}`;
let orgId = "";
let packageId = "";

const anak = (parent: string) => [...folder.entries()].filter(([, f]) => f.parent === parent);
const idDari = (parent: string, name: string) => anak(parent).find(([, f]) => f.name === name)?.[0] ?? null;

function siapkan() {
  const fd = new FormData();
  fd.set("packageId", packageId);
  return siapkanFolderDriveAction(undefined, fd);
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org GS ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `sa-${suffix}`, fullName: "SA", passwordHash: "x", role: "super_admin" },
  });
  pengguna = { id: u.id, orgId, role: "super_admin" };
  const pkg = await db.package.create({
    data: { orgId, name: `Paket GS ${suffix}`, stage: "pelaksanaan", driveFolderId: AKAR },
  });
  packageId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId, name: `CV. Uji Fahlevi ${suffix}` } });
  await db.contract.create({
    data: {
      packageId,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000_000n,
      durationDays: 150,
      signedDate: new Date("2026-07-15T00:00:00.000Z"),
    },
  });
  const lokasi = (name: string, isActive: boolean) =>
    db.location.create({
      data: { packageId, name, slug: `${name.toLowerCase()}-${suffix}`, village: "D", regency: "K", province: "P", isActive },
    });
  await lokasi("Muarareja", true);
  await lokasi("Asemdoyong", true);
  await lokasi("Belum Aktif", false);
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("siapkanFolderDriveAction", () => {
  it("peran tanpa wewenang mengatur Drive paket ditolak, tidak ada folder dibuat", async () => {
    peran = "site_manager";
    try {
      const r = await siapkan();
      expect(r?.error).toBeTruthy();
      expect(folder.size).toBe(0);
    } finally {
      peran = "super_admin";
    }
  });

  it("Drive kosong → kerangka lengkap: nama penyedia dari kontrak, folder lokasi aktif saja", async () => {
    const r = await siapkan();
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/folder baru dibuat/);

    expect(anak(AKAR).map(([, f]) => f.name)).toContain("2. Peninjauan Lokasi, PCM, MC-0");
    const harian = idDari(AKAR, "3. LAPORAN HARIAN")!;
    expect(anak(harian).map(([, f]) => f.name).sort()).toEqual(["Asemdoyong", "Muarareja"]);

    const termin = idDari(AKAR, "7. BERKAS TERMIN")!;
    const t1 = idDari(termin, `TERMIN 1 (25%) CV. Uji Fahlevi ${suffix}`);
    expect(t1).not.toBeNull();
    expect(idDari(idDari(t1!, "9. Pemeriksaan Pekerjaan")!, "a. Surat Permohonan Pemeriksaan Pekerjaan")).not.toBeNull();

    const jejak = await db.auditLog.findFirst({
      where: { action: "gdrive.siapkan_folder", resourceId: packageId },
      select: { payload: true },
    });
    expect((jejak?.payload as { selesai?: boolean } | null)?.selesai).toBe(true);
  });

  it("ditekan lagi → tidak ada yang dibuat", async () => {
    const sebelum = folder.size;
    const r = await siapkan();
    expect(r?.success).toMatch(/sudah ada\. Tidak ada yang perlu dibuat/);
    expect(folder.size).toBe(sebelum);
  });
});
