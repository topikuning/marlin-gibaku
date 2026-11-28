// UNDUH "RAPL SIAP ISI HARGA" – lokasi & paket (DECISIONS 803).
//
// Berkasnya memuat biaya dan selisih terhadap RAB, jadi pintunya sama dengan
// unduhan RAPL lain: `report.export` + `rapl.view`. Pelaksana tidak melihat
// rupiah sama sekali (735). Unduhan paket hanya memuat lokasi yang boleh
// dibuka pemakainya dan yang punya RAB aktif; paket organisasi lain = tidak ada.
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

let sesi: { id: string; orgId: string; role: string; mustChangePassword: boolean } = { id: "", orgId: "", role: "project_manager", mustChangePassword: false };
let boleh: string[] | null = null;
vi.mock("@/lib/auth/session", async (asli) => ({
  ...(await asli<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => sesi,
  hasLocationAccess: async (_u: unknown, id: string) => boleh === null || boleh.includes(id),
  accessibleLocationIds: async () => boleh,
}));

const { db } = await import("@/lib/db");
const { createRevisionFromNodes, activateRevision } = await import("@/lib/rab/import");
const { GET: unduhLokasi } = await import("@/app/(app)/lokasi/[slug]/rapl/siap-isi/route");
const { GET: unduhPaket } = await import("@/app/(app)/paket/[id]/rapl-siap-isi/route");

const sfx = `rs${Date.now().toString(36)}`;
let paketId = "";
const lokasi: { id: string; slug: string }[] = [];

async function buatLokasi(nama: string, adminId: string, berRab: boolean) {
  const loc = await db.location.create({
    data: { packageId: paketId, name: nama, slug: `${nama.toLowerCase()}-${sfx}`, village: "V", regency: "Bitung", province: "Sulawesi Utara", status: "berjalan" },
  });
  lokasi.push({ id: loc.id, slug: loc.slug });
  if (!berRab) return;
  const r = await createRevisionFromNodes(
    loc.id,
    [
      { kind: "kategori" as const, code: "I", name: "PEKERJAAN STRUKTUR", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0, excelRow: null },
      { kind: "item" as const, code: "1", name: "Beton fc' 20 MPa site mix", volume: 10, unit: "m³", unitPrice: 1_500_000, amount: 15_000_000n, lineageKey: "I#1", parentLineageKey: "I", sortOrder: 1, excelRow: null },
    ],
    { source: "hps_awal", userId: adminId, note: "uji" },
  );
  await activateRevision(r.revisionId, adminId);
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${sfx}`, slug: `o-${sfx}` } });
  const admin = await db.user.create({ data: { orgId: org.id, username: `a-${sfx}`, fullName: "Admin", passwordHash: "x", role: "super_admin" } });
  sesi = { id: admin.id, orgId: org.id, role: "project_manager", mustChangePassword: false };
  paketId = (await db.package.create({ data: { orgId: org.id, name: `Paket ${sfx}`, stage: "pelaksanaan" } })).id;
  await buatLokasi("Iyok", admin.id, true);
  await buatLokasi("Jiko", admin.id, true);
  await buatLokasi("Kosong", admin.id, false);
}, 120_000);

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
});

async function sheet(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb.worksheets.map((w) => w.name);
}

describe("unduh RAPL siap isi", () => {
  it("lokasi: Project Manager mendapat berkas Excel bersheet Rekapitulasi/Isi Harga/Rincian", async () => {
    sesi.role = "project_manager";
    boleh = null;
    const res = await unduhLokasi(new Request("http://uji"), { params: Promise.resolve({ slug: lokasi[0]!.slug }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("rapl-siap-isi-");
    expect(await sheet(res)).toEqual(["Rekapitulasi", "Isi Harga", "Rincian"]);
    expect(await db.auditLog.count({ where: { action: "report.export_rapl_siap_isi", resourceId: lokasi[0]!.id } })).toBe(1);
  });

  it("pelaksana ditolak – berkasnya memuat rupiah", async () => {
    sesi.role = "field_supervisor";
    const res = await unduhLokasi(new Request("http://uji"), { params: Promise.resolve({ slug: lokasi[0]!.slug }) });
    expect(res.status).toBe(403);
    sesi.role = "project_manager";
  });

  it("lokasi yang tidak boleh dibuka: ditolak", async () => {
    boleh = [lokasi[1]!.id];
    const res = await unduhLokasi(new Request("http://uji"), { params: Promise.resolve({ slug: lokasi[0]!.slug }) });
    expect(res.status).toBe(403);
    boleh = null;
  });

  it("paket: hanya lokasi ber-RAB aktif yang boleh dibuka, satu Isi Harga bersama", async () => {
    const semua = await unduhPaket(new Request("http://uji"), { params: Promise.resolve({ id: paketId }) });
    expect(semua.status).toBe(200);
    expect(await sheet(semua)).toEqual(["Rekapitulasi", "Isi Harga", "Rincian Iyok", "Rincian Jiko"]);
    boleh = [lokasi[1]!.id, lokasi[2]!.id];
    const sebagian = await unduhPaket(new Request("http://uji"), { params: Promise.resolve({ id: paketId }) });
    expect(await sheet(sebagian)).toEqual(["Rekapitulasi", "Isi Harga", "Rincian"]);
    boleh = null;
  });

  it("paket organisasi lain: tidak ditemukan", async () => {
    const asli = sesi.orgId;
    sesi.orgId = "00000000-0000-0000-0000-000000000000";
    const res = await unduhPaket(new Request("http://uji"), { params: Promise.resolve({ id: paketId }) });
    expect(res.status).toBe(404);
    sesi.orgId = asli;
  });
});
