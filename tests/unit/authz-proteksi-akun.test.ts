import { describe, expect, it } from "vitest";
import { ADMIN_ROLES, ALL_ROLES, can, outranks } from "@/lib/authz";

/**
 * Proteksi akun (DECISIONS 165): admin tidak boleh menyentuh akun setingkat
 * atau lebih tinggi, dan "admin aktif terakhir" tidak boleh dinonaktifkan.
 * Yang diuji di sini bagian MURNI-nya — peringkat peran dan daftar peran admin;
 * penegakannya di `users/actions.ts` butuh database (utang integration test).
 */

describe("outranks (peringkat peran)", () => {
  it("super_admin mengungguli semua peran lain", () => {
    for (const r of ALL_ROLES) {
      if (r === "super_admin") continue;
      expect(outranks("super_admin", r), r).toBe(true);
    }
  });

  it("peran TIDAK mengungguli dirinya sendiri – setingkat pun dilarang", () => {
    for (const r of ALL_ROLES) expect(outranks(r, r), r).toBe(false);
  });

  it("bawahan tidak mengungguli atasan", () => {
    expect(outranks("site_manager", "project_manager")).toBe(false);
    expect(outranks("project_manager", "site_manager")).toBe(true);
    expect(outranks("field_supervisor", "super_admin")).toBe(false);
    expect(outranks("program_director", "super_admin")).toBe(false);
  });

  it("relasi bersifat asimetris untuk semua pasangan berbeda", () => {
    for (const a of ALL_ROLES) {
      for (const b of ALL_ROLES) {
        if (a === b) continue;
        expect(outranks(a, b) && outranks(b, a), `${a} vs ${b}`).toBe(false);
      }
    }
  });
});

describe("ADMIN_ROLES (dasar proteksi admin terakhir)", () => {
  it("berisi persis peran yang punya capability user.manage", () => {
    for (const r of ALL_ROLES) {
      expect(ADMIN_ROLES.includes(r), r).toBe(can(r, "user.manage"));
    }
  });

  it("tidak kosong – kalau kosong, proteksi admin terakhir tidak pernah aktif", () => {
    expect(ADMIN_ROLES.length).toBeGreaterThan(0);
  });

  it("super_admin termasuk admin", () => {
    expect(ADMIN_ROLES).toContain("super_admin");
  });
});
