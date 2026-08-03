// EMPAT MATA UNTUK AKTIVASI ADENDUM (DECISIONS 234).
//
// Keputusan user 2026-08-03: "pengaktifan adendum harus dua orang, program
// director dan satu orang di level yang ditugaskan bisa AM/SM/PM, bahkan super
// admin pun tidak boleh mengaktifkan sendiri, harus ada program director yang
// juga approve."
//
// Mengaktifkan adendum mengganti RAB kontrak yang berlaku dan me-regenerate
// kurva-S — nilai kontrak, progres, dan termin bergeser sekaligus. Aturan tata
// kelola yang tidak diuji sama saja dengan tidak ada.
import { describe, expect, it } from "vitest";
import {
  bolehMenyetujui,
  nilaiPersetujuan,
  suaraMasihBerlaku,
  PERAN_PENUGASAN,
  type Suara,
} from "@/lib/rab/persetujuan-aturan";
import type { UserRole } from "@/generated/prisma/enums";

const jam = (h: number) => new Date(`2026-08-03T${String(h).padStart(2, "0")}:00:00Z`);
const suara = (userId: string, role: UserRole, h = 10): Suara => ({ userId, role, approvedAt: jam(h) });

describe("KASUS INTI: dua orang, dua jabatan", () => {
  it("PD + Site Manager → lengkap", () => {
    const s = nilaiPersetujuan([suara("pd", "program_director"), suara("sm", "site_manager")]);
    expect(s.lengkap).toBe(true);
    expect(s.kurang).toEqual([]);
  });

  it("PD + Project Manager → lengkap", () => {
    expect(nilaiPersetujuan([suara("pd", "program_director"), suara("pm", "project_manager")]).lengkap).toBe(true);
  });

  it("PD + Area Manager (regional_manager) → lengkap", () => {
    expect(nilaiPersetujuan([suara("pd", "program_director"), suara("am", "regional_manager")]).lengkap).toBe(true);
  });

  it("PD saja → belum boleh", () => {
    const s = nilaiPersetujuan([suara("pd", "program_director")]);
    expect(s.lengkap).toBe(false);
    expect(s.adaDirektur).toBe(true);
    expect(s.kurang.join(" ")).toMatch(/Area Manager/);
  });

  it("AM + PM + SM tanpa PD → tetap belum boleh", () => {
    const s = nilaiPersetujuan([
      suara("am", "regional_manager"),
      suara("pm", "project_manager"),
      suara("sm", "site_manager"),
    ]);
    expect(s.lengkap).toBe(false);
    expect(s.kurang.join(" ")).toMatch(/Program Director/);
  });
});

describe("super admin tidak bisa menggantikan jabatan", () => {
  it("super_admin tidak boleh memberi suara sama sekali", () => {
    expect(bolehMenyetujui("super_admin")).toBe(false);
  });

  it("super_admin + PD → masih kurang kursi penugasan", () => {
    // Walau suaranya entah bagaimana masuk, ia tidak mengisi kursi AM/PM/SM.
    const s = nilaiPersetujuan([suara("sa", "super_admin"), suara("pd", "program_director")]);
    expect(s.lengkap).toBe(false);
    expect(s.adaPenugasan).toBe(false);
  });

  it("dua super_admin tidak memenuhi apa pun", () => {
    const s = nilaiPersetujuan([suara("sa1", "super_admin"), suara("sa2", "super_admin")]);
    expect(s.lengkap).toBe(false);
    expect(s.kurang).toHaveLength(2);
  });

  it("peran lapangan & penonton tidak boleh menyetujui", () => {
    for (const r of ["field_supervisor", "exec_viewer", "wakil_ppk"] as UserRole[]) {
      expect(bolehMenyetujui(r), r).toBe(false);
    }
  });

  it("peran yang boleh: PD + tiga peran penugasan", () => {
    expect(bolehMenyetujui("program_director")).toBe(true);
    for (const r of PERAN_PENUGASAN) expect(bolehMenyetujui(r), r).toBe(true);
  });
});

describe("satu orang tidak bisa mengisi dua kursi", () => {
  it("orang yang sama menyetujui dua kali tetap dihitung satu", () => {
    const s = nilaiPersetujuan([suara("pd", "program_director", 9), suara("pd", "program_director", 11)]);
    expect(s.lengkap).toBe(false);
  });

  it("PD tidak sekaligus mengisi kursi penugasan", () => {
    // Bahkan bila seseorang punya dua topi, satu orang tetap satu tanda tangan.
    const s = nilaiPersetujuan([suara("x", "program_director"), suara("x", "site_manager")]);
    expect(s.lengkap).toBe(false);
  });
});

describe("draft berubah → suara gugur", () => {
  // Menyetujui angka lalu mengubah angkanya adalah cara paling sederhana
  // melumpuhkan aturan empat mata: yang diaktifkan bukan lagi yang disetujui.
  const semua = [suara("pd", "program_director", 10), suara("sm", "site_manager", 11)];

  it("suara sebelum perubahan terakhir tidak dihitung", () => {
    const sah = suaraMasihBerlaku(semua, jam(12));
    expect(sah).toHaveLength(0);
    expect(nilaiPersetujuan(sah).lengkap).toBe(false);
  });

  it("suara sesudah perubahan tetap sah", () => {
    const sah = suaraMasihBerlaku(semua, jam(9));
    expect(sah).toHaveLength(2);
    expect(nilaiPersetujuan(sah).lengkap).toBe(true);
  });

  it("sebagian gugur → aktivasi kembali terkunci", () => {
    // PD menyetujui jam 10, draft diubah jam 10.30, SM menyetujui jam 11.
    const sah = suaraMasihBerlaku(semua, new Date("2026-08-03T10:30:00Z"));
    expect(sah.map((s) => s.userId)).toEqual(["sm"]);
    expect(nilaiPersetujuan(sah).lengkap).toBe(false);
  });

  it("suara tepat pada detik perubahan dianggap sah", () => {
    expect(suaraMasihBerlaku([suara("pd", "program_director", 10)], jam(10))).toHaveLength(1);
  });
});
