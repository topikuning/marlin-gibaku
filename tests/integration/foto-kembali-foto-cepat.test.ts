/*
 * FOTO LAPORAN KEMBALI KE FOTO CEPAT (DECISIONS 791).
 *
 * Pertanyaan user 2026-11-26: *"bagaimana mengembalikan foto yang digunakan
 * pekerjaan diluar rab atau yang volume 0 untuk dikembalikan ke foto cepat?
 * saat ini sepertinya kamu hanya set super admin yang bisa … padahal
 * pekerjaan tidak di rab"*.
 *
 * Dulu hanya foto TANPA pekerjaan di laporan Draft/Perlu Koreksi; laporan
 * terkirim harus dibuka super admin dulu. Yang dibuktikan:
 * - laporan FINAL: Pelaksana pengunggahnya mengembalikan foto baris bervolume
 *   0 – tanpa membuka kunci; potret final ikut berubah;
 * - foto pekerjaan bervolume di laporan terkirim tetap menempel;
 * - catatan luar RAB: foto bisa kembali; foto terakhir membatalkan catatannya;
 *   catatan yang sudah dipadankan tetap;
 * - orang lain: hanya Site Manager / Super Admin.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `fk${Date.now().toString(36)}`;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

type Peran = "field_supervisor" | "site_manager" | "project_manager" | "regional_manager" | "program_director";
type UserUji = { id: string; orgId: string; username: string; role: Peran };
let sebagai: UserUji;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sebagai,
    getCurrentUser: async () => sebagai,
    hasLocationAccess: async () => true,
    requireCapability: async () => sebagai,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { returnPhotoToKantongAction } = await import("@/lib/daily-report/actions");
const { createRevisionFromNodes } = await import("@/lib/rab/import");
const { getOrCreateDraft, buildFinalSnapshot } = await import("@/lib/daily-report/service");
type FlatNode = import("@/lib/rab/flatten").FlatNode;

let orgId: string;
let locationId: string;
let nodeId: string;
let pelaksana: UserUji;
let pelaksanaLain: UserUji;
let sm: UserUji;
let atasan: UserUji[];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org FK ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const buat = async (username: string, role: Peran): Promise<UserUji> => {
    const u = await db.user.create({ data: { orgId, username, fullName: username, passwordHash: "x", role } });
    return { id: u.id, orgId, username, role };
  };
  pelaksana = await buat(`pel-${suffix}`, "field_supervisor");
  pelaksanaLain = await buat(`pel2-${suffix}`, "field_supervisor");
  sm = await buat(`sm-${suffix}`, "site_manager");
  atasan = [
    await buat(`pm-${suffix}`, "project_manager"),
    await buat(`am-${suffix}`, "regional_manager"),
    await buat(`pd-${suffix}`, "program_director"),
  ];
  const pkg = await db.package.create({ data: { orgId, name: `Paket ${suffix}` } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: `Lokasi ${suffix}`, slug: `lok-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
  const node = (k: string, p: string | null, kind: FlatNode["kind"], vol: number | null, i: number): FlatNode => ({
    kind,
    code: k.split("#").at(-1)!,
    name: kind === "kategori" ? "PEKERJAAN PERSIAPAN" : "Pekerjaan Galian Tanah",
    volume: vol,
    unit: vol == null ? null : "m3",
    unitPrice: vol == null ? null : 100_000,
    amount: vol == null ? 0n : BigInt(vol * 100_000),
    lineageKey: k,
    parentLineageKey: p,
    sortOrder: i,
    excelRow: null,
  });
  const rev = await createRevisionFromNodes(locationId, [node("I", null, "kategori", null, 0), node("I#1", "I", "item", 50, 1)], {
    source: "hps_awal",
    userId: sm.id,
  });
  await db.rabRevision.update({ where: { id: rev.revisionId }, data: { status: "aktif" } });
  nodeId = (await db.rabNode.findFirstOrThrow({ where: { revisionId: rev.revisionId, lineageKey: "I#1" } })).id;
});

let hari = 1;
/** Laporan baru berstatus `status`, satu baris pekerjaan bervolume `volume`. */
async function laporan(status: "draft" | "dikirim" | "final", volume: number) {
  const tanggal = `2026-10-${String(hari++).padStart(2, "0")}`;
  const r = await getOrCreateDraft(locationId, tanggal, pelaksana.id);
  const item = await db.dailyReportItem.create({
    data: { reportId: r.id, rabNodeId: nodeId, lineageKey: "I#1", volumeDone: volume, valueDone: BigInt(volume * 100_000) },
  });
  await db.dailyReport.update({ where: { id: r.id }, data: { status } });
  return { reportId: r.id, itemId: item.id };
}

async function foto(o: { reportId: string; reportItemId?: string; luarRabId?: string; oleh?: string }) {
  const sha = randomUUID().replace(/-/g, "");
  return db.photo.create({
    data: {
      r2Key: `uji/${sha}.jpg`,
      sha256: sha,
      bytes: 1000,
      locationId,
      reportId: o.reportId,
      reportItemId: o.reportItemId ?? null,
      luarRabId: o.luarRabId ?? null,
      uploadedById: o.oleh ?? pelaksana.id,
    },
  });
}

async function kembalikan(photoId: string, oleh: UserUji) {
  sebagai = oleh;
  const fd = new FormData();
  fd.set("photoId", photoId);
  return returnPhotoToKantongAction(undefined, fd);
}

async function catatan(reportId: string) {
  return db.pekerjaanLuarRab.create({
    data: { locationId, reportId, uraian: "Pembuatan saluran sementara", satuan: "m", volume: 12, createdById: pelaksana.id },
  });
}

describe("foto laporan kembali ke Foto Cepat", () => {
  it("laporan FINAL, baris bervolume 0: Pelaksana pengunggahnya mengembalikan foto tanpa membuka kunci", async () => {
    const { reportId, itemId } = await laporan("final", 0);
    const f = await foto({ reportId, reportItemId: itemId });
    // Potret final seperti sesudah finalisasi: memuat foto itu.
    const potret = await buildFinalSnapshot(reportId);
    await db.dailyReport.update({ where: { id: reportId }, data: { finalSnapshot: potret as object } });
    expect(potret.photos.map((p) => p.id)).toContain(f.id);
    const r = await kembalikan(f.id, pelaksana);
    expect(r?.error).toBeUndefined();
    expect(r?.success).toMatch(/Foto kembali ke kantong Foto Cepat/);
    expect(await db.photo.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
      reportId: null,
      reportItemId: null,
      addedAfterSubmitAt: null,
      locationId,
    });
    // Laporan tetap final; potretnya dibangun ulang tanpa foto itu.
    const rep = await db.dailyReport.findUniqueOrThrow({ where: { id: reportId }, select: { status: true, finalSnapshot: true } });
    expect(rep.status).toBe("final");
    const snap = rep.finalSnapshot as { photos: { id: string }[] };
    expect(snap.photos.map((p) => p.id)).not.toContain(f.id);
    const jejak = await db.auditLog.findFirstOrThrow({ where: { action: "daily_report.photo_to_kantong", resourceId: f.id } });
    expect(jejak.payload).toMatchObject({ asal: "item", status: "final", volume: 0 });
  });

  it("laporan terkirim, baris bervolume: foto bukti tetap menempel", async () => {
    const { reportId, itemId } = await laporan("dikirim", 3);
    const f = await foto({ reportId, reportItemId: itemId });
    const r = await kembalikan(f.id, pelaksana);
    expect(r?.error).toMatch(/masih menempel pada pekerjaan yang bervolume di laporan yang sudah dikirim/);
    expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).reportItemId).toBe(itemId);
  });

  it("laporan Draft, baris bervolume 0: foto kembali", async () => {
    const { reportId, itemId } = await laporan("draft", 0);
    const f = await foto({ reportId, reportItemId: itemId });
    expect((await kembalikan(f.id, pelaksana))?.error).toBeUndefined();
    expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).reportId).toBeNull();
  });

  it("catatan luar RAB di laporan terkirim: foto kembali; foto TERAKHIR membatalkan catatannya", async () => {
    const { reportId } = await laporan("dikirim", 0);
    const c = await catatan(reportId);
    const f1 = await foto({ reportId, luarRabId: c.id });
    const f2 = await foto({ reportId, luarRabId: c.id });
    const r1 = await kembalikan(f1.id, pelaksana);
    expect(r1?.error).toBeUndefined();
    expect((await db.photo.findUniqueOrThrow({ where: { id: f1.id } })).luarRabId).toBeNull();
    expect((await db.pekerjaanLuarRab.findUniqueOrThrow({ where: { id: c.id } })).dibatalkanAt).toBeNull();

    const r2 = await kembalikan(f2.id, pelaksana);
    expect(r2?.success).toMatch(/Catatan di luar RAB-nya tidak punya foto lagi, jadi dibatalkan/);
    const batal = await db.pekerjaanLuarRab.findUniqueOrThrow({ where: { id: c.id } });
    expect(batal.dibatalkanAt).not.toBeNull();
    expect(batal.alasanBatal).toBe("Semua fotonya dikembalikan ke Foto Cepat.");
    expect(batal.uraian).toBe("Pembuatan saluran sementara");
  });

  it("catatan luar RAB yang sudah dipadankan ke baris RAB: fotonya tetap", async () => {
    const { reportId, itemId } = await laporan("dikirim", 0);
    const c = await catatan(reportId);
    await db.pekerjaanLuarRab.update({ where: { id: c.id }, data: { reportItemId: itemId, dipadankanAt: new Date() } });
    const f = await foto({ reportId, luarRabId: c.id, reportItemId: itemId });
    expect((await kembalikan(f.id, pelaksana))?.error).toMatch(/sudah dipadankan/);
    expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).luarRabId).toBe(c.id);
  });

  it("foto unggahan orang lain: Pelaksana lain ditolak, Site Manager boleh", async () => {
    const { reportId, itemId } = await laporan("final", 0);
    const f = await foto({ reportId, reportItemId: itemId });
    expect((await kembalikan(f.id, pelaksanaLain))?.error).toMatch(/Hanya pengunggah foto, Site Manager, atau atasannya/);
    expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).reportId).toBe(reportId);
    expect((await kembalikan(f.id, sm))?.error).toBeUndefined();
  });

  it("atasan Site Manager (PM, Area Manager, Program Director) juga boleh – layar user, DECISIONS 792", async () => {
    for (const orang of atasan) {
      const { reportId } = await laporan("draft", 0);
      const f = await foto({ reportId });
      const r = await kembalikan(f.id, orang);
      expect([orang.role, r?.error]).toEqual([orang.role, undefined]);
      expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).reportId).toBeNull();
    }
  });

  it("foto tanpa pekerjaan di laporan final: boleh kembali", async () => {
    const { reportId } = await laporan("final", 0);
    const f = await foto({ reportId });
    expect((await kembalikan(f.id, pelaksana))?.error).toBeUndefined();
  });
});
