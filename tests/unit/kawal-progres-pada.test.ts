import { describe, expect, it } from "vitest";
import { progresKawalPada } from "@/lib/kawal/progres-pada";
import { HARI_SESUDAH_H, kodeSurat, tanggalSuratAwal } from "@/lib/penagihan/berkas-termin-aturan";

/** Pembanding Kawal & tanggal awal surat termin (DECISIONS 724). */

describe("progresKawalPada", () => {
  const mulai = new Date("2026-07-01T00:00:00Z");
  const realisasiKumulatif = [1.2, 3.4, 7.9, null];

  it("minggu Kawal = 7 hari sejak mulai penyedia; angkanya realisasi pengawas kumulatif minggu itu", () => {
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-07-01T00:00:00Z") })).toEqual({ mingguKawal: 1, pct: 1.2 });
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-07-07T00:00:00Z") })).toEqual({ mingguKawal: 1, pct: 1.2 });
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-07-08T00:00:00Z") })).toEqual({ mingguKawal: 2, pct: 3.4 });
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-07-20T00:00:00Z") })).toEqual({ mingguKawal: 3, pct: 7.9 });
  });

  it("minggu yang belum dicatat Kawal = null, bukan nol; sebelum mulai atau tanpa tanggal mulai = tidak ada pembanding", () => {
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-07-25T00:00:00Z") })).toEqual({ mingguKawal: 4, pct: null });
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-09-30T00:00:00Z") })?.pct).toBeNull();
    expect(progresKawalPada({ mulai, realisasiKumulatif, tanggal: new Date("2026-06-30T00:00:00Z") })).toBeNull();
    expect(progresKawalPada({ mulai: null, realisasiKumulatif, tanggal: new Date("2026-07-08T00:00:00Z") })).toBeNull();
  });
});

describe("tanggal awal lima surat", () => {
  it("permohonan pemeriksaan H, BA H+1, surat uang H+2 – lewat akhir bulan tetap benar", () => {
    expect(tanggalSuratAwal("permohonan_pemeriksaan", "2026-10-31")).toBe("2026-10-31");
    expect(tanggalSuratAwal("ba_pembahasan_kemajuan", "2026-10-31")).toBe("2026-11-01");
    for (const j of ["permohonan_pembayaran", "invoice", "kwitansi"] as const) {
      expect(tanggalSuratAwal(j, "2026-10-31")).toBe("2026-11-02");
    }
    expect(Object.keys(HARI_SESUDAH_H)).toHaveLength(5);
  });

  it("surat → butir katalog", () => {
    expect(["permohonan_pemeriksaan", "ba_pembahasan_kemajuan", "permohonan_pembayaran", "invoice", "kwitansi"].map((j) => kodeSurat(j as never))).toEqual([
      "9a",
      "9b",
      "10a",
      "10b",
      "10c",
    ]);
  });
});
