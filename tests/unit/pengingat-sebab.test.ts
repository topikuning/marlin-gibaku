// "Berhasil" yang tidak mengirim apa pun (DECISIONS 221).
//
// Keluhan user 2026-08-02: "aku sudah klik, dinyatakan berhasil. tapi tidak ada
// wa yang terkirim, sedangkan fitur kirim laporan ke group berjalan normal."
//
// Sebabnya: nol pesan punya DUA arti yang berlawanan — semua sudah melapor
// (sehat), atau tidak satu pun penanggung jawab punya nomor WA (salah
// konfigurasi). Keduanya dulu memakai kalimat hijau yang sama.
import { describe, expect, it } from "vitest";
import { sebabTidakAdaPenerima, type DiagnosaPengingat } from "@/lib/harian/diagnosa";

const d = (o: Partial<DiagnosaPengingat> = {}): DiagnosaPengingat => ({
  lokasiDalamLingkup: 7,
  lokasiSudahLapor: 0,
  lokasiPerluDitagih: 7,
  lokasiTanpaPenugasan: 0,
  orangDitugaskan: 8,
  orangTanpaNomorWa: 0,
  orangNonaktif: 0,
  ...o,
});

describe("KASUS INTI: nol pesan harus bisa menjelaskan dirinya", () => {
  it("semua sudah melapor → null (memang sehat, bukan masalah)", () => {
    expect(sebabTidakAdaPenerima(d({ lokasiPerluDitagih: 0, lokasiSudahLapor: 7 }))).toBeNull();
  });

  it("tidak ada yang punya nomor WA → disebut, berikut ke mana harus mengisinya", () => {
    // Keadaan NYATA di basis data uji: 8 user aktif, nol punya nomor WA.
    const s = sebabTidakAdaPenerima(d({ orangTanpaNomorWa: 8 }));
    expect(s).toContain("8 belum punya nomor WhatsApp");
    expect(s).toContain("7 lokasi belum melapor");
    // Nama menunya harus yang ADA di sidebar hari ini (DECISIONS 222 —
    // "Master Data" sudah dipecah ke dalam grup Administrasi).
    expect(s).toMatch(/Administrasi.*Pengguna/);
  });

  it("akun nonaktif ikut disebut terpisah dari yang tanpa nomor", () => {
    const s = sebabTidakAdaPenerima(d({ orangTanpaNomorWa: 3, orangNonaktif: 2 }));
    expect(s).toContain("3 belum punya nomor WhatsApp");
    expect(s).toContain("2 akunnya nonaktif");
  });

  it("tidak ada penugasan sama sekali → diarahkan ke halaman Lokasi, bukan Pengguna", () => {
    const s = sebabTidakAdaPenerima(d({ orangDitugaskan: 0 }));
    expect(s).toContain("TIDAK ADA orang yang ditugaskan");
    expect(s).toContain("halaman Lokasi");
  });

  it("belum ada lokasi dalam lingkup → syaratnya disebut, bukan cuma 'tidak ada'", () => {
    const s = sebabTidakAdaPenerima(d({ lokasiDalamLingkup: 0, lokasiPerluDitagih: 0 }));
    expect(s).toContain("SPMK");
    expect(s).toContain("pelaksanaan");
  });

  it("ada penerima sehat → null, jangan mengarang masalah", () => {
    expect(sebabTidakAdaPenerima(d())).toBeNull();
  });
});
