// KUNCI KETUKAN ULANG punya UJUNG (DECISIONS 251).
//
// Menahan ketukan duplikat itu benar — diukur pada 400 kbps, tiga ketukan
// beruntun jadi tiga permintaan halaman penuh yang saling berebut pipa. Tapi
// penahanan yang terlalu panjang membalik obatnya jadi penyakit: kalau sebuah
// ketukan ternyata tidak berujung navigasi, pengguna mengetuk lagi dan benar-
// benar tidak terjadi apa pun — keluhan aslinya persis, hanya kali ini kitalah
// penyebabnya.
//
// Cacat semacam itu TIDAK menimbulkan galat apa pun; layarnya tetap rapi dan
// ketukannya sekadar hilang. Jadi hanya uji yang menyatakan kapan kuncinya
// terbuka yang bisa menahannya kembali.
import { describe, expect, it } from "vitest";
import {
  AMBANG_LAMBAT_MS,
  BATAS_AMAN_MS,
  kunciKetukan,
  tahanKetukan,
} from "@/components/shell/nav-kunci-ulang";

const T0 = 1_700_000_000_000;

describe("ketukan duplikat ditahan", () => {
  it("ketukan kedua ke alamat yang sama, 200 ms kemudian, ditahan", () => {
    // Inti keluhan lapangan: 2-3 ketukan beruntun karena layar tampak diam.
    const kunci = kunciKetukan("/lokasi/abc", T0);
    expect(tahanKetukan(kunci, "/lokasi/abc", T0 + 200)).toBe(true);
  });

  it("ketukan ketiga pun masih ditahan selama jendelanya belum lewat", () => {
    const kunci = kunciKetukan("/lokasi/abc", T0);
    expect(tahanKetukan(kunci, "/lokasi/abc", T0 + AMBANG_LAMBAT_MS - 1)).toBe(true);
  });
});

describe("kuncinya TERBUKA saat pemberitahuan lambat muncul", () => {
  it("tepat di AMBANG_LAMBAT_MS ketukan sudah dilepas", () => {
    // Batasnya `<`, bukan `<=`: pada detik keenam pengguna membaca "jaringan
    // sepertinya lambat", dan sejak itu ketukannya harus kembali berarti.
    const kunci = kunciKetukan("/lokasi/abc", T0);
    expect(tahanKetukan(kunci, "/lokasi/abc", T0 + AMBANG_LAMBAT_MS)).toBe(false);
  });

  it("sesudah ambang, ketukan ulang lolos dan menyetel kunci baru", () => {
    const pertama = kunciKetukan("/lokasi/abc", T0);
    const t = T0 + AMBANG_LAMBAT_MS + 500;
    expect(tahanKetukan(pertama, "/lokasi/abc", t)).toBe(false);

    // Lolos bukan berarti bebas selamanya: burst berikutnya ditahan lagi.
    const kedua = kunciKetukan("/lokasi/abc", t);
    expect(tahanKetukan(kedua, "/lokasi/abc", t + 200)).toBe(true);
  });

  it("kunci TIDAK BOLEH hidup lebih lama daripada jaring pengaman bar", () => {
    // Kalau kuncinya melebihi BATAS_AMAN_MS, ada rentang di mana barnya sudah
    // padam (layar diam total) sementara ketukan pengguna masih ditelan. Itu
    // gabungan terburuk dari kedua cacat sekaligus.
    expect(AMBANG_LAMBAT_MS).toBeLessThan(BATAS_AMAN_MS);
  });
});

describe("yang TIDAK ikut terkunci", () => {
  it("alamat lain selalu lolos – pengguna berubah pikiran tidak dihukum", () => {
    const kunci = kunciKetukan("/lokasi/abc", T0);
    expect(tahanKetukan(kunci, "/lokasi/xyz", T0 + 200)).toBe(false);
    expect(tahanKetukan(kunci, "/progress", T0 + 200)).toBe(false);
  });

  it("query string berbeda = tujuan berbeda", () => {
    // Filter/paginasi memakai query; menganggapnya alamat yang sama akan
    // menelan ketukan yang tujuannya jelas berbeda.
    const kunci = kunciKetukan("/lokasi?hal=1", T0);
    expect(tahanKetukan(kunci, "/lokasi?hal=2", T0 + 200)).toBe(false);
  });

  it("tanpa navigasi berjalan, tidak ada yang ditahan", () => {
    expect(tahanKetukan(null, "/lokasi/abc", T0)).toBe(false);
  });
});
