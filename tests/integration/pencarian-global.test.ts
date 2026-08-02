// Pencarian global — MATRIKS NEGATIF (PRD MARLIN P0 "Global Search", FR-NAV-02).
//
// Pencarian adalah pintu belakang klasik menuju kebocoran data: ia menyentuh
// SEMUA jenis objek sekaligus, sering ditulis sebagai "cari saja lalu tampilkan",
// dan hasil yang bocor tetap membocorkan nama walau halamannya nanti menolak
// dibuka. Karena itu uji ini menuntut yang negatif lebih dulu — apa yang TIDAK
// boleh muncul — bukan sekadar "kata kuncinya ketemu".
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { searchGlobal } = await import("@/lib/search/global");
const { MIN_QUERY } = await import("@/lib/search/types");

const suffix = `pg${Date.now().toString(36)}`;
/** Kata kunci unik: memastikan yang cocok hanya data uji ini. */
const KATA = `zqxlokasi${suffix}`;

type Sesi = Awaited<ReturnType<typeof buatOrg>>["admin"];

async function buatOrg(tag: string) {
  const org = await db.organization.create({
    data: { name: `Org ${tag} ${suffix}`, slug: `org-${tag}-${suffix}` },
  });
  const buatUser = async (role: string, nama: string) =>
    db.user.create({
      data: {
        orgId: org.id,
        username: `${role}-${tag}-${suffix}`,
        fullName: nama,
        passwordHash: "x",
        role: role as never,
      },
    });
  const adminRow = await buatUser("super_admin", `Admin ${KATA} ${tag}`);
  const smRow = await buatUser("site_manager", `SM ${tag}`);
  const mandorRow = await buatUser("field_supervisor", `Mandor ${tag}`);

  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `CV ${KATA} ${tag}` } });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${KATA} ${tag}`, packageNumber: `NO-${tag}-${suffix}` },
  });

  const buatLokasi = async (nama: string) =>
    db.location.create({
      data: {
        packageId: pkg.id,
        name: nama,
        slug: `${nama.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
        village: "Desa",
        regency: "Kab",
        province: "Prov",
      },
    });
  // Dua lokasi dalam SATU paket: yang satu ditugaskan ke SM, yang satu tidak.
  // Tanpa pasangan ini, "site_manager hanya melihat yang ditugaskan" lulus
  // hanya karena tidak ada tetangga untuk dibocorkan.
  const locDitugaskan = await buatLokasi(`${KATA} ditugaskan ${tag}`);
  const locLain = await buatLokasi(`${KATA} tidak ditugaskan ${tag}`);
  await db.locationAssignment.create({
    data: { userId: smRow.id, locationId: locDitugaskan.id },
  });
  await db.locationAssignment.create({
    data: { userId: mandorRow.id, locationId: locDitugaskan.id },
  });

  const dokAktif = await db.document.create({
    data: {
      orgId: org.id,
      packageId: pkg.id,
      locationId: locDitugaskan.id,
      phase: "kontrak",
      type: "kontrak",
      title: `Dokumen ${KATA} aktif ${tag}`,
      r2Key: `k/${tag}/${suffix}/aktif`,
      fileName: "a.pdf",
      mimeType: "application/pdf",
      bytes: 1,
      sha256: `s${tag}1${suffix}`,
      uploadedById: adminRow.id,
    },
  });
  await db.document.create({
    data: {
      orgId: org.id,
      packageId: pkg.id,
      locationId: locDitugaskan.id,
      phase: "kontrak",
      type: "kontrak",
      title: `Dokumen ${KATA} dibatalkan ${tag}`,
      r2Key: `k/${tag}/${suffix}/batal`,
      fileName: "b.pdf",
      mimeType: "application/pdf",
      bytes: 1,
      sha256: `s${tag}2${suffix}`,
      uploadedById: adminRow.id,
      status: "dibatalkan",
      voidedAt: new Date(),
      voidedById: adminRow.id,
      voidReason: "salah unggah",
    },
  });

  const sesi = (u: typeof adminRow) => ({
    id: u.id,
    orgId: u.orgId,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  });

  return {
    org,
    admin: sesi(adminRow),
    sm: sesi(smRow),
    mandor: sesi(mandorRow),
    vendorId: vendor.id,
    packageId: pkg.id,
    locDitugaskan: locDitugaskan.slug,
    locLain: locLain.slug,
    dokAktifId: dokAktif.id,
  };
}

let A: Awaited<ReturnType<typeof buatOrg>>;
let B: Awaited<ReturnType<typeof buatOrg>>;

const idsPer = (hits: Awaited<ReturnType<typeof searchGlobal>>, kind: string) =>
  hits.filter((h) => h.kind === kind).map((h) => h.id);

beforeAll(async () => {
  A = await buatOrg("a");
  B = await buatOrg("b");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("KASUS INTI: hasil disaring scope, bukan hanya kata kunci", () => {
  it("super_admin org A tidak melihat SATU PUN objek org B", async () => {
    const hits = await searchGlobal(A.admin as Sesi, KATA);
    expect(hits.length).toBeGreaterThan(0);

    expect(idsPer(hits, "paket")).toEqual([A.packageId]);
    expect(idsPer(hits, "vendor")).toEqual([A.vendorId]);
    expect(idsPer(hits, "lokasi").sort()).toEqual([A.locDitugaskan, A.locLain].sort());

    // Tidak ada satu pun id milik B, dari jenis apa pun.
    const idB = new Set([B.packageId, B.vendorId, B.locDitugaskan, B.locLain, B.dokAktifId]);
    expect(hits.filter((h) => idB.has(h.id))).toEqual([]);
  });

  it("site_manager hanya melihat lokasi yang DITUGASKAN, bukan lokasi tetangga sepaket", async () => {
    const hits = await searchGlobal(A.sm as Sesi, KATA);
    expect(idsPer(hits, "lokasi")).toEqual([A.locDitugaskan]);
    expect(idsPer(hits, "lokasi")).not.toContain(A.locLain);
  });

  it("dokumen yang DIBATALKAN tidak muncul (DECISIONS 183)", async () => {
    const hits = await searchGlobal(A.admin as Sesi, KATA);
    const judul = hits.filter((h) => h.kind === "dokumen").map((h) => h.label);
    expect(judul).toContain(`Dokumen ${KATA} aktif a`);
    expect(judul.some((j) => j.includes("dibatalkan"))).toBe(false);
  });
});

describe("capability menentukan JENIS apa yang boleh muncul", () => {
  it("mandor tidak melihat vendor, pengguna, maupun paket", async () => {
    const hits = await searchGlobal(A.mandor as Sesi, KATA);
    expect(idsPer(hits, "vendor")).toEqual([]);
    expect(idsPer(hits, "pengguna")).toEqual([]);
    expect(idsPer(hits, "paket")).toEqual([]);
    // Tetap bisa menemukan lokasi tugasnya — pencarian tidak jadi mati total.
    expect(idsPer(hits, "lokasi")).toEqual([A.locDitugaskan]);
  });

  it("super_admin melihat pengguna organisasinya sendiri saja", async () => {
    const hits = await searchGlobal(A.admin as Sesi, KATA);
    const nama = hits.filter((h) => h.kind === "pengguna").map((h) => h.label);
    expect(nama).toContain(`Admin ${KATA} a`);
    expect(nama).not.toContain(`Admin ${KATA} b`);
  });
});

describe("kueri terlalu pendek tidak menarik apa pun", () => {
  it.each(["", " ", "z".repeat(MIN_QUERY - 1)])("%p → nol hasil", async (q) => {
    expect(await searchGlobal(A.admin as Sesi, q)).toEqual([]);
  });
});

describe("bentuk hasil bisa langsung dipakai navigasi", () => {
  it("setiap hasil punya href yang menunjuk ke halaman objeknya", async () => {
    const hits = await searchGlobal(A.admin as Sesi, KATA);
    for (const h of hits) expect(h.href.startsWith("/")).toBe(true);
    expect(hits.find((h) => h.kind === "paket")?.href).toBe(`/paket/${A.packageId}`);
    expect(hits.find((h) => h.kind === "lokasi")?.href).toMatch(/^\/lokasi\//);
    expect(hits.find((h) => h.kind === "dokumen")?.href).toBe(`/dokumen/${A.dokAktifId}`);
  });

  it("jenis objek pekerjaan tampil sebelum data referensi", async () => {
    const urut = (await searchGlobal(A.admin as Sesi, KATA)).map((h) => h.kind);
    const posisi = (k: string) => urut.findIndex((x) => x === k);
    expect(posisi("paket")).toBeLessThan(posisi("vendor"));
    expect(posisi("lokasi")).toBeLessThan(posisi("pengguna"));
  });
});
