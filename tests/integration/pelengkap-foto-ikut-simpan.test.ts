// FOTO MATERIAL/ALAT IKUT SIMPANAN PELENGKAP (DECISIONS 343).
//
// Yang dijaga di sini bukan "fotonya terunggah", melainkan **menempel pada
// baris yang BENAR**. Baris tanpa nama dibuang penyimpanan, sehingga posisi
// sesudah penyaringan tidak lagi sama dengan posisi di form. Kalau pemasangan
// foto memakai posisi sesudah penyaringan, foto baris ke-3 menempel ke baris
// ke-2 — bukti yang menempel pada barang yang salah, tanpa satu pun galat.
//
// Itu jenis cacat yang tidak akan pernah ketahuan dari layar: kedua baris punya
// foto, jumlahnya benar, hanya isinya tertukar.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(),
    requireCapability: async () => pengguna(),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { getOrCreateDraft, setEnrichment } = await import("@/lib/daily-report/service");

const suffix = `pf${Date.now().toString(36)}`;
let locationId = "";
let userId = "";
let reportId = "";

async function pengguna() {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: suffix } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" },
  });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: `Lokasi ${suffix}`,
      slug: `lok-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      isActive: true,
    },
  });
  locationId = loc.id;
  const u = await db.user.create({
    data: {
      orgId: org.id,
      username: `sm-${suffix}`,
      fullName: "SM Uji",
      role: "site_manager",
      passwordHash: "x",
    },
  });
  userId = u.id;
  const r = await getOrCreateDraft(locationId, "2026-06-02", userId);
  reportId = r.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE photos, daily_report_materials, daily_report_equipment,
     daily_report_status_history, daily_reports, audit_logs, locations, packages,
     users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

beforeEach(async () => {
  await db.dailyReportMaterial.deleteMany({ where: { reportId } });
  await db.dailyReportEquipment.deleteMany({ where: { reportId } });
});

const dasar = { weather: undefined, workStart: null, workEnd: null, notes: null, workers: [] };

describe("setEnrichment mengembalikan id sejajar MASUKAN", () => {
  it("id material sejajar posisi form, bukan posisi sesudah penyaringan", async () => {
    // Baris ke-1 KOSONG (akan dibuang). Kalau id dikembalikan menurut posisi
    // sesudah penyaringan, "Pasir" akan menerima indeks 0 — dan foto yang
    // dikirim untuk baris ke-2 akan menempel padanya.
    const hasil = await setEnrichment(
      reportId,
      {
        ...dasar,
        materials: [
          { id: null, name: "   ", unit: null, qty: null },
          { id: null, name: "Pasir", unit: "m3", qty: 3 },
          { id: null, name: "Semen", unit: "zak", qty: 40 },
        ],
        equipment: [],
      },
      userId,
    );
    expect(hasil.idMaterial).toHaveLength(3);
    expect(hasil.idMaterial[0], "baris kosong seharusnya null").toBeNull();

    const pasir = await db.dailyReportMaterial.findUniqueOrThrow({
      where: { id: hasil.idMaterial[1]! },
    });
    const semen = await db.dailyReportMaterial.findUniqueOrThrow({
      where: { id: hasil.idMaterial[2]! },
    });
    expect(pasir.name).toBe("Pasir");
    expect(semen.name).toBe("Semen");
  });

  it("id alat juga sejajar masukan", async () => {
    const hasil = await setEnrichment(
      reportId,
      {
        ...dasar,
        materials: [],
        equipment: [
          { id: null, name: "", count: 1 },
          { id: null, name: "Molen", count: 2 },
        ],
      },
      userId,
    );
    expect(hasil.idAlat[0]).toBeNull();
    const molen = await db.dailyReportEquipment.findUniqueOrThrow({
      where: { id: hasil.idAlat[1]! },
    });
    expect(molen.name).toBe("Molen");
  });

  it("baris LAMA yang diperbarui mengembalikan id yang SAMA – foto tidak lepas", async () => {
    // Inti DECISIONS 304 yang harus tetap berlaku: menyimpan ulang tidak boleh
    // membuat baris baru, karena foto menempel pada id-nya.
    const p1 = await setEnrichment(
      reportId,
      { ...dasar, materials: [{ id: null, name: "Besi", unit: "kg", qty: 10 }], equipment: [] },
      userId,
    );
    const id1 = p1.idMaterial[0]!;
    const p2 = await setEnrichment(
      reportId,
      { ...dasar, materials: [{ id: id1, name: "Besi beton", unit: "kg", qty: 12 }], equipment: [] },
      userId,
    );
    expect(p2.idMaterial[0]).toBe(id1);
    const baris = await db.dailyReportMaterial.findUniqueOrThrow({ where: { id: id1 } });
    expect(baris.name).toBe("Besi beton");
  });

  it("baris yang dihapus dari form ikut hilang, dan id-nya tidak dikembalikan", async () => {
    const p1 = await setEnrichment(
      reportId,
      {
        ...dasar,
        materials: [
          { id: null, name: "A", unit: null, qty: null },
          { id: null, name: "B", unit: null, qty: null },
        ],
        equipment: [],
      },
      userId,
    );
    const idB = p1.idMaterial[1]!;
    const p2 = await setEnrichment(
      reportId,
      { ...dasar, materials: [{ id: p1.idMaterial[0], name: "A", unit: null, qty: null }], equipment: [] },
      userId,
    );
    expect(p2.idMaterial).toHaveLength(1);
    expect(await db.dailyReportMaterial.count({ where: { id: idB } })).toBe(0);
  });
});
