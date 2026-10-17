// CARI CEPAT ⌘K (DECISIONS 684), basis data sungguhan.
//
// Yang dijaga: isinya persis yang BOLEH dibuka akun itu – tidak satu hasil pun
// berujung 404, dan tidak satu pun lokasi di luar penugasan/organisasi bocor
// lewat jalan pintas ini.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { daftarCariCepat } = await import("@/lib/cari-cepat/daftar");

const suffix = `cc${Date.now().toString(36)}`;
const orgIds: string[] = [];
const paketIds: string[] = [];
const ids: Record<string, string> = {};

type Peran = "super_admin" | "program_director" | "site_manager";
const pengguna = (peran: Peran, orgId = orgIds[0]) =>
  ({ id: ids[peran], orgId, role: peran, fullName: peran }) as never;

beforeAll(async () => {
  for (const n of ["A", "B"]) {
    orgIds.push((await db.organization.create({ data: { name: `Org ${n} ${suffix}`, slug: `org-${n}-${suffix}` } })).id);
  }
  const vendor = await db.vendor.create({ data: { orgId: orgIds[0], name: `CV Bahari ${suffix}` } });
  const paket = async (orgId: string, name: string) => {
    const p = await db.package.create({ data: { orgId, name, packageNumber: `PKT-${name}`, province: "Jawa Tengah" } });
    paketIds.push(p.id);
    return p.id;
  };
  const p1 = await paket(orgIds[0], `Paket Pantura ${suffix}`);
  const p2 = await paket(orgIds[0], `Paket Selatan ${suffix}`);
  const pLain = await paket(orgIds[1], `Paket Org Lain ${suffix}`);
  await db.contract.create({
    data: {
      packageId: p1,
      vendorId: vendor.id,
      contractNumber: `K-${suffix}`,
      contractValue: 1_000_000_000n,
      durationDays: 180,
      signedDate: new Date("2026-06-01T00:00:00.000Z"),
    },
  });
  const lokasi = async (key: string, packageId: string, name: string, village: string) => {
    ids[key] = (
      await db.location.create({
        data: { packageId, name, slug: `${key}-${suffix}`, village, regency: "Kab. Demak", province: "Jawa Tengah" },
      })
    ).id;
  };
  await lokasi("mutih", p1, "Kedung Mutih", "Desa Kedungmutih");
  await lokasi("cabut", p1, "Lokasi Dicabut", "Desa Sayung");
  await lokasi("selatan", p2, "Krakahan", "Desa Krakahan");
  await lokasi("lain", pLain, "Lokasi Org Lain", "Desa Lain");

  for (const peran of ["super_admin", "program_director", "site_manager"] as const) {
    ids[peran] = (
      await db.user.create({
        data: { orgId: orgIds[0], username: `${peran}-${suffix}`, fullName: peran, role: peran as never, passwordHash: "x" },
      })
    ).id;
  }
  await db.locationAssignment.create({ data: { userId: ids.site_manager, locationId: ids.mutih } });

  // Pencabutan "Lokasi Dicabut" sudah berlaku DAN diarsipkan.
  const amendment = await db.contractAmendment.create({
    data: {
      contractId: (await db.contract.findFirstOrThrow({ where: { packageId: p1 } })).id,
      ccoNumber: "CCO-01",
      valueDelta: 0n,
      endDateDelta: 0,
      effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
      reason: "Uji cari cepat",
    },
  });
  await db.locationScopeChange.create({
    data: {
      locationId: ids.cabut,
      amendmentId: amendment.id,
      kind: "cabut",
      effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
      status: "aktif",
      appliedAt: new Date(),
      archivedAt: new Date(),
      reason: "Uji",
    },
  });
});

afterAll(async () => {
  await db.locationScopeChange.deleteMany({ where: { location: { packageId: { in: paketIds } } } });
  await db.locationAssignment.deleteMany({ where: { location: { packageId: { in: paketIds } } } });
  await db.location.deleteMany({ where: { packageId: { in: paketIds } } });
  // Kontrak, adendum (append-only), pengguna, dan organisasi ditinggal:
  // jejak audit menunjuk ke sana.
  await db.$disconnect();
});

const judul = (xs: { judul: string }[]) => xs.map((x) => x.judul);

describe("daftarCariCepat – akses sama dengan halaman tujuan", () => {
  it("lintas lokasi: semua lokasi & paket ORGANISASI-nya, tanpa lokasi yang diarsipkan", async () => {
    const d = await daftarCariCepat(pengguna("program_director"));
    expect(d.terbatas).toBe(false);
    expect(judul(d.lokasi)).toEqual(expect.arrayContaining(["Kedung Mutih", "Krakahan"]));
    expect(judul(d.lokasi)).not.toContain("Lokasi Dicabut");
    expect(judul(d.lokasi)).not.toContain("Lokasi Org Lain");
    expect(judul(d.paket)).toEqual(expect.arrayContaining([`Paket Pantura ${suffix}`, `Paket Selatan ${suffix}`]));
    expect(judul(d.paket)).not.toContain(`Paket Org Lain ${suffix}`);
  });

  it("super admin (boleh melihat arsip): lokasi yang diarsipkan tetap muncul", async () => {
    const d = await daftarCariCepat(pengguna("super_admin"));
    expect(judul(d.lokasi)).toContain("Lokasi Dicabut");
  });

  it("akun ter-scope: hanya lokasi penugasan dan paketnya, ditandai terbatas", async () => {
    const d = await daftarCariCepat(pengguna("site_manager"));
    expect(d.terbatas).toBe(true);
    expect(d.lokasi.map((l) => l.judul)).toEqual(["Kedung Mutih"]);
    expect(d.paket.map((p) => p.judul)).toEqual([`Paket Pantura ${suffix}`]);
  });

  it("isi baris: slug/id tujuan, wilayah · paket, dan desa + perusahaan ikut dicari", async () => {
    const d = await daftarCariCepat(pengguna("site_manager"));
    expect(d.lokasi[0]).toMatchObject({
      jenis: "lokasi",
      kunci: `mutih-${suffix}`,
      keterangan: `Kab. Demak, Jawa Tengah · Paket Pantura ${suffix}`,
      status: "Persiapan",
    });
    expect(d.lokasi[0].cari).toContain("Desa Kedungmutih");
    expect(d.lokasi[0].cari).toContain(`CV Bahari ${suffix}`);
    expect(d.paket[0]).toMatchObject({ jenis: "paket", kunci: paketIds[0], status: "Prospek" });
    expect(d.paket[0].keterangan).toBe(`PKT-Paket Pantura ${suffix} · Jawa Tengah · CV Bahari ${suffix}`);
  });
});
