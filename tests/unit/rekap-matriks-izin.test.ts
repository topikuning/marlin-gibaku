import { describe, expect, it } from "vitest";
import { izinImpor } from "@/lib/daily-report/rekap-matriks/izin";

/**
 * Hak impor rekap harian atas laporan terkirim/final (DECISIONS 784). Ketetapan
 * user 2026-11-25: *"mode timpa ini menimpa semuanya, jangan ditahan meskipun
 * laporan hari itu final"*.
 */
describe("izinImpor", () => {
  it("Site Manager ke atas menulis laporan terkirim DAN final", () => {
    for (const r of ["site_manager", "project_manager", "regional_manager", "program_director", "super_admin"] as const) {
      expect(izinImpor(r)).toEqual({ ubahTerkirim: true, ubahFinal: true });
    }
  });
  it("pelaksana dan peran baca tidak", () => {
    for (const r of ["field_supervisor", "exec_viewer", "wakil_ppk"] as const) {
      expect(izinImpor(r)).toEqual({ ubahTerkirim: false, ubahFinal: false });
    }
  });
});
