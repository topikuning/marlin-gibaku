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

/** Drive tiruan: id → { nama, induk, tujuan pintasan, kapan dibuat }. */
type Isi = { name: string; parent: string; target?: string; dibuat?: Date; trashed?: boolean };
const folder = new Map<string, Isi>();
let urut = 0;
const hidup = () => [...folder.entries()].filter(([, f]) => !f.trashed);
vi.mock("@/lib/gdrive/client", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/gdrive/client")>();
  return {
    ...asli,
    daftarSubfolder: async (parentId: string) =>
      hidup().filter(([, f]) => f.parent === parentId && !f.target).map(([id, f]) => ({ id, name: f.name })),
    buatFolder: async (parentId: string, name: string) => {
      const id = `f${++urut}`;
      folder.set(id, { name, parent: parentId });
      return id;
    },
    daftarPintasan: async (parentId: string) =>
      hidup()
        .filter(([, f]) => f.parent === parentId && f.target)
        .map(([id, f]) => ({ id, name: f.name, targetId: f.target! })),
    buatPintasan: async (i: { folderId: string; name: string; targetId: string }) => {
      const id = `p${++urut}`;
      folder.set(id, { name: i.name, parent: i.folderId, target: i.targetId });
      return id;
    },
    metaFolder: async (id: string) => {
      const f = folder.get(id);
      if (!f || f.trashed || f.target) return null;
      return {
        id,
        createdTime: f.dibuat ?? new Date(),
        terbitanMarlin: false,
        diubahOrangLain: false,
        kosong: !hidup().some(([, x]) => x.parent === id),
      };
    },
    buangKeSampah: async (id: string) => {
      folder.get(id)!.trashed = true;
    },
  };
});

const { db } = await import("@/lib/db");
const { siapkanFolderDriveAction } = await import("@/lib/gdrive/actions");

const suffix = `gs${Date.now().toString(36)}`;
const AKAR = `akar-${suffix}`;
let orgId = "";
let packageId = "";

const anak = (parent: string) => hidup().filter(([, f]) => f.parent === parent);
const idDari = (parent: string, name: string) => anak(parent).find(([, f]) => f.name === name)?.[0] ?? null;

function siapkan(id = packageId) {
  const fd = new FormData();
  fd.set("packageId", id);
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
    expect(r?.success).toMatch(/folder baru dan 36 pintasan dibuat/);

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

/*
 * FOLDER GANDA BERKAS DOKUMEN TEKNIS → PINTASAN (DECISIONS 776). Keluhan user
 * 2026-11-25: *"kenapa itu redudansi dengan folder termin langsung itu sendiri
 * … kenapa konten yang sama tidak kamu link kan saja"*.
 */
describe("folder ganda BERKAS DOKUMEN TEKNIS", () => {
  const AKAR2 = `akar2-${suffix}`;
  let paket2 = "";
  const TEKNIS = "BERKAS DOKUMEN TEKNIS";
  const tambah = (parent: string, name: string, dibuat?: Date) => {
    const id = `ada${++urut}`;
    folder.set(id, { name, parent, dibuat });
    return id;
  };

  beforeAll(async () => {
    const pkg = await db.package.create({
      data: { orgId, name: `Paket GS2 ${suffix}`, stage: "pelaksanaan", driveFolderId: AKAR2 },
    });
    paket2 = pkg.id;
  });

  it("Drive kosong → BERKAS DOKUMEN TEKNIS berisi 9 pintasan ke folder utama termin, bukan folder kosong", async () => {
    const AKAR3 = `akar3-${suffix}`;
    const pkg = await db.package.create({ data: { orgId, name: `Paket GS3 ${suffix}`, stage: "pelaksanaan", driveFolderId: AKAR3 } });
    const r = await siapkan(pkg.id);
    expect(r?.success).toMatch(/36 pintasan dibuat/);
    const t1 = idDari(idDari(AKAR3, "7. BERKAS TERMIN")!, "TERMIN 1 (25%)")!;
    const teknis = idDari(t1, TEKNIS)!;
    const kurva = anak(teknis).find(([, f]) => f.name === "9. Kurva S")![1];
    expect(kurva.target).toBe(idDari(t1, "5. Kurva S"));
    expect(anak(teknis).filter(([, f]) => f.target)).toHaveLength(9);
    expect(anak(teknis).filter(([, f]) => !f.target)).toHaveLength(10);
  });

  it("folder ganda lama: yang kosong dan dibuat saat MARLIN menulis diganti; buatan orang dan yang berisi dibiarkan", async () => {
    // Drive dengan kerangka LAMA (sebelum 776): tombol Siapkan pernah ditekan,
    // dan satu unggahan berkas termin pernah naik.
    await db.auditLog.create({
      data: { userId: pengguna!.id, action: "gdrive.siapkan_folder", resourceType: "package", resourceId: paket2, payload: {} },
    });
    const jejak = (await db.auditLog.findFirst({
      where: { action: "gdrive.siapkan_folder", resourceId: paket2 },
      select: { createdAt: true },
    }))!.createdAt;
    const unggah = await db.gDriveUpload.create({
      data: { packageId: paket2, kind: "berkas_termin", refKey: `${paket2}:t1:dokumentasi::-`, fileName: "x.pdf", status: "sukses" },
      select: { createdAt: true },
    });
    const sebelum = (t: Date, detik: number) => new Date(t.getTime() - detik * 1000);

    const f7 = tambah(AKAR2, "7. BERKAS TERMIN", sebelum(jejak, 40));
    const t1 = tambah(f7, "TERMIN 1 (25%)", sebelum(jejak, 40));
    const teknis = tambah(t1, TEKNIS, sebelum(jejak, 30));
    const kurvaLama = tambah(teknis, "9. Kurva S", sebelum(jejak, 20)); // MARLIN, kosong
    const dokLama = tambah(teknis, "8. Dokumentasi Pekerjaan", sebelum(unggah.createdAt, 5)); // dibuat saat unggah
    const mingguanOrang = tambah(teknis, "6. Laporan Mingguan", sebelum(jejak, 3 * 86_400)); // orang, 3 hari sebelumnya
    const backupBerisi = tambah(teknis, "4. Backup Volume", sebelum(jejak, 20));
    tambah(backupBerisi, "backup desa.xlsx"); // berisi → tidak boleh dibuang

    const r = await siapkan(paket2);
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/2 folder ganda di BERKAS DOKUMEN TEKNIS diganti pintasan/);
    expect(r?.success).toMatch(/2 folder ganda di BERKAS DOKUMEN TEKNIS dibiarkan/);

    expect(folder.get(kurvaLama)!.trashed).toBe(true);
    expect(folder.get(dokLama)!.trashed).toBe(true);
    expect(folder.get(mingguanOrang)!.trashed).toBeUndefined();
    expect(folder.get(backupBerisi)!.trashed).toBeUndefined();

    const kurvaBaru = anak(teknis).filter(([, f]) => f.name === "9. Kurva S");
    expect(kurvaBaru).toHaveLength(1);
    expect(kurvaBaru[0][1].target).toBe(idDari(t1, "5. Kurva S"));
    // Yang dibiarkan tidak diberi pintasan kembar di sebelahnya.
    expect(anak(teknis).filter(([, f]) => f.name === "6. Laporan Mingguan")).toHaveLength(1);
    expect(anak(teknis).filter(([, f]) => f.name === "4. Backup Volume")).toHaveLength(1);

    const audit = await db.auditLog.findFirst({
      where: { action: "gdrive.siapkan_folder", resourceId: paket2, userId: pengguna!.id, NOT: { payload: { equals: {} } } },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const p = audit!.payload as { diganti: string[]; dibiarkan: string[] };
    expect(p.diganti.sort()).toEqual([
      `7. BERKAS TERMIN/TERMIN 1 (25%)/${TEKNIS}/8. Dokumentasi Pekerjaan`,
      `7. BERKAS TERMIN/TERMIN 1 (25%)/${TEKNIS}/9. Kurva S`,
    ]);
    expect(p.dibiarkan).toHaveLength(2);

    // Ditekan lagi: yang dibiarkan tetap dibiarkan, tidak ada yang dibuang lagi.
    const lagi = await siapkan(paket2);
    expect(lagi?.success).not.toMatch(/diganti/);
    expect(folder.get(mingguanOrang)!.trashed).toBeUndefined();
  });
});
