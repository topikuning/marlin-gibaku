// Peran Wakil PPK — wakil pemberi kerja: VERIFIKATOR (DECISIONS 426,
// menggantikan sebagian DECISIONS 199 yang membuatnya baca saja).
//
// Prompt user 2026-08-24 meminta workspace Wakil PPK dengan inspeksi,
// verifikasi laporan & evidence, temuan, dan klarifikasi. Yang TIDAK berubah
// dari 199: tanpa `ai.*`, tanpa `finance.*`, tanpa satu pun capability yang
// mengubah data PELAKSANA, dan tetap sesuai penugasan lokasi.
//
// Dikunci di sini karena semuanya gagal DIAM-DIAM: capability yang kelebihan
// tidak bikin error, cuma memberi wewenang yang tidak dimaksudkan.
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

describe("Wakil PPK: verifikator dalam lingkup penugasan", () => {
  it("terdaftar sebagai peran dengan label Indonesia", () => {
    expect(ALL_ROLES).toContain("wakil_ppk");
    expect(ROLE_LABEL.wakil_ppk).toBe("Wakil PPK");
  });

  it("capability TULIS-nya HANYA domain verifikasi (whitelist eksplisit)", () => {
    // DECISIONS 426: yang boleh ia tulis hanyalah domain pemeriksaan —
    // temuan (buat + verifikasi penutupan), inspeksi, dan verifikasi eksternal
    // laporan harian. Whitelist ini SENGAJA eksplisit: capability baru yang
    // tak sengaja diberikan ke peran ini membuat tes gagal tanpa diperbarui.
    const BOLEH_TULIS = new Set(["finding.create", "finding.verify", "inspection.manage", "report.verify_external"]);
    const menulis = [...KAP].filter((c) => !c.endsWith(".view") && c !== "report.export");
    expect([...menulis].sort()).toEqual([...BOLEH_TULIS].sort());
  });

  it("TIDAK menindaklanjuti temuannya sendiri (pemisahan tugas)", () => {
    // Pemeriksa bukan penindak: tindak lanjut + jawab klarifikasi milik
    // pihak pelaksana. Sebaliknya pihak pelaksana (SM/PM/AM) tidak
    // memverifikasi penutupan — diuji di bawah.
    expect(can("wakil_ppk", "finding.respond")).toBe(false);
  });

  it("pihak pelaksana TIDAK bisa memverifikasi penutupan temuan", () => {
    for (const r of ["site_manager", "project_manager", "regional_manager", "field_supervisor"] as const) {
      expect(can(r, "finding.verify"), r).toBe(false);
      expect(can(r, "report.verify_external"), r).toBe(false);
      expect(can(r, "inspection.manage"), r).toBe(false);
    }
  });

  it("TIDAK menyentuh data pelaksana: laporan, RAB, dokumen, kendala", () => {
    for (const c of [
      "daily_report.create",
      "daily_report.review",
      "daily_report.finalize",
      "rab.manage",
      "baseline.manage",
      "document.upload",
      "document.verify",
      "issue.manage",
      "user.create",
    ] as const) {
      expect(can("wakil_ppk", c), c).toBe(false);
    }
  });

  it("TANPA AI Intelligence sama sekali", () => {
    const ai = CAPABILITIES.filter((c) => c.startsWith("ai."));
    expect(ai.length).toBeGreaterThan(0);
    for (const c of ai) expect(can("wakil_ppk", c)).toBe(false);
  });

  it("TANPA Keuangan – uang internal pelaksana bukan urusan pemberi kerja", () => {
    expect(can("wakil_ppk", "finance.view")).toBe(false);
  });

  it("tetap bisa melihat yang perlu: lokasi, RAB, progres, dokumen, paket", () => {
    for (const c of ["location.view", "rab.view", "progress.view", "document.view", "package.view"] as const) {
      expect(can("wakil_ppk", c)).toBe(true);
    }
  });

  it("SESUAI PENUGASAN – bukan lintas lokasi", () => {
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
