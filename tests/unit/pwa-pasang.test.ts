/*
 * KAPAN TOMBOL "PASANG APLIKASI" PANTAS MUNCUL (DECISIONS 405).
 *
 * Permintaan user 2026-08-21: *"di chrome ada pilihan install. apakah kamu bisa
 * force memberi pilihan install tanpa harus masuk menu chrome untuk install"*
 *
 * Yang paling mudah salah bukan pemanggilan `prompt()`-nya — itu satu baris —
 * melainkan KAPAN tawarannya pantas muncul. Banner pasang yang muncul kepada
 * orang yang aplikasinya SUDAH terpasang, atau yang muncul lagi lima menit
 * sesudah ditutup, adalah cara tercepat membuat seluruh banner MARLIN diabaikan
 * — termasuk yang membawa kabar penting.
 */
import { describe, expect, it } from "vitest";
import { JEDA_TOLAK_HARI, iniIos, tawaranPasang } from "@/lib/pwa/pasang";

const SEKARANG = Date.UTC(2026, 7, 21, 12, 0, 0);
const hariLalu = (n: number) => SEKARANG - n * 86_400_000;

const dasar = {
  adaTawaran: false,
  sudahTerpasang: false,
  ios: false,
  ditolakPada: null as number | null,
  sekarang: SEKARANG,
};

describe("tawaran pasang", () => {
  it("Chrome menawarkan → tombol muncul", () => {
    expect(tawaranPasang({ ...dasar, adaTawaran: true })).toBe("tombol");
  });

  it("peramban tidak menawarkan → tidak ada apa-apa", () => {
    // Tanpa `beforeinstallprompt` tidak ada yang bisa dipaksa: tombol yang
    // muncul tapi tidak bisa memasang lebih buruk daripada tidak ada tombol.
    expect(tawaranPasang(dasar)).toBe("tidak");
  });

  it("SUDAH TERPASANG mengalahkan segalanya", () => {
    expect(tawaranPasang({ ...dasar, adaTawaran: true, sudahTerpasang: true })).toBe("tidak");
    expect(tawaranPasang({ ...dasar, ios: true, sudahTerpasang: true })).toBe("tidak");
  });

  it("iOS mendapat PETUNJUK, bukan tombol yang pura-pura bekerja", () => {
    expect(tawaranPasang({ ...dasar, ios: true })).toBe("petunjuk-ios");
  });

  it("iOS tetap kalah bila peramban benar-benar menawarkan", () => {
    // Mis. Chrome Android dengan UA aneh: kalau event-nya ada, jalur otomatis
    // jelas lebih baik daripada menyuruh orang mencari menu Bagikan.
    expect(tawaranPasang({ ...dasar, ios: true, adaTawaran: true })).toBe("tombol");
  });
});

describe("penolakan didiamkan, bukan dilupakan", () => {
  it("baru ditutup → diam", () => {
    expect(tawaranPasang({ ...dasar, adaTawaran: true, ditolakPada: hariLalu(1) })).toBe("tidak");
  });

  it(`sesudah ${JEDA_TOLAK_HARI} hari boleh menawar lagi`, () => {
    // Keadaan orang berubah: ganti HP, mulai kerja di lapangan. "Tidak sekarang"
    // bukan "jangan pernah".
    const t = tawaranPasang({
      ...dasar,
      adaTawaran: true,
      ditolakPada: hariLalu(JEDA_TOLAK_HARI + 1),
    });
    expect(t).toBe("tombol");
  });

  it("cap waktu dari MASA DEPAN tidak mengunci tawaran selamanya", () => {
    /*
     * Jam HP lapangan sering salah, dan penyimpanan bisa rusak. Cap waktu yang
     * lebih baru daripada sekarang akan membuat selisihnya negatif — kalau
     * diperlakukan sebagai "baru ditutup", tawarannya tidak akan pernah muncul
     * lagi di HP itu, dan tidak akan ada yang tahu kenapa.
     */
    const t = tawaranPasang({ ...dasar, adaTawaran: true, ditolakPada: SEKARANG + 86_400_000 });
    expect(t).toBe("tombol");
  });
});

describe("pengenalan iOS", () => {
  it.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 0, "", true],
    ["iPad lama", "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)", 0, "", true],
    ["Android", "Mozilla/5.0 (Linux; Android 14; Pixel 7)", 5, "Linux armv8l", false],
    ["Mac desktop", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "MacIntel", false],
  ])("%s", (_nama, ua, sentuh, platform, harap) => {
    expect(iniIos(ua, sentuh, platform)).toBe(harap);
  });

  it("iPadOS 13+ yang menyamar jadi Macintosh tetap dikenali", () => {
    // Satu-satunya pembedanya layar sentuh; tanpa ini pemakai iPad tidak pernah
    // mendapat petunjuk apa pun dan mengira MARLIN tidak bisa dipasang.
    expect(iniIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "MacIntel")).toBe(true);
  });
});
