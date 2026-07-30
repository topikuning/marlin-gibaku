// Impor dokumen dari folder Google Drive KKP (DECISIONS 184).
//
// Panggilan NYATA ke googleapis.com tidak bisa dijalankan dari kontainer kerja
// (proxy memblokir host luar), jadi klien Drive di-mock: yang diuji di sini
// adalah ATURAN impornya di atas database sungguhan — pratinjau menandai apa
// yang sudah pernah diimpor & apa yang dilewati, commit tidak memercayai data
// dari browser, berkas tersalin ke R2, dedup jalan, dan satu berkas gagal tidak
// menjatuhkan yang lain.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const putKeys: string[] = [];
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (key: string) => {
    putKeys.push(key);
  },
  r2Delete: async () => {},
  classifyR2Error: (e: unknown) => String(e),
}));

/** Isi folder Drive palsu — diubah per kasus uji. */
type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  path: string[];
  /** Isi berkas; berkas berbeda harus beda isi supaya dedup sha256 tidak ikut campur. */
  body: string;
  /** Simulasi file hilang/dipindah setelah pratinjau dibuat. */
  hilang?: boolean;
};
let driveFiles: FakeFile[] = [];
let truncated = false;

vi.mock("@/lib/gdrive/client", () => {
  class GDriveError extends Error {}
  const find = (id: string) => driveFiles.find((f) => f.id === id);
  return {
    GDriveError,
    GOOGLE_NATIVE_EXPORT: {
      "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
      "application/vnd.google-apps.spreadsheet": {
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ext: "xlsx",
      },
    },
    walkDriveFolder: async () => ({
      files: driveFiles.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: new Date("2026-05-12T03:00:00Z"),
        webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
        path: f.path,
      })),
      truncated,
    }),
    driveFileMeta: async (id: string) => {
      const f = find(id);
      if (!f || f.hilang) throw new GDriveError("File tidak ditemukan di Drive");
      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: new Date("2026-05-12T03:00:00Z"),
        webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
        path: [],
      };
    },
    downloadDriveFile: async (id: string, mime: string) => {
      const f = find(id);
      if (!f || f.hilang) throw new GDriveError("File tidak ditemukan di Drive");
      const native =
        mime === "application/vnd.google-apps.document"
          ? { mime: "application/pdf", ext: "pdf" }
          : mime === "application/vnd.google-apps.spreadsheet"
            ? {
                mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ext: "xlsx",
              }
            : null;
      return {
        data: Buffer.from(f.body),
        mime: native?.mime ?? f.mimeType,
        extension: native?.ext ?? null,
      };
    },
  };
});

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";
/** null = lintas lokasi; array = role ter-scope. */
let scopedLocations: string[] | null = null;

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  return {
    requestIp: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new Error(`Tidak punya izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async (_u: unknown, locationId: string) => {
      if (scopedLocations !== null && !scopedLocations.includes(locationId)) {
        throw new Error("Tidak punya akses ke lokasi ini");
      }
    },
    hasLocationAccess: async () => true,
    accessibleLocationIds: async () => scopedLocations,
    getCurrentUser: async () => user(),
    requireUser: async () => user(),
  };
});

const { db } = await import("@/lib/db");
const { previewDriveImport, commitDriveImport } = await import("@/lib/gdrive/import");

const suffix = `di${Date.now().toString(36)}`;
let orgId = "";
let packageId = "";
let paketTanpaDrive = "";
let kedungrejoId = "";
let pesisirId = "";

const FOLDER_1 = ["1. SPPBJ, SPK, SPMK, RAB, DED"];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org DI ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  const user = await db.user.create({
    data: { orgId, username: `di-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sessionUserId = user.id;
  const pkg = await db.package.create({
    data: { orgId, name: `Paket DI ${suffix}`, driveFolderId: "folder-kkp-1" },
  });
  packageId = pkg.id;
  const tanpa = await db.package.create({ data: { orgId, name: `Paket tanpa Drive ${suffix}` } });
  paketTanpaDrive = tanpa.id;

  const k = await db.location.create({
    data: {
      packageId,
      name: "Kedungrejo",
      slug: `kedungrejo-${suffix}`,
      village: "Kedungrejo",
      regency: "Banyuwangi",
      province: "Jawa Timur",
    },
  });
  kedungrejoId = k.id;
  const p = await db.location.create({
    data: {
      packageId,
      name: "Pesisir",
      slug: `pesisir-${suffix}`,
      village: "Pesisir",
      regency: "Pemalang",
      province: "Jawa Tengah",
    },
  });
  pesisirId = p.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  role = "super_admin";
  scopedLocations = null;
  truncated = false;
  putKeys.length = 0;
  driveFiles = [];
  await db.document.deleteMany({ where: { orgId } });
});

function pdf(over: Partial<FakeFile> & { id: string; name: string }): FakeFile {
  return {
    mimeType: "application/pdf",
    size: 2048,
    path: FOLDER_1,
    body: `isi-${over.id}`,
    ...over,
  };
}

describe("pratinjau", () => {
  it("menebak jenis, desa, dan tanggal dari nama berkas & folder", async () => {
    driveFiles = [
      pdf({ id: "f1", name: "SPMK Kedungrejo 12-05-2026.pdf" }),
      pdf({ id: "f2", name: "BA PCM Pesisir.pdf", path: ["2. PCM"] }),
    ];
    const pre = await previewDriveImport(packageId);

    expect(pre.jumlah).toMatchObject({ total: 2, siap: 2, sudahAda: 0, dilewati: 0 });
    const spmk = pre.rows.find((r) => r.driveFileId === "f1")!;
    expect(spmk).toMatchObject({
      type: "spmk",
      phase: "mulai_kerja",
      locationId: kedungrejoId,
      docDate: "2026-05-12",
      dilewati: null,
    });
    const pcm = pre.rows.find((r) => r.driveFileId === "f2")!;
    expect(pcm).toMatchObject({ type: "pcm", locationId: pesisirId });
  });

  it("melewati foto & berkas tak didukung dengan alasan yang bisa dibaca", async () => {
    driveFiles = [
      pdf({ id: "f1", name: "SPMK.pdf" }),
      pdf({ id: "f2", name: "IMG_20260512_101122.jpg", mimeType: "image/jpeg" }),
      pdf({ id: "f3", name: "rekaman.mp4", mimeType: "video/mp4" }),
      pdf({ id: "f4", name: "foto papan nama.jpg", mimeType: "image/jpeg", path: ["6. DOKUMENTASI"] }),
      pdf({ id: "f5", name: "gambar besar.pdf", size: 40 * 1024 * 1024 }),
    ];
    const pre = await previewDriveImport(packageId);

    expect(pre.jumlah.siap).toBe(1);
    expect(pre.rows.find((r) => r.driveFileId === "f2")?.dilewati).toMatch(/foto/i);
    expect(pre.rows.find((r) => r.driveFileId === "f3")?.dilewati).toMatch(/video\/mp4/);
    expect(pre.rows.find((r) => r.driveFileId === "f4")?.dilewati).toMatch(/foto/i);
    expect(pre.rows.find((r) => r.driveFileId === "f5")?.dilewati).toMatch(/melebihi batas/);
  });

  it("menandai berkas yang sudah pernah diimpor (tidak menawarkannya lagi)", async () => {
    driveFiles = [pdf({ id: "f1", name: "SPMK Kedungrejo.pdf" })];
    await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: kedungrejoId, path: FOLDER_1.join(" / ") },
    ]);

    const pre = await previewDriveImport(packageId);
    expect(pre.jumlah).toMatchObject({ total: 1, siap: 0, sudahAda: 1 });
    expect(pre.rows[0].dilewati).toMatch(/sudah pernah diimpor/);
  });

  it("meneruskan penanda terpotong supaya jumlah tidak berbohong", async () => {
    driveFiles = [pdf({ id: "f1", name: "SPMK.pdf" })];
    truncated = true;
    expect((await previewDriveImport(packageId)).terpotong).toBe(true);
  });

  it("role ter-scope hanya dicocokkan ke desa yang ia pegang", async () => {
    driveFiles = [
      pdf({ id: "f1", name: "SPMK Kedungrejo.pdf" }),
      pdf({ id: "f2", name: "SPMK Pesisir.pdf" }),
    ];
    role = "site_manager";
    scopedLocations = [kedungrejoId];
    const pre = await previewDriveImport(packageId);
    expect(pre.rows.find((r) => r.driveFileId === "f1")?.locationId).toBe(kedungrejoId);
    // Desa yang bukan wewenangnya tidak diusulkan — bukan diam-diam ditautkan.
    expect(pre.rows.find((r) => r.driveFileId === "f2")?.locationId).toBeNull();
  });

  it("ditolak bila paket belum punya folder Drive", async () => {
    await expect(previewDriveImport(paketTanpaDrive)).rejects.toThrow(/folder Google Drive/i);
  });

  it("ditolak untuk role tanpa capability document.upload", async () => {
    role = "exec_viewer";
    await expect(previewDriveImport(packageId)).rejects.toThrow(/izin/i);
  });
});

describe("commit", () => {
  it("menyalin berkas ke R2 + menyimpan jejak asal Drive", async () => {
    driveFiles = [pdf({ id: "f1", name: "SPMK Kedungrejo 12-05-2026.pdf" })];
    const res = await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: kedungrejoId, path: "1. SPPBJ, SPK, SPMK, RAB, DED" },
    ]);

    expect(res.berhasil).toHaveLength(1);
    expect(res.gagal).toHaveLength(0);
    expect(putKeys).toHaveLength(1);

    const doc = await db.document.findUniqueOrThrow({ where: { id: res.berhasil[0].documentId } });
    expect(doc).toMatchObject({
      source: "drive_kkp",
      driveFileId: "f1",
      drivePath: "1. SPPBJ, SPK, SPMK, RAB, DED",
      type: "spmk",
      phase: "mulai_kerja",
      locationId: kedungrejoId,
      packageId,
      status: "aktif",
    });
    expect(doc.driveWebLink).toContain("f1");
    expect(doc.docDate?.toISOString().slice(0, 10)).toBe("2026-05-12");
    expect(doc.sha256).toHaveLength(64);
  });

  it("dokumen native Google diekspor & ekstensi namanya ikut benar", async () => {
    driveFiles = [
      pdf({
        id: "g1",
        name: "BA PCM Kedungrejo",
        mimeType: "application/vnd.google-apps.document",
        size: null,
      }),
    ];
    const res = await commitDriveImport(packageId, [
      { driveFileId: "g1", type: "pcm", locationId: kedungrejoId, path: "2. PCM" },
    ]);
    const doc = await db.document.findUniqueOrThrow({ where: { id: res.berhasil[0].documentId } });
    expect(doc.fileName).toBe("BA PCM Kedungrejo.pdf");
    expect(doc.mimeType).toBe("application/pdf");
  });

  it("jenis dari browser divalidasi; lokasi wajib milik paket ini", async () => {
    const lain = await db.package.create({ data: { orgId, name: `Paket lain ${suffix}` } });
    const lokasiLain = await db.location.create({
      data: {
        packageId: lain.id,
        name: "Desa Lain",
        slug: `lain-${suffix}`,
        village: "Lain",
        regency: "Kab",
        province: "Prov",
      },
    });
    driveFiles = [pdf({ id: "f1", name: "SPMK.pdf" })];

    const res = await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: lokasiLain.id, path: "" },
    ]);
    expect(res.berhasil).toHaveLength(0);
    expect(res.gagal[0].sebab).toMatch(/bukan lokasi paket ini/i);
    await db.location.delete({ where: { id: lokasiLain.id } });
    await db.package.delete({ where: { id: lain.id } });
  });

  it("role ter-scope tidak bisa mengimpor ke desa orang lain walau menjahili pilihan", async () => {
    driveFiles = [pdf({ id: "f1", name: "SPMK.pdf" })];
    role = "site_manager";
    scopedLocations = [kedungrejoId];
    const res = await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: pesisirId, path: "" },
    ]);
    expect(res.berhasil).toHaveLength(0);
    expect(res.gagal[0].sebab).toMatch(/akses/i);
  });

  it("satu berkas gagal tidak menjatuhkan yang lain", async () => {
    driveFiles = [
      pdf({ id: "f1", name: "SPMK Kedungrejo.pdf" }),
      pdf({ id: "f2", name: "BA PCM Kedungrejo.pdf", hilang: true }),
      pdf({ id: "f3", name: "Invoice termin 1.pdf" }),
    ];
    const res = await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: kedungrejoId, path: "" },
      { driveFileId: "f2", type: "pcm", locationId: kedungrejoId, path: "" },
      { driveFileId: "f3", type: "invoice", locationId: kedungrejoId, path: "" },
    ]);
    expect(res.berhasil.map((b) => b.fileName).sort()).toEqual([
      "Invoice termin 1.pdf",
      "SPMK Kedungrejo.pdf",
    ]);
    expect(res.gagal).toHaveLength(1);
    expect(res.gagal[0].sebab).toMatch(/tidak ditemukan/i);
  });

  it("berkas yang sama tidak terimpor dua kali", async () => {
    driveFiles = [pdf({ id: "f1", name: "SPMK Kedungrejo.pdf" })];
    const sel = [
      { driveFileId: "f1", type: "spmk" as const, locationId: kedungrejoId, path: "" },
    ];
    await commitDriveImport(packageId, sel);
    const ulang = await commitDriveImport(packageId, sel);
    expect(ulang.berhasil).toHaveLength(0);
    expect(ulang.gagal[0].sebab).toMatch(/sudah pernah diimpor/i);
    expect(await db.document.count({ where: { orgId, driveFileId: "f1" } })).toBe(1);
  });

  it("isi identik dengan dokumen yang sudah ada ditolak dedup checksum", async () => {
    driveFiles = [
      pdf({ id: "f1", name: "SPMK Kedungrejo.pdf", body: "isi-sama" }),
      pdf({ id: "f2", name: "SPMK Kedungrejo salinan.pdf", body: "isi-sama" }),
    ];
    const res = await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: kedungrejoId, path: "" },
      { driveFileId: "f2", type: "spmk", locationId: kedungrejoId, path: "" },
    ]);
    expect(res.berhasil).toHaveLength(1);
    expect(res.gagal[0].sebab).toMatch(/identik/i);
  });

  it("menolak pilihan kosong & batch kelewat besar", async () => {
    await expect(commitDriveImport(packageId, [])).rejects.toThrow(/tidak ada berkas/i);
    const banyak = Array.from({ length: 41 }, (_, i) => ({
      driveFileId: `x${i}`,
      type: "spmk" as const,
      locationId: null,
      path: "",
    }));
    await expect(commitDriveImport(packageId, banyak)).rejects.toThrow(/Maksimum 40/);
  });

  it("mencatat ringkasan impor ke audit log", async () => {
    driveFiles = [pdf({ id: "f1", name: "SPMK Kedungrejo.pdf" })];
    await commitDriveImport(packageId, [
      { driveFileId: "f1", type: "spmk", locationId: kedungrejoId, path: "" },
    ]);
    const log = await db.auditLog.findFirst({
      where: { action: "document.drive_import", resourceId: packageId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    expect(log?.payload).toMatchObject({ diminta: 1, berhasil: 1, gagal: 0 });
  });
});
