// ISIAN CEPAT PENANDA TANGAN (DECISIONS 758) – terhadap DATABASE ASLI.
//
// Permintaan user 2026-11-11 (tangkapan layar "Penanda tangan belum diisi:
// Pengawas Lapangan, Team Leader, Manajer Proyek"): *"ini yang belum terisi
// seharusnya tinggal klik yang mana, lalu masuk pilihan inputan nama dan
// ttdnya"*.
//
// Yang dijaga:
// 1. mengisi SATU slot tidak mengosongkan nama lain (bahaya nyata: aksi
//    formulir lengkap menulis semua kolom sekaligus);
// 2. Pelaksana Lapangan tersimpan di PAKET, sisanya di kontrak – kolom yang
//    sama dengan yang dibaca cetakan, jadi slotnya hilang dari peringatan;
// 3. izin `contract.manage`, lokasi organisasi lain, dan isian tidak sah ditolak;
// 4. unggahan yang gagal tidak meninggalkan nama setengah tersimpan;
// 5. tercatat di audit.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) }));

let sesi = { id: "", orgId: "", role: "program_director" };
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/authz");
  class ForbiddenError extends Error {}
  const user = () => ({ ...sesi, fullName: "Tester", username: "tester" });
  return {
    ForbiddenError,
    requestIp: async () => null,
    requireUser: async () => user(),
    getCurrentUser: async () => user(),
    hasLocationAccess: async () => true,
    accessibleLocationIds: async () => null,
    requireCapability: async (cap: string) => {
      if (!can(sesi.role as never, cap as never)) throw new ForbiddenError("Anda tidak punya izin untuk tindakan ini.");
      return user();
    },
    requireLocationAccess: async () => {},
  };
});

const { db } = await import("@/lib/db");
const { isiPenandatanganAction } = await import("@/app/(app)/lokasi/[slug]/laporan-lokasi/penandatangan-actions");
const { namaPenandatanganLokasi } = await import("@/lib/export/ttd-laporan");
const { slotPenandatanganKosong } = await import("@/lib/laporan/penandatangan");

const suffix = `ip${Date.now().toString(36)}`;
let locationId = "";
let contractId = "";
let packageId = "";
let lokasiLain = "";

const kirim = (isi: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return isiPenandatanganAction(undefined, f);
};

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org ${suffix}`, slug: `o-${suffix}` } });
  const u = await db.user.create({
    data: { orgId: org.id, username: `pd-${suffix}`, fullName: "PD Uji", role: "program_director", passwordHash: "x" },
  });
  sesi = { id: u.id, orgId: org.id, role: "program_director" };
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket ${suffix}`, stage: "pelaksanaan" } });
  packageId = pkg.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `Vendor ${suffix}` } });
  const c = await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `SPK-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-08-01"),
      durationDays: 150,
      ppkName: "Ir. Pejabat Komitmen",
      wakilSahName: "Wakil Sah Satu",
      contractorSignerName: "Direktur Uji",
    },
  });
  contractId = c.id;
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Lokasi", slug: `lok-${suffix}`, village: "Desa", regency: "Kab", province: "Prov", isActive: true },
  });
  locationId = loc.id;
  // Lokasi organisasi LAIN.
  const org2 = await db.organization.create({ data: { name: `Org2 ${suffix}`, slug: `o2-${suffix}` } });
  const pkg2 = await db.package.create({ data: { orgId: org2.id, name: `Paket2 ${suffix}` } });
  lokasiLain = (
    await db.location.create({
      data: { packageId: pkg2.id, name: "Lain", slug: `lain-${suffix}`, village: "D", regency: "K", province: "P", isActive: true },
    })
  ).id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("isian cepat satu slot", () => {
  it("Team Leader diisi: hanya kolomnya yang berubah, slotnya hilang dari peringatan, tercatat di audit", async () => {
    const sebelum = slotPenandatanganKosong((await namaPenandatanganLokasi(locationId))!).map((s) => s.pihak);
    expect(sebelum).toContain("team_leader");
    const r = await kirim({ locationId, pihak: "team_leader", nama: "  Teguh Ketua  " });
    expect(r?.success, r?.error).toMatch(/Team Leader diisi: Teguh Ketua/);
    const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(c.teamLeaderName).toBe("Teguh Ketua");
    // Nama lain TIDAK tersentuh.
    expect([c.ppkName, c.wakilSahName, c.contractorSignerName]).toEqual(["Ir. Pejabat Komitmen", "Wakil Sah Satu", "Direktur Uji"]);
    const sesudah = slotPenandatanganKosong((await namaPenandatanganLokasi(locationId))!).map((s) => s.pihak);
    expect(sesudah).not.toContain("team_leader");
    const a = await db.auditLog.findFirst({ where: { action: "contract.signatory_slot", resourceId: packageId } });
    expect(a?.payload).toMatchObject({ pihak: "team_leader", nama: "Teguh Ketua", ttdDiunggah: false });
  });

  it("Pelaksana Lapangan tersimpan di paket", async () => {
    const r = await kirim({ locationId, pihak: "pelaksana", nama: "Joko Pelaksana" });
    expect(r?.success, r?.error).toBeTruthy();
    expect((await db.package.findUniqueOrThrow({ where: { id: packageId } })).pelaksanaName).toBe("Joko Pelaksana");
  });

  it("unggahan gagal (R2 belum disiapkan): nama juga tidak ditulis", async () => {
    const berkas = new File([new Uint8Array([137, 80, 78, 71])], "ttd.png", { type: "image/png" });
    const r = await kirim({ locationId, pihak: "manajer_proyek", nama: "Hadi Manajer", ttd: berkas });
    expect(r?.error).toMatch(/R2|Penyimpanan/);
    expect((await db.contract.findUniqueOrThrow({ where: { id: contractId } })).projectManagerName).toBeNull();
  });
});

describe("yang ditolak", () => {
  it("nama kosong, pihak tidak dikenal, lokasi organisasi lain", async () => {
    expect((await kirim({ locationId, pihak: "team_leader", nama: " " }))?.error).toMatch(/nama/i);
    expect((await kirim({ locationId, pihak: "presiden", nama: "Siapa" }))?.error).toMatch(/tidak dikenal/);
    expect((await kirim({ locationId: lokasiLain, pihak: "team_leader", nama: "Penyusup" }))?.error).toMatch(/tidak ditemukan/);
  });

  it("peran tanpa izin kontrak ditolak, tidak ada yang ditulis", async () => {
    const asli = sesi.role;
    sesi.role = "site_manager"; // boleh ekspor laporan, bukan pengelola kontrak
    try {
      const r = await kirim({ locationId, pihak: "ppk", nama: "Bukan Siapa-siapa" });
      expect(r?.error).toBeTruthy();
      expect((await db.contract.findUniqueOrThrow({ where: { id: contractId } })).ppkName).toBe("Ir. Pejabat Komitmen");
    } finally {
      sesi.role = asli;
    }
  });
});
