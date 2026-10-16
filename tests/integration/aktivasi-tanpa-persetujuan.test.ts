/*
 * AKTIVASI RAB TANPA PERSETUJUAN – hanya super admin UTAMA (DECISIONS 682).
 *
 * Laporan user 2026-10-16: *"itu adalah aksi bypass yang sengaja dibuat hanya
 * untuk super admin, kenapa hal itu tidak bekerja sesuai harapan!"* – impor
 * "Jadikan RAB AKTIF sekarang" tertahan dua persetujuan (DECISIONS 234).
 * Pilihan user: jalan pintasnya hanya untuk super admin UTAMA, dengan
 * konfirmasi diketik, tercatat di audit. Peran lain – termasuk super admin
 * biasa – tetap butuh dua persetujuan.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
const suffix = `tp${Date.now().toString(36)}`;
process.env.SUPER_ADMIN_UTAMA = `akar-${suffix}`;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type UserUji = { id: string; orgId: string; username: string; role: "super_admin" };
let sebagai: UserUji;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sebagai,
    requireCapability: async () => sebagai,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { activateDraftAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { parseHpsBuffer } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");

const NAMA = "rab-aktif-situbondo.xlsx";
const ISI = readFileSync(new URL(`../fixtures/${NAMA}`, import.meta.url).pathname);
let orgId: string;
let locationId: string;
let akar: UserUji;
let adminBiasa: UserUji;
let draftId: string;
let draftNo: number;

const berkas = () =>
  new File([new Uint8Array(ISI)], NAMA, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

function aktifkanDraft(isian: Record<string, string>) {
  const fd = new FormData();
  fd.set("revisionId", draftId);
  for (const [k, v] of Object.entries(isian)) fd.set(k, v);
  return activateDraftAction(undefined, fd);
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org TP ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const buat = async (username: string): Promise<UserUji> => {
    const u = await db.user.create({
      data: { orgId: org.id, username, fullName: username, passwordHash: "x", role: "super_admin" },
    });
    return { id: u.id, orgId: org.id, username, role: "super_admin" };
  };
  akar = await buat(`akar-${suffix}`);
  adminBiasa = await buat(`admin-${suffix}`);
  sebagai = akar;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket TP ${suffix}`, stage: "pelaksanaan" } });
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor TP ${suffix}` } });
  await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 5_000_000_000n,
      signedDate: new Date("2026-05-25"),
      durationDays: 150,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-29"),
    },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi TP",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Situbondo",
      province: "Jawa Timur",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
  const nodes = flattenParsedRab((await parseHpsBuffer(ISI)).parsed);
  const awal = await createRevisionFromNodes(loc.id, nodes, { source: "hps_awal", userId: akar.id, note: "kontrak" });
  await activateRevision(awal.revisionId, akar.id);
  const draft = await createRevisionFromNodes(loc.id, nodes, { source: "adendum", userId: akar.id, note: "draft" });
  draftId = draft.revisionId;
  draftNo = draft.revisionNo;
}, 300_000);

afterAll(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "organizations" WHERE id = '${orgId}'`).catch(() => null);
  await db.$disconnect();
});

describe("aktifkan draft tanpa persetujuan", () => {
  it("tanpa permintaan jalan pintas, super admin utama pun tetap tertahan dua persetujuan", async () => {
    sebagai = akar;
    const res = await aktifkanDraft({});
    expect(res?.error).toMatch(/persetujuan|Program Director/i);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("draft");
  });

  it("super admin BIASA tidak bisa memakai jalan pintas", async () => {
    sebagai = adminBiasa;
    try {
      const res = await aktifkanDraft({ tanpaPersetujuan: "1", konfirmasi: `AKTIFKAN #${draftNo}` });
      expect(res?.error).toMatch(/super admin utama/i);
      expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("draft");
    } finally {
      sebagai = akar;
    }
  });

  it("konfirmasi yang tidak persis ditolak", async () => {
    const res = await aktifkanDraft({ tanpaPersetujuan: "1", konfirmasi: "aktifkan" });
    expect(res?.error).toContain(`AKTIFKAN #${draftNo}`);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("draft");
  });

  it("super admin utama + konfirmasi persis: draft langsung aktif, tercatat di audit", async () => {
    const res = await aktifkanDraft({ tanpaPersetujuan: "1", konfirmasi: `aktifkan #${draftNo}` });
    expect(res?.error, res?.error).toBeUndefined();
    expect(res?.success).toMatch(new RegExp(`Revisi #${draftNo} aktif`));
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("aktif");
    const jejak = await db.auditLog.findFirst({
      where: { action: "rab.aktivasi_tanpa_persetujuan", resourceId: draftId },
      select: { userId: true, payload: true },
    });
    expect(jejak?.userId).toBe(akar.id);
    expect(jejak?.payload).toMatchObject({ jalur: "tombol_aktifkan", revisionNo: draftNo });
  }, 300_000);
});

describe("impor \"Jadikan RAB AKTIF\" tanpa persetujuan", () => {
  async function impor(isian: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("mode", "aktifkan");
    fd.set("file", berkas());
    for (const [k, v] of Object.entries(isian)) fd.set(k, v);
    return (await importHps(undefined, fd)) ?? {};
  }

  it("berkas yang mengubah isi kontrak langsung jadi RAB aktif bagi super admin utama", async () => {
    sebagai = akar;
    // RAB aktif dibuat berbeda volume dari berkas – berkasnya "mengubah kontrak".
    const aktif = await db.rabRevision.findFirstOrThrow({ where: { locationId, status: "aktif" } });
    const item = await db.rabNode.findFirstOrThrow({
      where: { revisionId: aktif.id, kind: "item", volume: { gt: 1 } },
      orderBy: { sortOrder: "asc" },
    });
    await db.rabNode.update({ where: { id: item.id }, data: { volume: Number(item.volume) + 1 } });

    const pratinjau = await impor();
    expect(pratinjau.preview?.koreksi?.boleh).toBe(false);
    const berikut = pratinjau.preview!.tanpaPersetujuan;
    expect(berikut).toEqual({ revisionNo: aktif.revisionNo + 1 });

    // Super admin biasa tidak ditawari jalan pintas.
    sebagai = adminBiasa;
    try {
      expect((await impor()).preview?.tanpaPersetujuan).toBeNull();
    } finally {
      sebagai = akar;
    }

    const simpan = await impor({
      confirm: "1",
      previewSha: pratinjau.preview!.sha256,
      tanpaPersetujuan: "1",
      konfirmasi: `AKTIFKAN #${berikut!.revisionNo}`,
    });
    expect(simpan.error, simpan.error).toBeUndefined();
    expect(simpan.success).toMatch(/tanpa persetujuan/);
    const kini = await db.rabRevision.findFirstOrThrow({ where: { locationId, status: "aktif" } });
    expect(kini.revisionNo).toBe(berikut!.revisionNo);
    expect(await db.rabRevision.count({ where: { locationId, status: "draft" } })).toBe(0);
    const jejak = await db.auditLog.findFirst({
      where: { action: "rab.aktivasi_tanpa_persetujuan", resourceId: kini.id },
      select: { payload: true },
    });
    expect(jejak?.payload).toMatchObject({ jalur: "impor" });
  }, 300_000);
});
