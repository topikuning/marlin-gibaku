import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  CAPABILITIES,
  ROLE_CAPABILITIES,
  TANGGA_PERAN,
  can,
  hakAksesBerlaku,
  kunciHakAkses,
  pasangPenggantiHakAkses,
  type Capability,
  type PenggantiHakAkses,
} from "@/lib/authz";
import { HakAksesTerkunci, rencanaUbahHakAkses } from "@/lib/hak-akses/rencana";
import { LABEL_KEWENANGAN, kelompokKewenangan } from "@/lib/hak-akses/label";
import { susunPengganti } from "@/lib/hak-akses/susun";
import type { UserRole } from "@/generated/prisma/enums";

/*
 * HAK AKSES PER PERAN YANG DIATUR SUPER ADMIN (DECISIONS 793).
 *
 * Permintaan user 2026-11-26: *"jika ada levelling seperti ini lebih baik ada
 * kontrol langsung di aplikasi yang aku tinggal atur siapa yang boleh dan tidak
 * melalui login super admin"*.
 */

const KOSONG: PenggantiHakAkses = new Map();
const p = (...isi: [UserRole, Capability, boolean][]): PenggantiHakAkses => {
  const m = new Map<UserRole, Map<Capability, boolean>>();
  for (const [r, c, v] of isi) m.set(r, new Map([...(m.get(r) ?? []), [c, v]]));
  return m;
};
/** Terapkan rencana ke peta – seperti aksi menyimpannya. */
const terapkan = (awal: PenggantiHakAkses, role: UserRole, c: Capability, boleh: boolean): PenggantiHakAkses => {
  const r = rencanaUbahHakAkses(awal, role, c, boleh);
  const m = new Map<UserRole, Map<Capability, boolean>>();
  for (const [x, per] of awal) m.set(x, new Map(per));
  for (const b of r.baris) {
    const per = m.get(b.role) ?? new Map<Capability, boolean>();
    if (b.boleh === null) per.delete(c);
    else per.set(c, b.boleh);
    m.set(b.role, per);
  }
  return m;
};

afterEach(() => pasangPenggantiHakAkses(new Map()));

describe("hakAksesBerlaku", () => {
  it("tanpa pengaturan = bawaan program, untuk semua peran dan kewenangan", () => {
    for (const r of ALL_ROLES) for (const c of CAPABILITIES) expect(hakAksesBerlaku(r, c, KOSONG)).toBe(ROLE_CAPABILITIES[r].has(c));
  });

  it("hak yang diberikan ke satu peran ikut berlaku untuk semua atasannya (jenjang)", () => {
    const x = p(["project_manager", "contract.edit", true]);
    expect(hakAksesBerlaku("site_manager", "contract.edit", x)).toBe(false);
    for (const r of ["project_manager", "regional_manager", "program_director"] as const) {
      expect([r, hakAksesBerlaku(r, "contract.edit", x)]).toEqual([r, true]);
    }
  });

  it("sel terkunci selalu bawaan walau tabelnya berisi lain", () => {
    const x = p(["field_supervisor", "money.view", true], ["super_admin", "rab.view", false], ["project_manager", "system.manage", true]);
    expect(hakAksesBerlaku("field_supervisor", "money.view", x)).toBe(false);
    expect(hakAksesBerlaku("super_admin", "rab.view", x)).toBe(true);
    expect(hakAksesBerlaku("project_manager", "system.manage", x)).toBe(false);
  });

  it("baris lama untuk sel terkunci di bawah tidak merembes naik lewat jenjang", () => {
    // Pelaksana-lihat-keuangan terkunci 'tidak'. Kalau barisnya ada di tabel
    // (data lama, atau ditulis tangan), Site Manager tetap tidak ikut mendapatnya.
    const x = p(["field_supervisor", "finance.view", true]);
    expect(hakAksesBerlaku("site_manager", "finance.view", x)).toBe(false);
    expect(hakAksesBerlaku("program_director", "finance.view", x)).toBe(false);
  });

  it("can() memakai pengaturan yang dipasang pemuat", () => {
    expect(can("project_manager", "photo.manage_others")).toBe(true);
    pasangPenggantiHakAkses(terapkan(KOSONG, "project_manager", "photo.manage_others", false));
    expect(can("project_manager", "photo.manage_others")).toBe(false);
    expect(can("regional_manager", "photo.manage_others")).toBe(true);
  });
});

describe("rencanaUbahHakAkses", () => {
  it("mencabut dari Project Manager ikut mencabut dari bawahannya; atasannya tetap", () => {
    const r = rencanaUbahHakAkses(KOSONG, "project_manager", "photo.manage_others", false);
    expect(r.berubah).toEqual([
      { role: "project_manager", dari: true, ke: false },
      { role: "site_manager", dari: true, ke: false },
    ]);
    const hasil = terapkan(KOSONG, "project_manager", "photo.manage_others", false);
    expect(hakAksesBerlaku("regional_manager", "photo.manage_others", hasil)).toBe(true);
  });

  it("memberi lagi hak yang sama dengan bawaan tidak menyimpan baris apa pun", () => {
    const dicabut = terapkan(KOSONG, "site_manager", "photo.manage_others", false);
    const kembali = terapkan(dicabut, "site_manager", "photo.manage_others", true);
    expect(kembali.get("site_manager")?.has("photo.manage_others")).toBe(false);
    expect(hakAksesBerlaku("site_manager", "photo.manage_others", kembali)).toBe(true);
  });

  it("peran di luar tangga (Executive View) hanya mengubah dirinya", () => {
    const r = rencanaUbahHakAkses(KOSONG, "exec_viewer", "finding.create", true);
    expect(r.berubah).toEqual([{ role: "exec_viewer", dari: false, ke: true }]);
  });

  it("sel terkunci ditolak dengan alasannya", () => {
    expect(() => rencanaUbahHakAkses(KOSONG, "field_supervisor", "money.view", true)).toThrow(HakAksesTerkunci);
    expect(() => rencanaUbahHakAkses(KOSONG, "super_admin", "audit.view", false)).toThrow(/Super Admin selalu memegang semua hak/);
  });

  it("jenjang tetap utuh sesudah perubahan apa pun: atasan ⊇ bawahan", () => {
    let m: PenggantiHakAkses = KOSONG;
    m = terapkan(m, "site_manager", "contract.edit", true);
    m = terapkan(m, "project_manager", "rab.manage", false);
    m = terapkan(m, "field_supervisor", "weekly_plan.manage", true);
    for (const c of CAPABILITIES) {
      for (let i = 1; i < TANGGA_PERAN.length; i++) {
        const bawah = TANGGA_PERAN[i - 1];
        const atas = TANGGA_PERAN[i];
        if (hakAksesBerlaku(bawah, c, m)) expect([c, atas, hakAksesBerlaku(atas, c, m)]).toEqual([c, atas, true]);
      }
    }
  });
});

describe("layar pengaturan", () => {
  it("setiap kewenangan punya nama dan kelompok (tidak ada yang jatuh ke 'Lainnya')", () => {
    for (const c of CAPABILITIES) {
      expect(LABEL_KEWENANGAN[c]?.length, c).toBeGreaterThan(3);
      expect([c, kelompokKewenangan(c)]).not.toEqual([c, "Lainnya"]);
    }
  });

  it("baris tabel dengan kewenangan yang sudah tidak ada di program dilewati", () => {
    const m = susunPengganti([
      { role: "project_manager", capability: "photo.manage_others", boleh: false },
      { role: "project_manager", capability: "sudah.dihapus", boleh: true },
    ]);
    expect([...(m.get("project_manager") ?? new Map()).keys()]).toEqual(["photo.manage_others"]);
  });

  it("yang dikunci hanya pengaman sistem dan ketetapan tertulis", () => {
    expect(kunciHakAkses("project_manager", "photo.manage_others")).toBeNull();
    expect(kunciHakAkses("wakil_ppk", "ai.ask")).toMatch(/Wakil PPK/);
  });
});

describe("pengaturan dimuat sebelum can() dipakai", () => {
  // Di uji, sesi dipalsukan – jadi jalur pemuatnya dijaga dari teks sumbernya.
  // Tanpa ini pengaturan Super Admin hanya berlaku di proses yang menyimpannya.
  const baca = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  it("getCurrentUser memuat pengaturan lebih dulu", () => {
    const s = baca("src/lib/auth/session.ts");
    const awal = s.indexOf("export const getCurrentUser");
    expect(s.indexOf("await pastikanHakAkses();", awal)).toBeGreaterThan(awal);
    expect(s.indexOf("await pastikanHakAkses();", awal)).toBeLessThan(s.indexOf("await cookies()", awal));
  });
  it("webhook WhatsApp (tanpa sesi) juga memuatnya", () => {
    const s = baca("src/app/api/waha/webhook/route.ts");
    const awal = s.indexOf("export async function POST");
    expect(s.indexOf("await pastikanHakAkses();", awal)).toBeGreaterThan(awal);
  });
});
