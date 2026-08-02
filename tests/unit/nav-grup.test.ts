// Navigasi enam grup (PRD MARLIN §3.2–3.3, DECISIONS 222).
//
// Uji ini menjaga hal-hal yang GAMPANG rusak diam-diam saat menu dikelompokkan
// ulang: menu yang hilang tanpa pengganti, judul grup yang menggantung tanpa
// isi, satu tujuan yang muncul di dua grup, dan penyorotan menu aktif yang
// menyala berbarengan karena URL-nya bersarang.
import { describe, expect, it } from "vitest";
import {
  filterNav,
  flattenNav,
  matchActiveHref,
  MOBILE_NAV,
  NAV_GROUPS,
} from "@/components/shell/nav-config";
import { can } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

const SEMUA_ROLE: UserRole[] = [
  "super_admin",
  "program_director",
  "regional_manager",
  "project_manager",
  "site_manager",
  "field_supervisor",
  "exec_viewer",
  "wakil_ppk",
];

/**
 * Menu yang ADA sebelum pengelompokan (daftar datar lama). Tidak boleh ada yang
 * hilang — pengelompokan menata ulang, bukan memangkas. `/master` sendiri tidak
 * ikut: ia cuma dispatcher yang mengalihkan ke tab pertama, dan sekarang setiap
 * tabnya jadi menu tersendiri.
 */
const TUJUAN_LAMA = [
  "/",
  "/paket",
  "/lokasi",
  "/peta",
  "/hari-ini",
  "/foto",
  "/ai",
  "/progress",
  "/keuangan",
  "/dokumen",
  "/laporan",
  "/chat-grup",
  "/master/perusahaan",
  "/master/kontak",
  "/master/pengguna",
  "/sistem",
];

describe("KASUS INTI: enam grup, tidak ada menu yang hilang", () => {
  it("tepat enam grup tingkat atas", () => {
    expect(NAV_GROUPS).toHaveLength(6);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      "Beranda",
      "Proyek",
      "Pelaksanaan",
      "Pengendalian",
      "Dokumen & Laporan",
      "Administrasi",
    ]);
  });

  it("setiap tujuan menu lama masih punya rumah", () => {
    const tujuan = new Set(flattenNav(NAV_GROUPS).map((i) => i.href));
    const hilang = TUJUAN_LAMA.filter((href) => !tujuan.has(href));
    expect(hilang).toEqual([]);
  });

  it("nama daun = nama halaman tujuannya, bukan nama karangan baru", () => {
    // Dipatok supaya penggantian nama jadi keputusan sadar, bukan efek samping.
    // Menu "Insight & AI" yang mendarat di halaman berjudul "AI Intelligence"
    // adalah ketidaksinambungan yang justru dikeluhkan PRD.
    expect(flattenNav(NAV_GROUPS).map((i) => i.label)).toEqual([
      "Beranda",
      "Paket",
      "Lokasi",
      "Peta",
      "Hari Ini",
      "Foto Lapangan",
      "Progress",
      "Keuangan",
      "AI Intelligence",
      "Dokumen",
      "Laporan",
      "Chat Grup",
      "Perusahaan",
      "Katalog Lokasi",
      "Pengguna",
      "Kontak WA",
      "Sistem",
    ]);
  });

  it("tidak ada nama menu yang kembar", () => {
    const label = flattenNav(NAV_GROUPS).map((i) => i.label);
    expect(label).toHaveLength(new Set(label).size);
  });

  it("tidak ada tujuan yang muncul di dua tempat", () => {
    const hrefs = flattenNav(NAV_GROUPS).map((i) => i.href);
    expect(hrefs).toHaveLength(new Set(hrefs).size);
  });

  it("grup daun hanya Beranda; sisanya punya sub-menu", () => {
    for (const g of NAV_GROUPS) {
      if (g.href !== undefined) expect(g.items).toHaveLength(0);
      else expect(g.items.length).toBeGreaterThan(0);
    }
    expect(NAV_GROUPS.filter((g) => g.href !== undefined).map((g) => g.label)).toEqual(["Beranda"]);
  });
});

describe("filter capability", () => {
  it.each(SEMUA_ROLE)("%s tidak pernah melihat judul grup tanpa isi", (role) => {
    for (const g of filterNav(role)) {
      if (g.href === undefined) expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it.each(SEMUA_ROLE)("%s selalu punya Beranda", (role) => {
    expect(flattenNav(filterNav(role)).map((i) => i.href)).toContain("/");
  });

  it.each(SEMUA_ROLE)("%s tidak melihat menu di luar capability-nya", (role) => {
    for (const g of NAV_GROUPS) {
      const terlihat = new Set(
        filterNav(role)
          .find((x) => x.label === g.label)
          ?.items.map((i) => i.href) ?? [],
      );
      for (const item of g.items) {
        const boleh = item.anyCapability
          ? item.anyCapability.some((c) => can(role, c))
          : !item.capability || can(role, item.capability);
        expect(terlihat.has(item.href)).toBe(boleh);
      }
    }
  });

  it("pelaksana lapangan tidak melihat grup Administrasi", () => {
    const grup = filterNav("field_supervisor").map((g) => g.label);
    expect(grup).not.toContain("Administrasi");
    expect(grup).toContain("Pelaksanaan");
  });

  it("super_admin melihat keenam grup", () => {
    expect(filterNav("super_admin")).toHaveLength(6);
  });

  it("pintasan mobile hanya berisi tujuan yang boleh dibuka role itu", () => {
    for (const role of SEMUA_ROLE) {
      const boleh = new Set(flattenNav(filterNav(role)).map((i) => i.href));
      for (const item of MOBILE_NAV(role)) expect(boleh.has(item.href)).toBe(true);
    }
  });
});

describe("menu aktif: kecocokan terpanjang yang menang", () => {
  const hrefs = flattenNav(NAV_GROUPS).map((i) => i.href);

  it("/paket/katalog menyalakan Katalog Lokasi, bukan Paket", () => {
    expect(matchActiveHref("/paket/katalog", hrefs)).toBe("/paket/katalog");
  });

  it("halaman anak tetap menyalakan menu induknya", () => {
    expect(matchActiveHref("/paket/abc123/kontrak", hrefs)).toBe("/paket");
    expect(matchActiveHref("/lokasi/tengket/harian/2026-07-01", hrefs)).toBe("/lokasi");
    expect(matchActiveHref("/ai/reports", hrefs)).toBe("/ai");
  });

  it("Beranda hanya menyala di / persis, bukan di setiap halaman", () => {
    expect(matchActiveHref("/", hrefs)).toBe("/");
    expect(matchActiveHref("/progress", hrefs)).toBe("/progress");
  });

  it("halaman tanpa menu induk tidak memaksa satu menu menyala", () => {
    expect(matchActiveHref("/ganti-password", hrefs)).toBeNull();
  });
});
