// RAPL PUNYA PINTUNYA SENDIRI, BUKAN MENUMPANG DI `finance.*`.
//
// Kejadian 2026-08-29: RAPL-07 memindahkan harga/biaya/margin RAPL ke belakang
// `finance.view` dan pengisian HSD ke `finance.input`. Alasannya benar (margin
// internal tidak boleh terbuka untuk wakil_ppk), pintunya yang salah:
// `finance.*` sedang DITAHAN untuk semua peran kecuali super_admin karena menu
// Keuangan belum siap. Akibatnya penahanan satu menu diam-diam mematikan fitur
// di menu lain — Project Manager berhenti melihat biaya RAPL dan Site Manager
// berhenti bisa mengisi harga satuan, padahal keduanya tidak pernah diminta
// dibatasi.
//
// Koreksi user: *"maksudnya tab keuangan, yang mana itu masih mentah. bukan
// membatasi fitur-fitur keuangan yang berhubungan dengan menu lain"*.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { can, ROLE_CAPABILITIES } from "@/lib/authz";

describe("kapabilitas RAPL", () => {
  it("melihat uang RAPL mulai Project Manager, bukan super_admin saja", () => {
    for (const role of ["project_manager", "regional_manager", "program_director", "super_admin"] as const) {
      expect(can(role, "rapl.view"), `${role} harus bisa melihat biaya & margin RAPL`).toBe(true);
    }
    // Peran baca tingkat eksekutif ikut melihat: margin justru angka yang
    // paling dicarinya.
    expect(can("exec_viewer", "rapl.view")).toBe(true);
  });

  it("mengisi harga RAPL mulai Site Manager – yang paling tahu harga lapangan", () => {
    expect(can("site_manager", "rapl.manage")).toBe(true);
    expect(can("project_manager", "rapl.manage")).toBe(true);
  });

  it("Site Manager mengisi TANPA melihat marginnya", () => {
    // Pilihan user 2026-08-29: margin adalah angka menawar dan berhenti di
    // kantor. Bukan kelalaian – kalau kelak dibuka, uji ini yang harus diubah
    // lebih dulu.
    expect(can("site_manager", "rapl.view")).toBe(false);
  });

  it("pelaksana lapangan dan wakil pemberi kerja tidak menyentuh keduanya", () => {
    for (const role of ["field_supervisor", "wakil_ppk"] as const) {
      expect(can(role, "rapl.view"), `${role} tidak boleh melihat margin internal`).toBe(false);
      expect(can(role, "rapl.manage"), `${role} tidak boleh mengisi harga`).toBe(false);
    }
    // Yang TETAP terbuka untuk mereka: kebutuhan volume bahan/upah/alat.
    expect(can("field_supervisor", "rab.view")).toBe(true);
    expect(can("wakil_ppk", "rab.view")).toBe(true);
  });

  it("penahanan menu Keuangan TIDAK ikut mematikan RAPL", () => {
    // Inti perkaranya dalam satu baris: peran yang sengaja tidak punya
    // `finance.*` tetap bekerja penuh di RAPL.
    for (const role of ["project_manager", "regional_manager", "program_director"] as const) {
      expect(can(role, "finance.view"), `prasyarat: ${role} memang sedang ditahan finance.*`).toBe(
        false,
      );
      expect(can(role, "rapl.view")).toBe(true);
      expect(can(role, "rapl.manage")).toBe(true);
    }
  });

  /**
   * Penjaga terhadap kambuhnya sebab, bukan cuma gejalanya: selama tidak ada
   * satu pun `finance.*` di berkas RAPL/HSD, membuka atau menutup menu Keuangan
   * tidak bisa lagi menggeser siapa yang boleh memakai RAPL.
   */
  it("tidak ada berkas RAPL/HSD yang menuntut `finance.*`", () => {
    const berkas = [
      "src/app/(app)/lokasi/[slug]/rapl/page.tsx",
      "src/app/(app)/lokasi/[slug]/rapl/kebutuhan/route.ts",
      "src/app/cetak/rapl/[slug]/page.tsx",
      "src/lib/ahsp/hsd-actions.ts",
      "src/lib/ahsp/rincian-actions.ts",
    ];
    const menumpang = berkas.filter((b) =>
      /"finance\.(view|input|approve)"/.test(readFileSync(join(process.cwd(), b), "utf8")),
    );
    expect(
      menumpang,
      "RAPL harus memakai rapl.view/rapl.manage – finance.* adalah pintu menu Keuangan",
    ).toEqual([]);
  });

  it("wakil_ppk tetap bersih dari seluruh capability uang", () => {
    const punya = [...ROLE_CAPABILITIES.wakil_ppk].filter(
      (c) => c.startsWith("finance.") || c.startsWith("rapl."),
    );
    expect(punya).toEqual([]);
  });
});
