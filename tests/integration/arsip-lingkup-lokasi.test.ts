// ARSIP PENCABUTAN LOKASI — super admin saja (ketetapan user 2026-09-06).
//
// *"ada fitur yang langsung mengarsipkan semua lokasi yang dikeluarkan tapi
// hanya bisa dilakukan super admin, jadi di kontrak tidak ada bekas history
// yang bisa dilihat umum tapi hanya oleh super admin."*
//
// Yang dijaga di sini, karena keempatnya menentukan apakah fitur ini
// pengarsipan atau penghapusan terselubung:
//
//   1. TIDAK ADA SATU ANGKA PUN yang bergeser. Lokasi yang dicabut sudah keluar
//      dari agregat sejak tanggal berlaku CCO; kalau mengarsipkan sampai
//      menggerakkan `lingkupLokasi` — dasar seluruh agregat paket — ia bukan
//      pengarsipan.
//   2. Barisnya tidak hilang: super admin tetap melihat riwayat lengkapnya.
//   3. Yang bukan super admin tidak bisa melakukannya, dan tidak melihat
//      bekasnya.
//   4. Lokasi yang MASUK LAGI lewat adendum berikutnya tidak ikut tersembunyi —
//      menyembunyikan lokasi yang sedang berjalan adalah kerusakan, bukan
//      kerapian.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let role = "super_admin";
let sessionUserId = "";
let sessionOrgId = "";

vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  const user = () => ({ id: sessionUserId, orgId: sessionOrgId, role, fullName: "Tester" });
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(role as never, cap as never)) throw new ForbiddenError(`Tidak punya izin: ${cap}`);
      return user();
    },
    requireLocationAccess: async () => {},
    accessibleLocationIds: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
  };
});

const { db } = await import("@/lib/db");
const {
  arsipkanLokasiDicabut,
  bukaArsipLokasiDicabut,
  daftarPerubahanLingkup,
  idLokasiDiarsipkan,
  lingkupLokasi,
} = await import("@/lib/package/lingkup-lokasi");

const suffix = `ar${Date.now().toString(36)}`;
let orgId = "";
let packageId = "";
let contractId = "";
let lokasiDicabut = "";
let lokasiJalan = "";
let lokasiKembali = "";
let ccoSatu = "";
let ccoDua = "";

/** Perubahan lingkup yang LANGSUNG berlaku – empat matanya diuji di berkas lain. */
async function catatPerubahan(
  locationId: string,
  amendmentId: string,
  kind: "cabut" | "tambah",
  effectiveDate: string,
) {
  return db.locationScopeChange.create({
    data: {
      locationId,
      amendmentId,
      kind,
      effectiveDate: new Date(effectiveDate),
      status: "aktif",
      appliedAt: new Date(),
      reason: `Uji ${kind}`,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AR ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  sessionOrgId = orgId;
  sessionUserId = (
    await db.user.create({
      data: {
        orgId,
        username: `su-${suffix}`,
        fullName: "Super",
        role: "super_admin" as never,
        passwordHash: "x",
      },
    })
  ).id;

  packageId = (await db.package.create({ data: { orgId, name: `Paket AR ${suffix}` } })).id;
  const buatLokasi = async (nama: string) =>
    (
      await db.location.create({
        data: {
          packageId,
          name: nama,
          slug: `${nama.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
          village: "Desa",
          regency: "Kab",
          province: "Prov",
        },
      })
    ).id;
  lokasiDicabut = await buatLokasi("Lokasi Dicabut");
  lokasiJalan = await buatLokasi("Lokasi Jalan");
  lokasiKembali = await buatLokasi("Lokasi Kembali");

  const vendor = await db.vendor.create({ data: { orgId, name: `Vendor ${suffix}` } });
  contractId = (
    await db.contract.create({
      data: {
        packageId,
        vendorId: vendor.id,
        contractNumber: `K-${suffix}`,
        contractValue: 1_000_000_000n,
        durationDays: 180,
        signedDate: new Date("2026-06-01T00:00:00.000Z"),
      },
      select: { id: true },
    })
  ).id;
  const buatCco = async (nomor: string, tanggal: string) =>
    (
      await db.contractAmendment.create({
        data: {
          contractId,
          ccoNumber: nomor,
          valueDelta: 0n,
          endDateDelta: 0,
          effectiveDate: new Date(tanggal),
          reason: "Uji arsip",
        },
        select: { id: true },
      })
    ).id;
  ccoSatu = await buatCco("CCO-01", "2026-08-01T00:00:00.000Z");
  ccoDua = await buatCco("CCO-02", "2026-08-20T00:00:00.000Z");
});

afterAll(async () => {
  await db.locationScopeApproval.deleteMany({ where: { change: { location: { packageId } } } });
  await db.locationScopeChange.deleteMany({ where: { location: { packageId } } });
  await db.location.deleteMany({ where: { packageId } });
  // contract_amendments & audit_logs append-only (trigger DB) – jejaknya memang
  // tidak dihapus, dan pengguna + organisasi ditinggal karena jejak itu
  // menunjuk ke sana.
  await db.$disconnect();
});

beforeEach(async () => {
  role = "super_admin";
  await db.locationScopeChange.deleteMany({ where: { location: { packageId } } });
  await catatPerubahan(lokasiDicabut, ccoSatu, "cabut", "2026-08-01T00:00:00.000Z");
});

const semua = () => [lokasiDicabut, lokasiJalan, lokasiKembali];

describe("izin", () => {
  it("yang bukan super admin tidak bisa mengarsipkan", async () => {
    role = "program_director";
    await expect(arsipkanLokasiDicabut(packageId)).rejects.toThrow(/izin/i);
    expect((await idLokasiDiarsipkan(semua())).size).toBe(0);
  });

  it("yang bukan super admin juga tidak bisa membuka arsip", async () => {
    await arsipkanLokasiDicabut(packageId);
    role = "program_director";
    await expect(bukaArsipLokasiDicabut(packageId)).rejects.toThrow(/izin/i);
    expect((await idLokasiDiarsipkan(semua())).has(lokasiDicabut)).toBe(true);
  });
});

describe("mengarsipkan tidak menggeser satu angka pun", () => {
  it("bacaan lingkup – dasar SELURUH agregat paket – persis sama sebelum dan sesudah", async () => {
    const sebelum = await lingkupLokasi(semua());
    const { jumlah } = await arsipkanLokasiDicabut(packageId);
    const sesudah = await lingkupLokasi(semua());

    expect(jumlah).toBe(1);
    expect([...sesudah.dicabut.keys()]).toEqual([...sebelum.dicabut.keys()]);
    expect(sesudah.dicabut.get(lokasiDicabut)!.ccoNumber).toBe("CCO-01");
    expect(sesudah.dicabut.get(lokasiDicabut)!.effectiveDate.toISOString()).toBe(
      sebelum.dicabut.get(lokasiDicabut)!.effectiveDate.toISOString(),
    );
    expect([...sesudah.masuk.keys()]).toEqual([...sebelum.masuk.keys()]);
  });

  it("barisnya tidak dihapus dan statusnya tidak disentuh", async () => {
    await arsipkanLokasiDicabut(packageId);
    const row = await db.locationScopeChange.findFirstOrThrow({
      where: { locationId: lokasiDicabut },
    });
    expect(row.status).toBe("aktif");
    expect(row.appliedAt).not.toBeNull();
    expect(row.effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(row.archivedAt).not.toBeNull();
    expect(row.archivedById).toBe(sessionUserId);
  });
});

describe("yang terlihat sesudah diarsipkan", () => {
  it("riwayatnya hilang dari pandangan umum, utuh bagi super admin", async () => {
    await arsipkanLokasiDicabut(packageId);

    const umum = await daftarPerubahanLingkup(semua());
    expect(umum).toHaveLength(0);

    const superAdmin = await daftarPerubahanLingkup(semua(), { termasukArsip: true });
    expect(superAdmin).toHaveLength(1);
    expect(superAdmin[0]!.locationName).toBe("Lokasi Dicabut");
    expect(superAdmin[0]!.ccoNumber).toBe("CCO-01");
    expect(superAdmin[0]!.diarsipkanPada).not.toBeNull();
  });

  it("lokasinya masuk daftar sembunyi; yang masih berjalan tidak ikut", async () => {
    await arsipkanLokasiDicabut(packageId);
    const arsip = await idLokasiDiarsipkan(semua());
    expect([...arsip]).toEqual([lokasiDicabut]);
    expect(arsip.has(lokasiJalan)).toBe(false);
  });

  it("usulan yang masih DRAFT bukan 'lokasi yang dikeluarkan' – tidak ikut terarsip", async () => {
    await db.locationScopeChange.create({
      data: {
        locationId: lokasiJalan,
        amendmentId: ccoDua,
        kind: "cabut",
        effectiveDate: new Date("2026-08-20T00:00:00.000Z"),
        status: "draft",
        reason: "Masih menunggu persetujuan",
      },
    });
    const { jumlah } = await arsipkanLokasiDicabut(packageId);
    expect(jumlah).toBe(1);

    const draft = await db.locationScopeChange.findFirstOrThrow({
      where: { locationId: lokasiJalan, status: "draft" },
    });
    expect(draft.archivedAt).toBeNull();
    // Draftnya tetap terbaca umum: yang disembunyikan hanya yang SUDAH selesai.
    const umum = await daftarPerubahanLingkup(semua());
    expect(umum.map((p) => p.locationName)).toEqual(["Lokasi Jalan"]);
  });

  it("lokasi yang MASUK LAGI lewat CCO berikutnya tidak ikut tersembunyi", async () => {
    await catatPerubahan(lokasiKembali, ccoSatu, "cabut", "2026-08-01T00:00:00.000Z");
    await catatPerubahan(lokasiKembali, ccoDua, "tambah", "2026-08-20T00:00:00.000Z");
    await arsipkanLokasiDicabut(packageId);

    const arsip = await idLokasiDiarsipkan(semua());
    expect(arsip.has(lokasiKembali)).toBe(false);
    expect(arsip.has(lokasiDicabut)).toBe(true);
  });
});

describe("jejak dan jalan pulang", () => {
  it("pengarsipan itu sendiri tercatat di audit log", async () => {
    await arsipkanLokasiDicabut(packageId);
    const jejak = await db.auditLog.findFirst({
      where: { action: "location_scope.arsip", resourceId: packageId },
      orderBy: { createdAt: "desc" },
    });
    expect(jejak).not.toBeNull();
    const isi = JSON.stringify(jejak!.payload);
    expect(isi).toContain("Lokasi Dicabut");
    expect(isi).toContain("CCO-01");
  });

  it("buka arsip mengembalikan riwayatnya ke pandangan umum", async () => {
    await arsipkanLokasiDicabut(packageId);
    const { jumlah } = await bukaArsipLokasiDicabut(packageId);
    expect(jumlah).toBe(1);
    expect((await daftarPerubahanLingkup(semua())).map((p) => p.locationName)).toEqual([
      "Lokasi Dicabut",
    ]);
    expect((await idLokasiDiarsipkan(semua())).size).toBe(0);
  });

  it("tanpa pencabutan berlaku, tidak ada yang diarsipkan dan tidak ada yang gagal", async () => {
    await db.locationScopeChange.deleteMany({ where: { location: { packageId } } });
    expect(await arsipkanLokasiDicabut(packageId)).toEqual({ jumlah: 0 });
    expect(await bukaArsipLokasiDicabut(packageId)).toEqual({ jumlah: 0 });
  });
});
