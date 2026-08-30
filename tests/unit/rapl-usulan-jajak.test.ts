// Kapan layar boleh menarik ulang dirinya selama menunggu draf harga AI.
//
// Pola "menunggu di layar, bukan di dalam request" (DECISIONS 455) benar dan
// tidak diubah. Yang salah cara menengoknya: layar memanggil `router.refresh()`
// tiap 3 detik, dan itu menjalankan ULANG keenam kueri `RaplPage` — termasuk
// `simulasiRapl` atas ratusan baris RAB — hanya untuk membaca satu boolean.
// Untuk lokasi 480 baris, seluruh perhitungan RAPL diulang dua puluh kali per
// menit demi pertanyaan "sudah selesai belum?".
//
// Sekarang yang ditengok status ringkasnya saja, dan halaman ditarik ulang
// HANYA ketika ada yang benar-benar berubah. Aturannya ditaruh di fungsi murni
// supaya bisa diuji tanpa peramban, tanpa basis data, dan tanpa menunggu.
//
// Merah sebelum perbaikan: fungsinya belum ada, dan perilaku yang berlaku
// setara dengan aturan yang SELALU menjawab "tarik ulang".
import { describe, expect, it } from "vitest";
import { perluTarikUlang, type RingkasUsulanAi } from "@/lib/ahsp/usulan-status";

const menunggu: RingkasUsulanAi = { menunggu: true, terputus: false, jumlahDraf: 0 };

describe("perluTarikUlang", () => {
  it("tidak menarik ulang kalau tidak ada yang berubah", () => {
    // Ini seluruh alasan perubahan ini ada.
    expect(perluTarikUlang(menunggu, { ...menunggu })).toBe(false);
  });

  it("menarik ulang saat draf selesai disusun", () => {
    expect(perluTarikUlang(menunggu, { menunggu: false, terputus: false, jumlahDraf: 25 })).toBe(
      true,
    );
  });

  it("menarik ulang saat draf mulai bermunculan meski masih menunggu", () => {
    expect(perluTarikUlang(menunggu, { ...menunggu, jumlahDraf: 3 })).toBe(true);
  });

  it("menarik ulang saat tunggu lewat batas – prosesnya mati sebelum menjawab", () => {
    // `terputus` lahir dari perjalanan waktu, bukan dari perubahan basis data:
    // tanpa penengokan berkala, layar akan menunggu selamanya tanpa kabar.
    expect(perluTarikUlang(menunggu, { ...menunggu, terputus: true })).toBe(true);
  });

  it("menarik ulang saat draf habis diputuskan dari tab lain", () => {
    const berdraf: RingkasUsulanAi = { menunggu: false, terputus: false, jumlahDraf: 25 };
    expect(perluTarikUlang(berdraf, { ...berdraf, jumlahDraf: 0 })).toBe(true);
  });
});
