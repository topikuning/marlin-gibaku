import { describe, expect, it } from "vitest";
import { ISI_TERMIN, type SimpulFolder } from "@/lib/gdrive/struktur";
import {
  KATALOG_BERKAS_TERMIN,
  LANGKAH_PENAGIHAN,
  butirDariJalur,
  namaButir,
  statusButir,
  statusLangkah,
  type KeadaanBerkas,
  type StatusButir,
} from "@/lib/penagihan/katalog";

/** Katalog berkas termin (DECISIONS 720) – acuan isi folder TERMIN Drive KKP. */

function daunISI(simpul: readonly SimpulFolder[], induk: string[] = []): string[] {
  return simpul.flatMap((s) => (s.anak?.length ? daunISI(s.anak, [...induk, s.nama]) : [[...induk, s.nama].join(" / ")]));
}

describe("katalog berkas termin", () => {
  it("setiap folder daun TERMIN di Drive punya tepat satu butir, dan sebaliknya", () => {
    const daun = daunISI(ISI_TERMIN).sort();
    const katalog = KATALOG_BERKAS_TERMIN.map((b) => b.jalur.join(" / ")).sort();
    expect(katalog).toEqual(daun);
    expect(new Set(KATALOG_BERKAS_TERMIN.map((b) => b.kode)).size).toBe(KATALOG_BERKAS_TERMIN.length);
    expect(KATALOG_BERKAS_TERMIN).toHaveLength(42);
  });

  it("asal berkas: 13 dibuat MARLIN, 10 dokumen paket, 7 dokumen tetap, 12 dari pihak lain", () => {
    const hitung = (s: string) => KATALOG_BERKAS_TERMIN.filter((b) => b.sumber === s).length;
    expect([hitung("marlin"), hitung("paket"), hitung("tetap"), hitung("pihak_lain")]).toEqual([13, 10, 7, 12]);
    // Kelima surat penyedia ada di katalog, masing-masing sekali.
    expect(KATALOG_BERKAS_TERMIN.flatMap((b) => (b.surat ? [b.surat] : [])).sort()).toEqual(
      ["ba_pembahasan_kemajuan", "invoice", "kwitansi", "permohonan_pembayaran", "permohonan_pemeriksaan"].sort(),
    );
    // NIB & NPWP per perusahaan, dokumen tetap lain per kontrak (ketetapan user).
    const perusahaan = KATALOG_BERKAS_TERMIN.filter((b) => b.tetapDi === "perusahaan").map((b) => b.kode);
    expect(perusahaan.sort()).toEqual(["10d", "10h"]);
  });

  it("langkah 0–8 berurutan; tiap butir menunjuk langkah yang ada", () => {
    expect(LANGKAH_PENAGIHAN.map((l) => l.ke)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(KATALOG_BERKAS_TERMIN.every((b) => b.langkah >= 0 && b.langkah <= 8)).toBe(true);
  });

  it("nama terbaca", () => {
    const b = KATALOG_BERKAS_TERMIN.find((x) => x.kode === "9c")!;
    expect(namaButir(b)).toBe("9c. BA Pemeriksaan Hasil Pekerjaan");
  });
});

describe("butirDariJalur – berkas di folder Drive dikenali dari letaknya", () => {
  const akar = ["7. BERKAS TERMIN", "TERMIN 2 (50%) CV. Putera Fahlevi"];
  it("folder baku", () => {
    expect(butirDariJalur([...akar, "9. Pemeriksaan Pekerjaan", "c. BA Pemeriksaan Hasil Pekerjaan"])).toEqual({ terminKe: 2, kode: "9c" });
    expect(butirDariJalur([...akar, "BERKAS DOKUMEN TEKNIS", "19. Laporan Kemajuan Pekerjaan"])).toEqual({ terminKe: 2, kode: "T19" });
    expect(butirDariJalur(["7. BERKAS TERMIN", "TERMIN 1 (25%) CV. X", "5. Kurva S"])).toEqual({ terminKe: 1, kode: "5" });
  });
  it("ejaan buatan orang dan nama lama tetap dikenali", () => {
    expect(butirDariJalur([...akar, "9. PEMERIKSAAN PEKERJAAN", "c.BA Pemeriksaan Hasil Pekerjaan"])).toEqual({ terminKe: 2, kode: "9c" });
    // Termin berikutnya di Drive KKP menyatukan f & g jadi "f. BA Pembayaran".
    expect(butirDariJalur([...akar, "10. Pembayaran", "f. BA Pembayaran"])).toEqual({ terminKe: 2, kode: "10f" });
    // Sub-folder tambahan di bawah butir tetap ikut butirnya.
    expect(butirDariJalur([...akar, "6. Back Up Perhitungan Kemajuan Pekerjaan", "Asemdoyong"])).toEqual({ terminKe: 2, kode: "6" });
  });
  it("di luar folder termin, atau folder yang tidak dikenal → null", () => {
    expect(butirDariJalur(["3. LAPORAN HARIAN", "Asemdoyong"])).toBeNull();
    expect(butirDariJalur([...akar])).toBeNull();
    expect(butirDariJalur([...akar, "Folder Lain-lain"])).toBeNull();
  });
});

describe("status butir & langkah", () => {
  const kosong: KeadaanBerkas = { surat: new Set(), dokumenPaket: new Set(), butirTermin: new Set(), butirTetap: new Set() };
  const b = (kode: string) => KATALOG_BERKAS_TERMIN.find((x) => x.kode === kode)!;

  it("asal menentukan status ketika berkasnya belum ada", () => {
    expect(statusButir(b("9a"), kosong)).toBe("belum_dibuat");
    expect(statusButir(b("5"), kosong)).toBe("disiapkan_marlin");
    expect(statusButir(b("3"), kosong)).toBe("belum_diunggah");
    expect(statusButir(b("10h"), kosong)).toBe("belum_diunggah");
    expect(statusButir(b("9c"), kosong)).toBe("menunggu");
  });

  it("sumber yang memenuhi: surat dibuat, dokumen paket, dokumen tetap, unggahan termin ini", () => {
    expect(statusButir(b("9a"), { ...kosong, surat: new Set(["permohonan_pemeriksaan"]) })).toBe("ada");
    expect(statusButir(b("3"), { ...kosong, dokumenPaket: new Set(["spmk"]) })).toBe("ada");
    expect(statusButir(b("T12"), { ...kosong, butirTetap: new Set(["T12"]) })).toBe("ada");
    // No. 2 "SSUK & SKK" terpenuhi oleh unggahan SSUK (T12) – tidak perlu diunggah dua kali.
    expect(statusButir(b("2"), { ...kosong, butirTetap: new Set(["T12"]) })).toBe("ada");
    expect(statusButir(b("9c"), { ...kosong, butirTermin: new Set(["9c"]) })).toBe("ada");
    // Unggahan untuk termin lain TIDAK memenuhi butir per termin.
    expect(statusButir(b("9c"), { ...kosong, butirTetap: new Set(["9c"]) })).toBe("menunggu");
  });

  it("langkah selesai bila semua butirnya ada atau disiapkan MARLIN", () => {
    const status = new Map<string, StatusButir>(KATALOG_BERKAS_TERMIN.map((x) => [x.kode, "menunggu"]));
    expect(statusLangkah(5, status)).toBe("belum");
    status.set("9c", "ada");
    expect(statusLangkah(5, status)).toBe("berjalan");
    status.set("9d", "ada");
    expect(statusLangkah(5, status)).toBe("selesai");
    expect(statusLangkah(8, status)).toBe("belum");
  });
});
