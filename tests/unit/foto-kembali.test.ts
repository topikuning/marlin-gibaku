import { describe, expect, it } from "vitest";
import { izinKembalikanFoto, type AsalFotoLaporan } from "@/lib/daily-report/foto-kembali";

/** Kembalikan foto laporan ke Foto Cepat (DECISIONS 791). */
const mandor = { id: "u-mandor", role: "field_supervisor" as const };
const sm = { id: "u-sm", role: "site_manager" as const };
const izin = (asal: AsalFotoLaporan, status: Parameters<typeof izinKembalikanFoto>[0]["status"], o: Partial<Parameters<typeof izinKembalikanFoto>[0]> = {}) =>
  izinKembalikanFoto({ asal, status, pengunggahId: "u-mandor", user: mandor, dipakaiBukti: false, ...o });

describe("izinKembalikanFoto", () => {
  it("laporan FINAL: foto pekerjaan bervolume 0 boleh dikembalikan pengunggahnya – tanpa super admin", () => {
    expect(izin({ jenis: "item", volume: 0 }, "final")).toEqual({ boleh: true, batalkanCatatan: false });
    expect(izin({ jenis: "item", volume: 0.0004 }, "dikirim")).toEqual({ boleh: true, batalkanCatatan: false });
  });

  it("laporan terkirim: foto pekerjaan bervolume tetap menempel (bukti yang sudah diperiksa)", () => {
    const r = izin({ jenis: "item", volume: 2.5 }, "disetujui");
    expect(r.boleh).toBe(false);
    expect(r.boleh ? "" : r.pesan).toMatch(/bervolume 0, foto catatan di luar RAB, dan foto tanpa pekerjaan/);
  });

  it("laporan Draft: foto pekerjaan bervolume juga tidak dilepas diam-diam – volumenya diubah dulu", () => {
    const r = izin({ jenis: "item", volume: 2.5 }, "draft");
    expect(r.boleh).toBe(false);
    expect(r.boleh ? "" : r.pesan).toMatch(/masih menempel.*ubah volume pekerjaan itu jadi 0/);
    expect(izin({ jenis: "item", volume: 0 }, "perlu_koreksi").boleh).toBe(true);
  });

  it("catatan di luar RAB: boleh di status apa pun; foto TERAKHIR membatalkan catatannya", () => {
    expect(izin({ jenis: "luar_rab", status: "tercatat", fotoLain: 2 }, "final")).toEqual({ boleh: true, batalkanCatatan: false });
    expect(izin({ jenis: "luar_rab", status: "tercatat", fotoLain: 0 }, "final")).toEqual({ boleh: true, batalkanCatatan: true });
    expect(izin({ jenis: "luar_rab", status: "dibatalkan", fotoLain: 0 }, "dikirim")).toEqual({ boleh: true, batalkanCatatan: false });
  });

  it("catatan luar RAB yang sudah dipadankan ke RAB: fotonya bukti pekerjaan itu, tetap", () => {
    const r = izin({ jenis: "luar_rab", status: "dipadankan", fotoLain: 3 }, "draft");
    expect(r.boleh).toBe(false);
  });

  it("foto tanpa pekerjaan: boleh di status apa pun", () => {
    for (const s of ["draft", "perlu_koreksi", "dikirim", "disetujui", "final"] as const) {
      expect(izin({ jenis: "yatim" }, s).boleh).toBe(true);
    }
  });

  it("orang lain selain pengunggah: Site Manager dan atasannya (PM, Area Manager, Program Director, Super Admin)", () => {
    const lain = { id: "u-lain", role: "field_supervisor" as const };
    expect(izin({ jenis: "item", volume: 0 }, "final", { user: lain }).boleh).toBe(false);
    expect(izin({ jenis: "item", volume: 0 }, "final", { user: sm }).boleh).toBe(true);
    // Layar user 2026-11-26: Project Manager ditolak mengembalikan foto tanpa pekerjaan (DECISIONS 792).
    for (const role of ["project_manager", "regional_manager", "program_director", "super_admin"] as const) {
      expect([role, izin({ jenis: "yatim" }, "draft", { user: { id: "u-atas", role } }).boleh]).toEqual([role, true]);
    }
    expect(izin({ jenis: "yatim" }, "draft", { user: { id: "u-w", role: "wakil_ppk" } }).boleh).toBe(false);
    // Pengunggah tak diketahui (impor lama) – bukan "milik siapa saja".
    expect(izin({ jenis: "item", volume: 0 }, "final", { pengunggahId: null }).boleh).toBe(false);
  });

  it("foto yang ditautkan ke temuan/inspeksi tetap di laporannya", () => {
    expect(izin({ jenis: "yatim" }, "draft", { dipakaiBukti: true }).boleh).toBe(false);
  });
});
