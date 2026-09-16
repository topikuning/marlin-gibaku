// PERUBAHAN LINGKUP LOKASI: capability saja TIDAK CUKUP (audit 2026-09-15, H-1).
//
// `contract.manage` dipegang Area Manager dan Project Manager — dua peran yang
// BUKAN lintas-lokasi, artinya haknya terbatas pada lokasi yang ditugaskan
// kepadanya. Versi pertama memuat lokasi dengan `findUnique({ where: { id } })`
// tanpa filter organisasi dan tanpa `requireLocationAccess`, jadi satu UUID yang
// terbaca dari dokumen mana pun sudah cukup untuk mengajukan DAN menyetujui
// pencabutan lokasi paket lain — bahkan organisasi lain.
//
// Akibatnya bukan kecil: begitu empat mata terpenuhi, `lingkupLokasi()`
// mengeluarkan lokasi itu dari SELURUH agregat paket (nilai kontrak, progres,
// kurva-S, laporan KKP) sejak tanggal berlaku.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

/*
 * Hanya `requireCapability` yang dipalsukan — pagar LOKASI justru yang diuji,
 * jadi `requireLocationAccess`/`hasLocationAccess` harus tetap yang asli.
 */
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pmUji(),
    requireCapability: async () => pmUji(),
    requestIp: async () => null,
  };
});

async function pmUji() {
  return db.user.findUniqueOrThrow({
    where: { id: pmId },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

const { db } = await import("@/lib/db");
const { ForbiddenError } = await import("@/lib/auth/session");
const { ajukanPerubahanLingkup, setujuiPerubahanLingkup, batalkanPerubahanLingkup } = await import(
  "@/lib/package/lingkup-lokasi"
);

const suffix = `lk${Date.now().toString(36)}`;
let pmId = "";
let lokasiSendiriId = "";
let lokasiAsingId = "";
let adendumAsingId = "";
let usulanAsingId = "";

beforeAll(async () => {
  // Organisasi A: paket & lokasi milik PM yang diuji.
  const orgA = await db.organization.create({ data: { name: `Org A ${suffix}`, slug: `a-${suffix}` } });
  const pkgA = await db.package.create({ data: { orgId: orgA.id, name: `Paket A ${suffix}`, stage: "pelaksanaan" } });
  const lokA = await db.location.create({
    data: {
      packageId: pkgA.id, name: `Lokasi A ${suffix}`, slug: `lok-a-${suffix}`,
      village: "D", regency: "K", province: "P", isActive: true, status: "berjalan",
    },
  });
  lokasiSendiriId = lokA.id;
  const pm = await db.user.create({
    data: { orgId: orgA.id, username: `pm-${suffix}`, fullName: "PM Uji", role: "project_manager", passwordHash: "x" },
  });
  pmId = pm.id;
  await db.locationAssignment.create({ data: { userId: pm.id, locationId: lokA.id } });

  // Organisasi B: paket, lokasi, kontrak & CCO yang TIDAK ada hubungannya.
  const orgB = await db.organization.create({ data: { name: `Org B ${suffix}`, slug: `b-${suffix}` } });
  const pkgB = await db.package.create({ data: { orgId: orgB.id, name: `Paket B ${suffix}`, stage: "pelaksanaan" } });
  const lokB = await db.location.create({
    data: {
      packageId: pkgB.id, name: `Lokasi B ${suffix}`, slug: `lok-b-${suffix}`,
      village: "D", regency: "K", province: "P", isActive: true, status: "berjalan",
    },
  });
  lokasiAsingId = lokB.id;
  const vendor = await db.vendor.create({ data: { orgId: orgB.id, name: `Vendor ${suffix}` } });
  const kontrakB = await db.contract.create({
    data: {
      packageId: pkgB.id, vendorId: vendor.id, contractNumber: `KTR-${suffix}`, contractValue: 1_000n,
      signedDate: new Date("2026-01-05"), startDate: new Date("2026-01-10"), endDate: new Date("2026-06-10"),
    },
  });
  const cco = await db.contractAmendment.create({
    data: {
      contractId: kontrakB.id, ccoNumber: `CCO-${suffix}`, valueDelta: 0n, endDateDelta: 0,
      effectiveDate: new Date("2026-03-01"), reason: "uji",
    },
  });
  adendumAsingId = cco.id;
  // Usulan yang SUDAH ada di paket asing – untuk menguji jalur setujui & batal.
  const usulan = await db.locationScopeChange.create({
    data: {
      locationId: lokB.id, amendmentId: cco.id, kind: "cabut",
      effectiveDate: new Date("2026-03-01"), reason: "uji", createdById: pm.id,
    },
  });
  usulanAsingId = usulan.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE location_scope_approvals, location_scope_changes, contract_amendments, contracts,
     location_assignments, locations, packages, vendors, users, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("lokasi di luar penugasan (dan di luar organisasi)", () => {
  it("TIDAK bisa diajukan perubahan lingkupnya", async () => {
    await expect(
      ajukanPerubahanLingkup({
        locationId: lokasiAsingId,
        amendmentId: adendumAsingId,
        kind: "cabut",
        reason: "mencoba mencabut lokasi orang lain",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("TIDAK bisa disetujui usulannya", async () => {
    await expect(setujuiPerubahanLingkup(usulanAsingId)).rejects.toBeInstanceOf(ForbiddenError);
    // Dan tidak meninggalkan suara — pagar harus berdiri SEBELUM upsert.
    const suara = await db.locationScopeApproval.count({ where: { changeId: usulanAsingId } });
    expect(suara).toBe(0);
  });

  it("TIDAK bisa dibatalkan usulannya", async () => {
    await expect(batalkanPerubahanLingkup(usulanAsingId)).rejects.toBeInstanceOf(ForbiddenError);
    const row = await db.locationScopeChange.findUniqueOrThrow({ where: { id: usulanAsingId } });
    expect(row.status).toBe("draft");
  });
});

describe("lokasi YANG DITUGASKAN tetap bisa dikerjakan", () => {
  it("pagar ini menutup akses, bukan mematikan fiturnya", async () => {
    // Lokasi A tidak punya kontrak/CCO, jadi yang diharapkan LingkupError soal
    // adendum – bukan ForbiddenError. Itu membuktikan pagar aksesnya lolos.
    await expect(
      ajukanPerubahanLingkup({
        locationId: lokasiSendiriId,
        amendmentId: adendumAsingId,
        kind: "cabut",
        reason: "uji",
      }),
    ).rejects.not.toBeInstanceOf(ForbiddenError);
  });
});
