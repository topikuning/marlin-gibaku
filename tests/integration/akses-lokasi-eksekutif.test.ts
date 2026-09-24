/*
 * SIAPA YANG PUNYA LOGIN EKSEKUTIF DI LOKASI INI — hanya Super Admin dan
 * Program Director yang boleh tahu.
 *
 * **Ketetapan user 2026-09-24**:
 *
 *   *"hanya super admin dan PD yang boleh tahu siapa saja yang ditugaskan di
 *   paket itu untuk login eksekutif."*
 *
 * Halaman Pengguna sudah memenuhinya sejak dulu (`user.manage` = Super Admin +
 * Program Director; peran lain hanya melihat akun yang IA buat, dan mereka tak
 * pernah boleh membuat akun Executive View). Yang TIDAK memenuhinya panel
 * "Akses" di halaman lokasi (DECISIONS 571): ia mendaftar semua yang punya
 * akses LENGKAP DENGAN PERANNYA, dan ditampilkan ke siapa pun yang bisa
 * membuka lokasi itu — Site Manager, Pelaksana, Wakil PPK. Yang dibatasi
 * `user.manage` cuma tombol kelolanya, bukan daftarnya.
 *
 * Dan akun Executive View PASTI ada di daftar itu bila ia memang memantau
 * lokasi tersebut: `exec_viewer` sengaja BUKAN peran lintas-lokasi
 * (DECISIONS 190), jadi satu-satunya cara ia melihat lokasi adalah ditugaskan.
 *
 * ### Disaring di SERVER, bukan disembunyikan di layar
 *
 * Baris yang tidak boleh dilihat tidak boleh ikut terkirim ke klien. CLAUDE.md:
 * *"Frontend hanya menyembunyikan menu."*
 *
 * ### Catatannya TETAP, tidak menghitung
 *
 * Panel memberi catatan tetap bahwa akun Executive View tidak ditampilkan —
 * ditulis baik ada maupun tidak ada akunnya. Menyebut JUMLAHnya akan
 * membocorkan justru yang disembunyikan (ada atau tidak ada eksekutif di
 * lokasi ini), sementara diam sama sekali membuat daftar yang kurang terbaca
 * lengkap — bahaya yang sudah disebut doc `akses-lokasi.ts` sendiri.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const { aksesLokasi } = await import("@/lib/users/akses-lokasi");
const { can } = await import("@/lib/authz");

const suffix = `ak${Date.now().toString(36)}`;
let orgId: string;
let locationId: string;
let idEksekutif: string;
let idSiteManager: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AK ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket AK ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi AK",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
      status: "berjalan",
      isActive: true,
    },
  });
  locationId = loc.id;

  const buat = async (username: string, role: string, fullName: string) =>
    (
      await db.user.create({
        data: { orgId, username, fullName, passwordHash: "x", role: role as never },
      })
    ).id;

  idEksekutif = await buat(`exec-${suffix}`, "exec_viewer", "Direktur Eksekutif");
  idSiteManager = await buat(`sm-${suffix}`, "site_manager", "Site Manager Lapangan");
  // Program Director lintas-lokasi: ikut muncul lewat PERAN, bukan penugasan.
  await buat(`pd-${suffix}`, "program_director", "Program Director");

  await db.locationAssignment.createMany({
    data: [
      { userId: idEksekutif, locationId },
      { userId: idSiteManager, locationId },
    ],
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("panel akses lokasi menyembunyikan akun Executive View", () => {
  it("Super Admin / Program Director melihat akun eksekutifnya", async () => {
    const baris = await aksesLokasi(locationId, orgId, { sembunyikanEksekutif: false });
    expect(baris.map((b) => b.userId)).toContain(idEksekutif);
  });

  it("peran lain TIDAK menerima barisnya sama sekali – disaring di server", async () => {
    const baris = await aksesLokasi(locationId, orgId, { sembunyikanEksekutif: true });
    expect(baris.map((b) => b.userId)).not.toContain(idEksekutif);
    // Nama dan perannya pun tidak boleh ikut terkirim dalam bentuk apa pun.
    expect(JSON.stringify(baris)).not.toContain("Direktur Eksekutif");
    expect(JSON.stringify(baris)).not.toContain("Executive View");
  });

  it("yang BUKAN eksekutif tetap tampil seperti biasa", async () => {
    // Batas yang penting ke arah sebaliknya: daftar akses yang terlalu sedikit
    // membuat orang mengira lokasi ini dibuka lebih sedikit orang daripada
    // kenyataannya.
    const baris = await aksesLokasi(locationId, orgId, { sembunyikanEksekutif: true });
    expect(baris.map((b) => b.userId)).toContain(idSiteManager);
    expect(baris.some((b) => b.jalan === "peran")).toBe(true);
  });

  it("bawaannya TIDAK menyembunyikan – pemanggil wajib menyatakan niatnya", async () => {
    // Kalau bawaannya menyembunyikan, pemanggil baru yang lupa akan diam-diam
    // memotong daftar; kalau bawaannya membuka, pemanggil baru yang lupa akan
    // membocorkan. Yang kedua lebih berbahaya — tapi lebih terlihat di uji
    // seperti ini, dan tidak pernah menipu Super Admin dengan daftar separuh.
    const baris = await aksesLokasi(locationId, orgId);
    expect(baris.map((b) => b.userId)).toContain(idEksekutif);
  });

  it("pagarnya persis `user.manage` – Super Admin + Program Director", () => {
    expect(can("super_admin", "user.manage")).toBe(true);
    expect(can("program_director", "user.manage")).toBe(true);
    for (const r of ["regional_manager", "project_manager", "site_manager", "field_supervisor", "wakil_ppk", "exec_viewer"] as const) {
      expect(can(r, "user.manage"), `${r} tidak boleh tahu`).toBe(false);
    }
  });
});
