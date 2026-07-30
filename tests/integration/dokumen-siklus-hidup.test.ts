// Siklus hidup dokumen (DECISIONS 183): koreksi metadata, BATALKAN, PULIHKAN,
// HAPUS PERMANEN — beserta efeknya ke kepatuhan milestone administrasi.
//
// Yang dijaga di sini adalah janji-janji yang tidak boleh dilanggar:
// - dokumen dibatalkan hilang dari daftar & tidak lagi dihitung sebagai bukti;
// - milestone yang selesai KARENA dokumen itu ikut turun, KECUALI sudah
//   diverifikasi manusia (keputusan orang tidak dibatalkan efek samping);
// - dokumen yang jadi sumber RAB / bukti pengeluaran tidak bisa dibuang;
// - hapus permanen hanya setelah dibatalkan, dan file R2-nya ikut dihapus;
// - setiap mutasi meninggalkan jejak audit.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const deletedKeys: string[] = [];
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async () => {},
  r2Delete: async (key: string) => {
    deletedKeys.push(key);
  },
  classifyR2Error: (e: unknown) => String(e),
}));

/** Sesi palsu: role diganti per kasus untuk menguji gerbang capability. */
let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  return {
    requestIp: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new Error(`Tidak punya izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
    hasLocationAccess: async () => true,
    getCurrentUser: async () => user(),
    requireUser: async () => user(),
  };
});

const { db } = await import("@/lib/db");
const { listDocuments } = await import("@/lib/documents");
const { updateDocumentMeta, voidDocument, restoreDocument, deleteDocumentPermanently } = await import(
  "@/lib/documents-manage"
);

const suffix = `dl${Date.now().toString(36)}`;
let orgId = "";
let packageId = "";
let locationId = "";

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org DL ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const user = await db.user.create({
    data: { orgId, username: `dl-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sessionUserId = user.id;
  sessionOrgId = orgId;
  const pkg = await db.package.create({ data: { orgId, name: `Paket DL ${suffix}` } });
  packageId = pkg.id;
  const loc = await db.location.create({
    data: {
      packageId,
      name: "Kedungrejo",
      slug: `kedungrejo-${suffix}`,
      village: "Kedungrejo",
      regency: "Banyuwangi",
      province: "Jawa Timur",
    },
  });
  locationId = loc.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(() => {
  role = "super_admin";
  deletedKeys.length = 0;
});

let seq = 0;
async function buatDokumen(
  over: Partial<{ milestoneId: string; type: string; title: string; locationId: string | null }> = {},
) {
  seq += 1;
  return db.document.create({
    data: {
      orgId,
      packageId,
      locationId: over.locationId === undefined ? locationId : over.locationId,
      milestoneId: over.milestoneId ?? null,
      phase: "mulai_kerja",
      type: (over.type as never) ?? "spmk",
      title: over.title ?? `Dokumen uji ${seq}`,
      r2Key: `documents/2026/${suffix}-${seq}.pdf`,
      fileName: `berkas-${seq}.pdf`,
      mimeType: "application/pdf",
      bytes: 1024,
      sha256: `${suffix}${seq}`.padEnd(64, "0"),
      uploadedById: sessionUserId,
    },
  });
}

async function buatMilestone(over: Partial<{ status: string; verifiedById: string | null }> = {}) {
  return db.adminMilestone.create({
    data: {
      packageId,
      locationId,
      templateKey: `spmk-${(seq += 1)}`,
      name: "SPMK",
      phase: "mulai_kerja",
      status: (over.status as never) ?? "selesai",
      completedAt: new Date(),
      verifiedById: over.verifiedById ?? null,
    },
  });
}

async function auditActions(documentId: string): Promise<string[]> {
  const rows = await db.auditLog.findMany({
    where: { resourceType: "document", resourceId: documentId },
    orderBy: { createdAt: "asc" },
    select: { action: true },
  });
  return rows.map((r) => r.action);
}

describe("koreksi metadata", () => {
  it("menyimpan hanya kolom yang berubah + jejak sebelum/sesudah", async () => {
    const doc = await buatDokumen({ type: "spmk", title: "scan" });
    const res = await updateDocumentMeta(doc.id, {
      title: "SPMK Kedungrejo lembar 1",
      type: "spmk",
      docNumber: "027/PPK/V/2026",
    });
    expect(res.changed.sort()).toEqual(["docNumber", "title"]);

    const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.title).toBe("SPMK Kedungrejo lembar 1");
    expect(after.docNumber).toBe("027/PPK/V/2026");

    const log = await db.auditLog.findFirst({
      where: { resourceType: "document", resourceId: doc.id, action: "document.edit" },
      select: { payload: true },
    });
    const payload = log?.payload as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(payload.before.title).toBe("scan");
    expect(payload.after.docNumber).toBe("027/PPK/V/2026");
    // Kolom yang tidak berubah tidak dicatat sebagai perubahan.
    expect(Object.keys(payload.after)).not.toContain("type");
  });

  it("tanpa perubahan nyata tidak menulis audit", async () => {
    const doc = await buatDokumen({ title: "Judul tetap" });
    const res = await updateDocumentMeta(doc.id, { title: "Judul tetap" });
    expect(res.changed).toEqual([]);
    expect(await auditActions(doc.id)).toEqual([]);
  });

  it("ditolak untuk role tanpa capability document.edit", async () => {
    const doc = await buatDokumen();
    role = "field_supervisor";
    await expect(updateDocumentMeta(doc.id, { title: "Coba ubah" })).rejects.toThrow(/izin/i);
  });

  it("ditolak bila dokumen sudah dibatalkan", async () => {
    const doc = await buatDokumen();
    await voidDocument(doc.id, "salah unggah, berkas milik desa lain");
    await expect(updateDocumentMeta(doc.id, { title: "Koreksi" })).rejects.toThrow(/pulihkan dulu/i);
  });
});

describe("batalkan", () => {
  it("menuntut alasan yang bermakna", async () => {
    const doc = await buatDokumen();
    await expect(voidDocument(doc.id, "  x ")).rejects.toThrow(/[Aa]lasan/);
  });

  it("hilang dari daftar dokumen, tampil hanya bila diminta", async () => {
    const doc = await buatDokumen();
    await voidDocument(doc.id, "berkas keliru, versi draft bukan tandatangan");

    const aktif = await listDocuments({ orgId, scopedLocationIds: null });
    expect(aktif.map((d) => d.id)).not.toContain(doc.id);

    const dibatalkan = await listDocuments({ orgId, scopedLocationIds: null, status: "dibatalkan" });
    expect(dibatalkan.map((d) => d.id)).toContain(doc.id);
    expect(dibatalkan.find((d) => d.id === doc.id)?.voidReason).toMatch(/versi draft/);

    const semua = await listDocuments({ orgId, scopedLocationIds: null, status: "semua" });
    expect(semua.map((d) => d.id)).toContain(doc.id);
  });

  it("mengembalikan milestone yang selesai karena dokumen ini", async () => {
    const ms = await buatMilestone({ status: "selesai" });
    const doc = await buatDokumen({ milestoneId: ms.id });
    await voidDocument(doc.id, "salah jenis dokumen");

    const after = await db.adminMilestone.findUniqueOrThrow({ where: { id: ms.id } });
    expect(after.status).toBe("belum_dimulai");
    expect(after.completedAt).toBeNull();
    expect(after.note).toMatch(/dibatalkan/i);
    const jejak = await db.auditLog.count({
      where: { resourceType: "admin_milestone", resourceId: ms.id, action: "milestone.dikembalikan" },
    });
    expect(jejak).toBe(1);
  });

  it("TIDAK menurunkan milestone yang sudah diverifikasi manusia — hanya menandai perlu ditinjau", async () => {
    const ms = await buatMilestone({ status: "selesai", verifiedById: sessionUserId });
    const doc = await buatDokumen({ milestoneId: ms.id });
    await voidDocument(doc.id, "berkas rusak, tidak terbaca");

    const after = await db.adminMilestone.findUniqueOrThrow({ where: { id: ms.id } });
    expect(after.status).toBe("selesai");
    expect(after.note).toMatch(/[Pp]erlu ditinjau/);
    const jejak = await db.auditLog.count({
      where: { resourceType: "admin_milestone", resourceId: ms.id, action: "milestone.bukti_dibatalkan" },
    });
    expect(jejak).toBe(1);
  });

  it("milestone tetap selesai bila masih ada bukti aktif lain", async () => {
    const ms = await buatMilestone({ status: "selesai" });
    const doc1 = await buatDokumen({ milestoneId: ms.id });
    await buatDokumen({ milestoneId: ms.id });
    await voidDocument(doc1.id, "duplikat hasil scan ganda");

    const after = await db.adminMilestone.findUniqueOrThrow({ where: { id: ms.id } });
    expect(after.status).toBe("selesai");
  });

  it("ditolak bila dokumen dipakai sebagai bukti pengeluaran", async () => {
    const doc = await buatDokumen({ type: "invoice" });
    const expense = await db.expense.create({
      data: {
        locationId,
        category: "material",
        amount: 1_000_000n,
        txDate: new Date("2026-05-01T00:00:00Z"),
        description: "Uji bukti",
        createdById: sessionUserId,
        evidenceDocumentId: doc.id,
      },
    });
    await expect(voidDocument(doc.id, "mau dibuang padahal jadi bukti")).rejects.toThrow(
      /bukti .* pengeluaran/i,
    );
    await db.expense.delete({ where: { id: expense.id } });
  });

  it("ditolak dua kali batal", async () => {
    const doc = await buatDokumen();
    await voidDocument(doc.id, "salah lokasi unggah");
    await expect(voidDocument(doc.id, "sekali lagi")).rejects.toThrow(/sudah dibatalkan/i);
  });

  it("ditolak untuk role tanpa capability document.void", async () => {
    const doc = await buatDokumen();
    role = "site_manager";
    await expect(voidDocument(doc.id, "coba batalkan tanpa izin")).rejects.toThrow(/izin/i);
  });
});

describe("pulihkan", () => {
  it("mengembalikan dokumen ke daftar tanpa menghidupkan milestone otomatis", async () => {
    const ms = await buatMilestone({ status: "selesai" });
    const doc = await buatDokumen({ milestoneId: ms.id });
    await voidDocument(doc.id, "kesalahan operator, sebenarnya benar");
    await restoreDocument(doc.id);

    const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.status).toBe("aktif");
    expect(after.voidedAt).toBeNull();
    expect(after.voidReason).toBeNull();
    // Kepatuhan tidak dinaikkan diam-diam — tetap di posisi hasil pembatalan.
    const msAfter = await db.adminMilestone.findUniqueOrThrow({ where: { id: ms.id } });
    expect(msAfter.status).toBe("belum_dimulai");
    expect(await auditActions(doc.id)).toEqual(["document.void", "document.restore"]);
  });

  it("ditolak bila dokumen tidak dalam status dibatalkan", async () => {
    const doc = await buatDokumen();
    await expect(restoreDocument(doc.id)).rejects.toThrow(/tidak dalam status dibatalkan/i);
  });
});

describe("hapus permanen", () => {
  it("hanya setelah dibatalkan", async () => {
    const doc = await buatDokumen();
    await expect(deleteDocumentPermanently(doc.id)).rejects.toThrow(/[Bb]atalkan dokumen dulu/);
  });

  it("menghapus baris + file R2 dan menyisakan jejak audit", async () => {
    const doc = await buatDokumen();
    await voidDocument(doc.id, "berkas salah, tidak dipakai");
    const res = await deleteDocumentPermanently(doc.id);

    expect(res.storageWarning).toBeNull();
    expect(deletedKeys).toEqual([doc.r2Key]);
    expect(await db.document.findUnique({ where: { id: doc.id } })).toBeNull();
    // Baris dokumen hilang, jejaknya TIDAK.
    expect(await auditActions(doc.id)).toEqual(["document.void", "document.delete"]);
  });

  it("ditolak bila masih diacu revisi RAB", async () => {
    const doc = await buatDokumen({ type: "hps" });
    await voidDocument(doc.id, "coba hapus padahal sumber RAB");
    const rev = await db.rabRevision.create({
      data: {
        locationId,
        revisionNo: 1,
        source: "hps_awal",
        status: "draft",
        totalValue: 0n,
        createdById: sessionUserId,
        sourceDocumentId: doc.id,
      },
    });
    await expect(deleteDocumentPermanently(doc.id)).rejects.toThrow(/revisi RAB/i);
    expect(await db.document.findUnique({ where: { id: doc.id } })).not.toBeNull();
    await db.rabRevision.delete({ where: { id: rev.id } });
  });

  it("ditolak untuk program_director (super_admin saja)", async () => {
    const doc = await buatDokumen();
    await voidDocument(doc.id, "uji gerbang hapus permanen");
    role = "program_director";
    await expect(deleteDocumentPermanently(doc.id)).rejects.toThrow(/izin/i);
  });
});
