// Peran Wakil PPK — wakil pemberi kerja, BACA SAJA (DECISIONS 199).
//
// Permintaan user 2026-08-01: "tanpa fitur ai intelegence. hanya bisa view
// saja, tanpa bisa edit sedikitpun. sesuai penugasan juga."
//
// Ketiganya dikunci di sini karena semuanya gagal DIAM-DIAM: capability yang
// kelebihan tidak bikin error, cuma memberi wewenang yang tidak dimaksudkan.
import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  CAPABILITIES,
  CROSS_LOCATION_ROLES,
  ROLE_CAPABILITIES,
  ROLE_LABEL,
  can,
  creatableRoles,
  isCrossLocation,
} from "@/lib/authz";

const KAP = ROLE_CAPABILITIES.wakil_ppk;

describe("Wakil PPK: hanya melihat", () => {
  it("terdaftar sebagai peran dengan label Indonesia", () => {
    expect(ALL_ROLES).toContain("wakil_ppk");
    expect(ROLE_LABEL.wakil_ppk).toBe("Wakil PPK");
  });

  it("TIDAK punya satu pun capability yang mengubah data", () => {
    // Semua capability selain yang berakhiran .view / .export mengubah sesuatu
    // atau membuka fitur non-baca. Aturan ini otomatis mencakup capability
    // BARU: begitu ada yang ditambahkan dan tak sengaja diberikan ke peran ini,
    // tes gagal tanpa perlu diperbarui.
    const menulis = [...KAP].filter((c) => !c.endsWith(".view") && c !== "report.export");
    expect(menulis).toEqual([]);
  });

  it("TANPA AI Intelligence sama sekali", () => {
    const ai = CAPABILITIES.filter((c) => c.startsWith("ai."));
    expect(ai.length).toBeGreaterThan(0);
    for (const c of ai) expect(can("wakil_ppk", c)).toBe(false);
  });

  it("TANPA Keuangan — uang internal pelaksana bukan urusan pemberi kerja", () => {
    expect(can("wakil_ppk", "finance.view")).toBe(false);
  });

  it("tetap bisa melihat yang perlu: lokasi, RAB, progres, dokumen, paket", () => {
    for (const c of ["location.view", "rab.view", "progress.view", "document.view", "package.view"] as const) {
      expect(can("wakil_ppk", c)).toBe(true);
    }
  });

  it("SESUAI PENUGASAN — bukan lintas lokasi", () => {
    expect(isCrossLocation("wakil_ppk")).toBe(false);
    expect(CROSS_LOCATION_ROLES.has("wakil_ppk")).toBe(false);
  });

  it("tidak bisa membuat akun apa pun", () => {
    expect(can("wakil_ppk", "user.create")).toBe(false);
    expect(creatableRoles("wakil_ppk")).toEqual([]);
  });

  it("tidak bisa mengelola pengguna maupun sistem", () => {
    expect(can("wakil_ppk", "user.manage")).toBe(false);
    expect(can("wakil_ppk", "system.manage")).toBe(false);
    expect(can("wakil_ppk", "audit.view")).toBe(false);
  });
});

describe("izin foto baru: perbaikan cap & hapus arsip (DECISIONS 198)", () => {
  it("hanya Super Admin & Program Director", () => {
    for (const cap of ["photo.restamp", "photo.archive_purge"] as const) {
      const punya = ALL_ROLES.filter((r) => can(r, cap));
      expect(punya.sort()).toEqual(["program_director", "super_admin"]);
    }
  });

  it("peran lapangan tidak bisa menulis ulang bukti", () => {
    for (const r of ["site_manager", "field_supervisor", "project_manager", "exec_viewer"] as const) {
      expect(can(r, "photo.restamp")).toBe(false);
      expect(can(r, "photo.archive_purge")).toBe(false);
    }
  });
});
