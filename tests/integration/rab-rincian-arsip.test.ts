// MELENGKAPI BACKUP VOLUME & ANALISA REVISI LAMA DARI BERKAS ARSIP
// (DECISIONS baru 2026-10-06).
//
// Revisi di produksi dibuat sebelum rincian ada. Berkas aslinya diarsipkan
// utuh, jadi rinciannya bisa dilengkapi tanpa unggah ulang. Permintaan user:
// LIHAT dulu laporannya, baru simpan. Yang dijaga:
//   1. Periksa tidak menyimpan satu pun rincian – hanya laporan;
//   2. Simpan ditolak sebelum diperiksa;
//   3. item berpasangan walau lineage revisinya sudah berbeda dari bacaan ulang
//      berkas (adendum dicocokkan ke lineage kontrak saat impor);
//   4. angka revisi (volume, harga, nilai) tidak berubah sedikit pun;
//   5. revisi tanpa berkas dilaporkan, bukan ditebak;
//   6. hanya pemegang system.manage yang boleh.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const NAMA = "mc0-karangmangu-blok-cco01-tkdn.xlsx";
const isi = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);
const suffix = `ra${Date.now().toString(36)}`;
const KUNCI = `rab-import/${suffix}/karangmangu.xlsx`;
vi.mock("@/lib/penyimpanan/berkas", async (asli) => ({
  ...(await asli<typeof import("@/lib/penyimpanan/berkas")>()),
  ambilBerkas: async (kunci: string) => {
    if (kunci === KUNCI) return isi;
    throw new Error(`objek tidak ada: ${kunci}`);
  },
}));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async (cap: string) => {
      if (!can(sesi.role as never, cap as never)) throw new asli.ForbiddenError(`Tanpa izin: ${cap}`);
      return sesi;
    },
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { periksaRevisiAction, lengkapiRevisiAction } = await import("@/lib/rab/rincian/actions");
const { cocokkanItem } = await import("@/lib/rab/rincian/cocok");

let orgId = "";
let adminId = "";
let revisiId = "";
let revisiTanpaBerkas = "";

const fd = (revisionId: string) => {
  const f = new FormData();
  f.set("revisionId", revisionId);
  return f;
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org RA ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const user = await db.user.create({
    data: { orgId, username: `ra-${suffix}`, fullName: "Admin", passwordHash: "x", role: "super_admin" },
  });
  adminId = user.id;
  sesi = { id: user.id, orgId, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId, name: `Paket RA ${suffix}`, stage: "pelaksanaan" } });
  const lok = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Karangmangu",
      slug: `karangmangu-${suffix}`,
      village: "Karangmangu",
      regency: "Rembang",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });

  // Revisi "lama": dibuat seperti impor sebelum rincian ada. Lineage-nya
  // SENGAJA digeser – seperti adendum yang dicocokkan ke lineage kontrak.
  const { parsed } = await parseHpsBuffer(isi);
  const nodes = flattenParsedRab(parsed).map((n) => ({
    ...n,
    lineageKey: `X#${n.lineageKey}`,
    parentLineageKey: n.parentLineageKey ? `X#${n.parentLineageKey}` : null,
  }));
  const res = await createRevisionFromNodes(lok.id, nodes, { source: "hps_awal", userId: adminId, note: "lama" });
  await activateRevision(res.revisionId, adminId);
  revisiId = res.revisionId;
  const doc = await db.document.create({
    data: {
      orgId,
      packageId: pkg.id,
      locationId: lok.id,
      phase: "kontrak",
      type: "hps",
      title: "HPS awal",
      r2Key: KUNCI,
      fileName: NAMA,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: isi.length,
      sha256: "x",
      uploadedById: adminId,
    },
  });
  await db.rabRevision.update({ where: { id: revisiId }, data: { sourceDocumentId: doc.id } });

  const lok2 = await db.location.create({
    data: { packageId: pkg.id, name: "Tanpa Berkas", slug: `tanpa-${suffix}`, village: "V", regency: "R", province: "P" },
  });
  revisiTanpaBerkas = (
    await createRevisionFromNodes(lok2.id, flattenParsedRab(parsed).slice(0, 40), {
      source: "hps_awal",
      userId: adminId,
      note: "editor",
    })
  ).revisionId;
}, 300_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("lengkapi rincian dari berkas arsip", () => {
  it("Simpan ditolak sebelum diperiksa", async () => {
    const r = await lengkapiRevisiAction(undefined, fd(revisiId));
    expect(r?.error).toMatch(/Periksa dulu/);
    expect(await db.rabBackupVolume.count({ where: { revisionId: revisiId } })).toBe(0);
  });

  it("Periksa hanya menulis laporan, tidak menyimpan rincian", async () => {
    const r = await periksaRevisiAction(undefined, fd(revisiId));
    expect(r?.error, r?.error).toBeUndefined();
    const p = await db.rabRincianPeriksa.findUniqueOrThrow({ where: { revisionId: revisiId } });
    expect(p.status).toBe("siap");
    expect(p.itemCocok).toBe(p.itemRevisi);
    expect(p.itemRevisi).toBe(583);
    expect(p.tersembunyiDibaca).toEqual(["14. Vol Genset"]);
    expect(await db.rabRincianRevisi.count({ where: { revisionId: revisiId } })).toBe(0);
    expect(await db.rabBackupVolume.count({ where: { revisionId: revisiId } })).toBe(0);
  }, 120_000);

  it("Simpan menulis rincian; angka revisi tidak berubah sedikit pun", async () => {
    const sebelum = await db.rabNode.findMany({
      where: { revisionId: revisiId },
      select: { id: true, volume: true, unitPrice: true, amount: true, lineageKey: true },
      orderBy: { id: "asc" },
    });
    const totalSebelum = (await db.rabRevision.findUniqueOrThrow({ where: { id: revisiId } })).totalValue;

    const r = await lengkapiRevisiAction(undefined, fd(revisiId));
    expect(r?.error, r?.error).toBeUndefined();
    expect(r?.success).toMatch(/Angka RAB tidak berubah/);

    const ringkas = await db.rabRincianRevisi.findUniqueOrThrow({ where: { revisionId: revisiId } });
    expect(ringkas.asal).toBe("arsip");
    expect(await db.rabBackupVolume.count({ where: { revisionId: revisiId } })).toBe(583);
    expect(await db.rabItemAnalisa.count({ where: { revisionId: revisiId } })).toBeGreaterThan(500);

    const sesudah = await db.rabNode.findMany({
      where: { revisionId: revisiId },
      select: { id: true, volume: true, unitPrice: true, amount: true, lineageKey: true },
      orderBy: { id: "asc" },
    });
    expect(sesudah).toEqual(sebelum);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: revisiId } })).totalValue).toBe(totalSebelum);

    // Simpan ulang = ditulis ulang utuh, bukan berlipat.
    await lengkapiRevisiAction(undefined, fd(revisiId));
    expect(await db.rabBackupVolume.count({ where: { revisionId: revisiId } })).toBe(583);
  }, 180_000);

  it("revisi tanpa berkas dilaporkan, tidak ditebak", async () => {
    await periksaRevisiAction(undefined, fd(revisiTanpaBerkas));
    const p = await db.rabRincianPeriksa.findUniqueOrThrow({ where: { revisionId: revisiTanpaBerkas } });
    expect(p.status).toBe("tanpa_berkas");
    const r = await lengkapiRevisiAction(undefined, fd(revisiTanpaBerkas));
    expect(r?.error).toBeTruthy();
  });

  it("peran tanpa system.manage ditolak", async () => {
    const sm = await db.user.create({
      data: { orgId, username: `sm-${suffix}`, fullName: "SM", passwordHash: "x", role: "site_manager" },
    });
    sesi = { id: sm.id, orgId, role: "site_manager" };
    try {
      expect((await periksaRevisiAction(undefined, fd(revisiId)))?.error).toMatch(/izin|akses/i);
      expect((await lengkapiRevisiAction(undefined, fd(revisiId)))?.error).toMatch(/izin|akses/i);
    } finally {
      sesi = { id: adminId, orgId, role: "super_admin" };
    }
  });
});

describe("cocokkanItem", () => {
  it("lineage dulu; sisanya hanya bila pasangan (kode, nama, volume, harga) tunggal", () => {
    const berkas = [
      { kind: "item", code: "1", name: "Galian", volume: 10, unitPrice: 5, lineageKey: "I#1", excelRow: 10 },
      { kind: "item", code: "2", name: "Urugan", volume: 4, unitPrice: 7, lineageKey: "I#2", excelRow: 11 },
      { kind: "item", code: "a", name: "Beton", volume: 1, unitPrice: 9, lineageKey: "II#1#a", excelRow: 20 },
      { kind: "item", code: "a", name: "Beton", volume: 1, unitPrice: 9, lineageKey: "III#1#a", excelRow: 30 },
    ] as Parameters<typeof cocokkanItem>[0];
    const revisi = [
      { lineageKey: "I#1", code: "1", name: "Galian", volume: 10, unitPrice: 5 },
      { lineageKey: "K#2", code: "2", name: "Urugan", volume: 4, unitPrice: 7 },
      { lineageKey: "K#a1", code: "a", name: "Beton", volume: 1, unitPrice: 9 },
      { lineageKey: "K#a2", code: "a", name: "Beton", volume: 1, unitPrice: 9 },
    ];
    const peta = cocokkanItem(berkas, revisi);
    expect(peta.get("10")).toBe("I#1");
    expect(peta.get("11")).toBe("K#2");
    // Dua "Beton" kembar tidak bisa dibedakan → tidak dipasangkan, tidak ditebak.
    expect(peta.has("20")).toBe(false);
    expect(peta.has("30")).toBe(false);
  });
});
