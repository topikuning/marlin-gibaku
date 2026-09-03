// MODE PERIODE MINGGU: kapabilitasnya SENDIRI, bukan `contract.edit`.
//
// Permintaan user 2026-09-03: *"project manager diijinkan untuk ubah periode
// minggu laporan."*
//
// Cara termudah memenuhinya salah: memberi PM `contract.edit`. Kapabilitas itu
// memuat nomor kontrak, NILAI KONTRAK, PPN, tanggal TTD, SPMK, dan masa
// pelaksanaan — enam hal yang tidak diminta, salah satunya uang. `authz.ts`
// sendiri menuliskan alasan `contract.edit` ditahan di super_admin.
//
// Berkas ini menjaga pemisahannya tetap ada. Tanpa penjaga, orang berikutnya
// yang membaca "PM boleh ganti mode minggu" akan menyelesaikannya dengan satu
// baris di daftar kapabilitas PM — dan hilangnya pagar itu tidak akan membuat
// satu uji pun merah.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { can, ROLE_CAPABILITIES } from "@/lib/authz";

describe("mode minggu boleh diubah PM, koreksi kontrak tidak", () => {
  it("project manager memegang contract.week_mode", () => {
    expect(can("project_manager", "contract.week_mode")).toBe(true);
  });

  it("project manager TETAP tidak memegang contract.edit", () => {
    // Ini inti pemisahannya. Kalau baris ini merah, PM baru saja mendapat akses
    // mengubah nilai kontrak.
    expect(can("project_manager", "contract.edit")).toBe(false);
  });

  it("area manager mewarisinya, site manager tidak", () => {
    // AM = PM + pengesahan; SM di bawahnya dan tidak mengurus kontrak.
    // Nama enumnya `regional_manager`, labelnya "Area Manager".
    expect(can("regional_manager", "contract.week_mode")).toBe(true);
    expect(can("site_manager", "contract.week_mode")).toBe(false);
  });

  it("super_admin tetap memegang keduanya", () => {
    expect(can("super_admin", "contract.week_mode")).toBe(true);
    expect(can("super_admin", "contract.edit")).toBe(true);
  });

  it("peran lapangan & pembaca tidak kebagian", () => {
    for (const peran of ["field_supervisor", "exec_viewer"] as const) {
      expect(can(peran, "contract.week_mode")).toBe(false);
    }
  });

  it("tidak ada peran yang memegang contract.edit selain yang memang berhak", () => {
    // Penjaga arah sebaliknya: daftar pemegang `contract.edit` tidak boleh
    // melebar diam-diam saat kapabilitas baru ditambahkan di sekitarnya.
    const pemegang = Object.entries(ROLE_CAPABILITIES)
      .filter(([, caps]) => caps.has("contract.edit"))
      .map(([peran]) => peran)
      .sort();
    expect(pemegang).toEqual(["super_admin"]);
  });
});

describe("aksinya memakai kapabilitas yang sempit itu", () => {
  it("ubahModeMingguAction menuntut contract.week_mode, bukan contract.edit", () => {
    // Dibaca dari sumbernya: daftar kapabilitas yang benar tidak ada gunanya
    // kalau aksinya ternyata menuntut yang lain.
    const src = readFileSync("src/lib/package/actions.ts", "utf8");
    const i = src.indexOf("export async function ubahModeMingguAction");
    expect(i).toBeGreaterThan(-1);
    const badan = src.slice(i, i + 600);
    expect(badan).toContain('requireCapability("contract.week_mode")');
    expect(badan).not.toContain('requireCapability("contract.edit")');
  });

  it("medan weekMode tidak lagi ikut form koreksi kontrak", () => {
    // Satu nilai yang bisa diubah dari dua tempat adalah kebingungan yang
    // pernah dikeluhkan user sendiri. Yang dipindah harus BENAR-BENAR pindah.
    const src = readFileSync("src/app/(app)/paket/[id]/kontrak/kontrak-forms.tsx", "utf8");
    const mulai = src.indexOf("export function EditContractForm");
    const akhir = src.indexOf("function SignatoryFields");
    expect(mulai).toBeGreaterThan(-1);
    expect(akhir).toBeGreaterThan(mulai);
    expect(src.slice(mulai, akhir)).not.toContain('name="weekMode"');
  });
});
