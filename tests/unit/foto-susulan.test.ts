import { describe, expect, it } from "vitest";
import { izinHapusFotoLaporan, izinTambahFotoItem } from "@/lib/daily-report/foto-susulan";

/**
 * FOTO SUSULAN (DECISIONS 696) – aturan murni. Pilihan user 2026-10-22:
 * dikirim/disetujui/final, hanya pekerjaan tanpa foto; foto susulan boleh
 * dihapus pengunggahnya, Site Manager, atau Super Admin.
 */
describe("izin menambah foto ke satu pekerjaan", () => {
  it("draft & perlu koreksi: selalu boleh, bukan susulan", () => {
    expect(izinTambahFotoItem("draft", 3)).toEqual({ boleh: true, susulan: false });
    expect(izinTambahFotoItem("perlu_koreksi", 0)).toEqual({ boleh: true, susulan: false });
  });

  it.each(["dikirim", "disetujui", "final"] as const)("%s: pekerjaan tanpa foto boleh, sebagai susulan", (status) => {
    expect(izinTambahFotoItem(status, 0)).toEqual({ boleh: true, susulan: true });
  });

  it.each(["dikirim", "disetujui", "final"] as const)("%s: pekerjaan yang sudah berfoto ditolak", (status) => {
    const r = izinTambahFotoItem(status, 1);
    expect(r.boleh).toBe(false);
    if (!r.boleh) expect(r.pesan).toMatch(/sudah punya foto/);
  });
});

describe("izin menghapus foto laporan", () => {
  const mandor = { id: "m", role: "field_supervisor" as const };
  const lain = { id: "x", role: "field_supervisor" as const };
  const sm = { id: "s", role: "site_manager" as const };
  const pm = { id: "p", role: "project_manager" as const };

  it("foto ASLI laporan yang sudah dikirim: siapa pun ditolak", () => {
    for (const status of ["dikirim", "disetujui", "final"] as const) {
      const r = izinHapusFotoLaporan({ status, susulan: false, pengunggahId: "m", user: sm });
      expect(r.boleh).toBe(false);
      if (!r.boleh) expect(r.pesan).toMatch(/hanya foto susulan/);
    }
  });

  it("foto SUSULAN: pengunggah & Site Manager boleh, orang lain tidak – sama dengan aturan hapus biasa", () => {
    const dasar = { status: "final" as const, susulan: true, pengunggahId: "m" };
    expect(izinHapusFotoLaporan({ ...dasar, user: mandor }).boleh).toBe(true);
    expect(izinHapusFotoLaporan({ ...dasar, user: sm }).boleh).toBe(true);
    expect(izinHapusFotoLaporan({ ...dasar, user: lain }).boleh).toBe(false);
    expect(izinHapusFotoLaporan({ ...dasar, user: pm }).boleh).toBe(false);
  });

  it("pengunggah tidak diketahui tidak pernah dianggap 'miliknya'", () => {
    const r = izinHapusFotoLaporan({ status: "draft", susulan: false, pengunggahId: null, user: lain });
    expect(r.boleh).toBe(false);
  });
});
