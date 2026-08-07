// JENJANG PERAN = SUPERSET (DECISIONS 218).
//
// Permintaan user 2026-08-02: "karena jenjang am di atas pm, pm di atas sm, sm
// di atas pelaksana. harusnya semua yang dilakukan di bawahnya bisa dilakukan
// atasnya."
//
// Uji ini menjaga invariannya, bukan mendaftar ulang isinya: mendaftar ulang
// hanya memindahkan kesalahan dari kode ke uji. Sebelum ini Area Manager tidak
// punya SATU PUN kapabilitas laporan harian padahal Site Manager di bawahnya
// bisa membuat, memverifikasi, dan memfinalkan — persis yang ditangkap uji ini.
import { describe, expect, it } from "vitest";
import { ROLE_CAPABILITIES, creatableRoles, type Capability } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

/** Dari yang paling bawah ke paling atas. */
const TANGGA: UserRole[] = [
  "field_supervisor",
  "site_manager",
  "project_manager",
  "regional_manager",
];

const kurang = (atas: UserRole, bawah: UserRole): Capability[] =>
  [...ROLE_CAPABILITIES[bawah]].filter((c) => !ROLE_CAPABILITIES[atas].has(c));

describe("KASUS INTI: atasan memiliki semua kapabilitas bawahannya", () => {
  for (let i = 1; i < TANGGA.length; i++) {
    const bawah = TANGGA[i - 1];
    const atas = TANGGA[i];
    it(`${atas} ⊇ ${bawah}`, () => {
      expect(kurang(atas, bawah), `${atas} kehilangan hak ${bawah}`).toEqual([]);
    });
  }

  it("berlaku transitif — Area Manager juga mencakup Pelaksana", () => {
    expect(kurang("regional_manager", "field_supervisor")).toEqual([]);
  });

  it("Area Manager kini bisa menyentuh laporan harian, seperti bawahannya", () => {
    // Cacat yang memicu keputusan ini: AM tidak punya daily_report.* sama sekali.
    for (const c of ["daily_report.create", "daily_report.review", "daily_report.finalize"] as const) {
      expect(ROLE_CAPABILITIES.regional_manager.has(c), `AM tanpa ${c}`).toBe(true);
    }
  });

  it("atasan tetap punya yang khas dirinya — jenjang bukan sekadar salinan", () => {
    expect(ROLE_CAPABILITIES.regional_manager.has("finance.approve")).toBe(true);
    expect(ROLE_CAPABILITIES.project_manager.has("finance.approve")).toBe(false);
    expect(ROLE_CAPABILITIES.project_manager.has("location.manage")).toBe(true);
    expect(ROLE_CAPABILITIES.site_manager.has("location.manage")).toBe(false);
  });
});

// PENYETUJU ADENDUM HARUS BISA MASUK KE HALAMANNYA (DECISIONS 302).
//
// Pertanyaan user 2026-08-07: "project manager dan site manager kenapa tidak
// ada menu pengajuan adendumnya?"
//
// Yang ditemukan bukan soal menu, tapi janji yang dikunci sendiri:
// `bolehMenyetujui()` menyebut Site Manager sebagai penyetuju yang sah — pesan
// galatnya bahkan menuliskannya — sedangkan tombol setujunya ada di
// `/lokasi/[slug]/rab/adendum`, halaman yang dijaga `rab.manage` yang saat itu
// TIDAK dimiliki SM. Paket yang mengandalkan pasangan Program Director + Site
// Manager tidak akan pernah bisa mengaktifkan adendumnya, dan galatnya
// menyesatkan.
//
// Diuji sebagai INVARIAN, bukan daftar peran: siapa pun yang aturannya akui
// sebagai penyetuju wajib bisa membuka halaman tempat menyetujui. Menambah
// peran penyetuju baru tanpa membuka pintunya akan langsung tertangkap di sini.
describe("penyetuju adendum vs pintu halamannya", () => {
  it("setiap peran yang boleh menyetujui juga boleh membuka halaman adendum", async () => {
    const { bolehMenyetujui } = await import("@/lib/rab/persetujuan-aturan");
    const { ALL_ROLES } = await import("@/lib/authz");
    const terkunci = ALL_ROLES.filter(
      (r) => bolehMenyetujui(r) && !ROLE_CAPABILITIES[r].has("rab.manage"),
    );
    expect(terkunci, `peran ini boleh menyetujui tapi tidak bisa masuk: ${terkunci}`).toEqual([]);
  });

  it("bukan berarti semua orang boleh masuk — pagar tetap ada", () => {
    // Batas yang penting: memperbaiki kontradiksi di atas tidak boleh berubah
    // jadi membuka RAB untuk siapa saja.
    expect(ROLE_CAPABILITIES.field_supervisor.has("rab.manage")).toBe(false);
    expect(ROLE_CAPABILITIES.exec_viewer.has("rab.manage")).toBe(false);
    expect(ROLE_CAPABILITIES.wakil_ppk.has("rab.manage")).toBe(false);
  });

  it("adendum SISI KONTRAK tetap tertutup — SM & PM bukan penandatangan", () => {
    // `amendment.manage` (nomor CCO, perubahan waktu di halaman Kontrak) TIDAK
    // ikut terbuka. Menyusun draft RAB berbeda dari mengesahkan kontraknya.
    for (const r of ["site_manager", "project_manager", "regional_manager"] as const) {
      expect(ROLE_CAPABILITIES[r].has("amendment.manage"), r).toBe(false);
    }
  });
});

describe("pembuatan akun ikut jenjang yang sama", () => {
  it("AM boleh membuat semua yang boleh dibuat PM, ditambah PM sendiri", () => {
    const am = creatableRoles("regional_manager");
    const pm = creatableRoles("project_manager");
    expect(pm.filter((r) => !am.includes(r))).toEqual([]);
    expect(am).toContain("project_manager");
  });

  it("peran yang boleh membuat akun WAJIB punya user.create", () => {
    for (const role of TANGGA) {
      const bisa = creatableRoles(role).length > 0;
      expect(bisa, `${role}`).toBe(ROLE_CAPABILITIES[role].has("user.create"));
    }
  });
});
