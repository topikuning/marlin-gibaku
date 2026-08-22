import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  can,
  canCreateRole,
  creatableRoles,
  isCrossLocation,
  ALL_ROLES,
  ROLE_CAPABILITIES,
} from "@/lib/authz";

describe("authz capability matrix", () => {
  it("super_admin punya SEMUA capability", () => {
    for (const cap of CAPABILITIES) {
      expect(can("super_admin", cap)).toBe(true);
    }
  });

  it("field_supervisor hanya view + lapor harian + kegiatan + foto cepat", () => {
    // Daftarnya SENGAJA lengkap, bukan "minimal berisi": role paling bawah adalah
    // tempat kebocoran hak paling mahal, jadi setiap penambahan harus dituliskan
    // di sini secara sadar — bukan lolos karena ujinya cuma memeriksa sebagian.
    const expected = new Set([
      "location.view",
      "rab.view",
      "progress.view",
      "document.view",
      "daily_report.create",
      "field_activity.manage",
      // Foto Cepat (DECISIONS 253). Dipisah dari daily_report.create karena
      // justru gunanya memotret TANPA harus punya laporan lebih dulu.
      "photo.quick",
    ]);
    for (const cap of CAPABILITIES) {
      expect(can("field_supervisor", cap), cap).toBe(expected.has(cap));
    }
  });

  it("program_director TIDAK punya kapabilitas khusus super_admin, sisanya punya", () => {
    // Kapabilitas yang sengaja dikunci super_admin saja.
    const HANYA_SUPER_ADMIN = [
      "system.manage",
      "contract.edit", // koreksi kontrak
      "wa.configure", // set grup WA (sementara)
      "daily_report.unfinalize", // buka kunci laporan final (DECISIONS 149)
      "contact.view_all", // lihat kontak akun lain (DECISIONS 150)
      "document.delete", // hapus permanen dokumen (DECISIONS 183) — batalkan cukup
      "location.correct", // koreksi susunan lokasi paket berkontrak (DECISIONS 187)
      // Tautan KELUAR ke folder Drive vendor ("Lihat di Drive", DECISIONS 406).
      // Di seberang tautan itu tidak ada lagi pembatasan lokasi milik MARLIN.
      "gdrive.open_folder",
    ] as const;
    for (const cap of HANYA_SUPER_ADMIN) expect(can("program_director", cap), cap).toBe(false);
    for (const cap of CAPABILITIES) {
      if ((HANYA_SUPER_ADMIN as readonly string[]).includes(cap)) continue;
      expect(can("program_director", cap), cap).toBe(true);
    }
  });

  it("wa.configure hanya super_admin (sementara)", () => {
    expect(can("super_admin", "wa.configure")).toBe(true);
    for (const role of ["program_director", "regional_manager", "project_manager", "site_manager", "field_supervisor", "exec_viewer"] as const) {
      expect(can(role, "wa.configure"), role).toBe(false);
    }
  });

  it("contract.edit hanya super_admin", () => {
    expect(can("super_admin", "contract.edit")).toBe(true);
    for (const role of ["program_director", "regional_manager", "project_manager", "site_manager", "field_supervisor", "exec_viewer"] as const) {
      expect(can(role, "contract.edit"), role).toBe(false);
    }
  });

  it("exec_viewer tidak bisa finance.input (hanya lihat)", () => {
    expect(can("exec_viewer", "finance.input")).toBe(false);
    expect(can("exec_viewer", "finance.view")).toBe(true);
    expect(can("exec_viewer", "daily_report.create")).toBe(false);
  });

  /**
   * KURVA-S: siapa yang boleh mengubah baseline (DECISIONS 353).
   *
   * Keputusan user 2026-08-17. Sebelumnya Site Manager memegang `rab.manage`
   * (DECISIONS 302) — boleh mengubah BOBOT, bahan baku kurvanya — tapi tidak
   * boleh menyentuh jadwalnya, padahal SM pula yang ditanya ketika realisasi
   * menyimpang dari rencana.
   */
  it("baseline.manage: Site Manager ke atas, Pelaksana TIDAK", () => {
    // Daftarnya lengkap dan eksplisit, bukan "minimal berisi": kurva-S adalah
    // dasar seluruh angka deviasi, jadi setiap perubahan hak di sini harus
    // ditulis sadar — bukan lolos karena ujinya memeriksa sebagian.
    const boleh = new Set(["super_admin", "program_director", "regional_manager", "project_manager", "site_manager"]);
    for (const role of ALL_ROLES) {
      expect(can(role, "baseline.manage"), role).toBe(boleh.has(role));
    }
  });

  it("yang TIDAK ikut terbuka bersama baseline.manage", () => {
    /*
     * Batas keputusan itu. Yang dibuka adalah menyusun ulang RENCANA di dalam
     * kontrak yang sudah ditetapkan — bukan mengubah kontraknya, dan bukan
     * menghapus jejak. Kalau salah satu baris ini ikut hijau untuk SM, artinya
     * pelonggaran merembet melewati yang diputuskan.
     */
    expect(can("site_manager", "contract.manage")).toBe(false);
    expect(can("site_manager", "contract.edit")).toBe(false);
    expect(can("site_manager", "amendment.manage")).toBe(false);
    // Kisi mingguan kurva berasal dari tanggal kontrak — tetap terkunci.
    expect(can("project_manager", "contract.manage")).toBe(false);
  });

  it("baseline.manage DIWARISI dari Site Manager, tidak didaftar dua kali", () => {
    /*
     * Peran atasan membangun kapabilitasnya dengan menyebar SITE_MANAGER.
     * Mendaftar ulang hak yang sama di atasnya membuat pencabutan di SM kelak
     * tidak terlihat efeknya di PM — cara matriks izin diam-diam jadi bohong.
     * Diuji lewat perilaku: setiap peran di atas SM harus ikut punya.
     */
    for (const role of ["project_manager", "regional_manager", "program_director", "super_admin"] as const) {
      expect(can(role, "baseline.manage"), role).toBe(true);
    }
  });

  it("matrix terdefinisi untuk semua role", () => {
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      expect(ROLE_CAPABILITIES[role as keyof typeof ROLE_CAPABILITIES].size).toBeGreaterThan(0);
    }
  });

  it("cross-location: super_admin & program_director SAJA", () => {
    expect(isCrossLocation("super_admin")).toBe(true);
    expect(isCrossLocation("program_director")).toBe(true);
    expect(isCrossLocation("site_manager")).toBe(false);
    expect(isCrossLocation("project_manager")).toBe(false);
  });

  it("exec_viewer BUTUH penugasan – bukan lintas lokasi (DECISIONS 190)", () => {
    // Permintaan user 2026-07-31: Executive View tidak boleh otomatis melihat
    // semua lokasi. Tanpa penugasan ia melihat NOL, bukan semuanya.
    expect(isCrossLocation("exec_viewer")).toBe(false);
    // Kapabilitas LIHAT-nya tidak dicabut — yang berubah cuma cakupan lokasi.
    expect(can("exec_viewer", "location.view")).toBe(true);
    expect(can("exec_viewer", "progress.view")).toBe(true);
  });
});

describe("pembuatan user berjenjang (creatableRoles / canCreateRole)", () => {
  it("PM boleh bikin Site Manager & Mandor, bukan PM/atasan", () => {
    expect(creatableRoles("project_manager")).toEqual(["site_manager", "field_supervisor"]);
    expect(canCreateRole("project_manager", "site_manager")).toBe(true);
    expect(canCreateRole("project_manager", "field_supervisor")).toBe(true);
    expect(canCreateRole("project_manager", "project_manager")).toBe(false);
    expect(canCreateRole("project_manager", "super_admin")).toBe(false);
  });

  it("Site Manager hanya boleh bikin Mandor", () => {
    expect(creatableRoles("site_manager")).toEqual(["field_supervisor"]);
    expect(canCreateRole("site_manager", "field_supervisor")).toBe(true);
    expect(canCreateRole("site_manager", "site_manager")).toBe(false);
  });

  it("Mandor & exec tidak boleh bikin user", () => {
    expect(creatableRoles("field_supervisor")).toEqual([]);
    expect(creatableRoles("exec_viewer")).toEqual([]);
    expect(canCreateRole("field_supervisor", "field_supervisor")).toBe(false);
  });

  it("PM & Site Manager punya capability user.create", () => {
    expect(can("project_manager", "user.create")).toBe(true);
    expect(can("site_manager", "user.create")).toBe(true);
    expect(can("field_supervisor", "user.create")).toBe(false);
  });
});
