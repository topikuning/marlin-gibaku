// IMPOR BERTANYA LEWAT AKSI SERVER (DECISIONS 624).
//
// Teguran user 2026-09-27: *"kenapa kamu tidak lempar pertanyaan ke user? sheet
// mana yang dipakai ambil dari kolom mana … daripada error gak jelas!"*.
// Berkas yang tidak bisa dipastikan dijawab `tanya` (bukan `error`), dan
// jawaban kolom dari layar menghasilkan pratinjau yang menyebut pilihan itu.
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let sesi: { id: string; orgId: string; role: string };
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => sesi,
    requireCapability: async () => sesi,
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { importHps } = await import("@/app/(app)/lokasi/[slug]/rab/import/actions");

const suffix = `tn${Date.now().toString(36)}`;
let locationId: string;

async function berkasAneh(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.getRow(1).values = ["NO", "URAIAN", "BANYAKNYA", "UKURAN", "RAHASIA", "NILAI PER UNIT", "NILAI"];
  ws.getRow(2).values = ["I", "PEKERJAAN PERSIAPAN"];
  [
    ["1", "Pagar sementara", 100, "m", 375_000],
    ["2", "Direksi keet", 1, "unit", 25_000_000],
    ["3", "Papan nama", 2, "bh", 1_500_000],
    ["4", "Air kerja", 6, "bln", 800_000],
  ].forEach(([k, n, v, s, h], i) => {
    ws.getRow(3 + i).values = [k, n, v, s, 999_999_999, h, (v as number) * (h as number)];
  });
  ws.getColumn(5).hidden = true;
  wb.addWorksheet("REKAP").getRow(1).values = ["rekap"];
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new File([new Uint8Array(buf)], "aneh.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org TN ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `tn-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  sesi = { id: user.id, orgId: org.id, role: "super_admin" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket TN ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi TN ${suffix}`,
      slug: `lok-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Jawa Tengah",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("aksi impor bertanya, bukan menampilkan galat", () => {
  it("berkas yang tidak bisa dipastikan → `tanya` berisi sebab, sheet, dan kolom terlihat", async () => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("mode", "aktifkan");
    fd.set("file", await berkasAneh());
    const res = await importHps(undefined, fd);
    expect(res?.error).toBeUndefined();
    expect(res?.tanya?.sebab).toMatch(/disembunyikan/);
    expect(res?.tanya?.sheets).toEqual(["RAB", "REKAP"]);
    expect(res?.tanya?.kolom.map((k) => k.huruf)).not.toContain("E");
  });

  it("jawaban kolom → pratinjau yang menyebut pilihan itu", async () => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("mode", "aktifkan");
    fd.set("file", await berkasAneh());
    fd.set("sheet", "RAB");
    fd.set("kolom", JSON.stringify({ vol: 3, unit: 4, price: 6, amount: 7 }));
    const res = await importHps(undefined, fd);
    expect(res?.error, res?.error).toBeUndefined();
    expect(res?.preview?.itemCount).toBe(4);
    expect(res?.preview?.baca?.usulan).toEqual({ vol: 3, unit: 4, price: 6, amount: 7 });
    expect(res?.preview?.priceColumnLabel).toMatch(/pilihan Anda/);
  });
});
