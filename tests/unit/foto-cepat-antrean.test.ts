// ANTREAN UNGGAH SAAT JARINGAN JELEK / OFFLINE (DECISIONS 257).
//
// Permintaan user: "lalu perlu solusi juga jika jaringan jelek, atau offline".
//
// Yang dijaga berkas ini adalah dua keputusan yang menentukan apakah bukti
// lapangan selamat atau hilang:
//
//  1. Kegagalan JARINGAN tidak pernah menyerah. Sinyal jelek adalah keadaan
//     NORMAL di lokasi KNMP, bukan kasus tepi; antrean yang menyerah sesudah
//     N percobaan akan membuang foto persis di tempat yang paling butuh.
//  2. Penolakan SERVER berhenti. Foto duplikat akan ditolak seribu kali dengan
//     hasil yang sama — mencobanya terus menghabiskan baterai sambil
//     menyembunyikan sebabnya dari pelapor.
//
// Keduanya cacat senyap kalau terbalik: tidak ada galat, tidak ada layar yang
// berubah, hanya foto yang tidak pernah sampai.
import { describe, expect, it } from "vitest";
import {
  MAKS_ANTREAN,
  bolehCoba,
  jedaBerikutnya,
  ringkasAntrean,
  statusDariKegagalan,
  type ItemAntrean,
} from "@/lib/foto-cepat/antrean-kebijakan";

const T = 1_700_000_000_000;
const item = (p: Partial<ItemAntrean> = {}): ItemAntrean => ({
  id: "x",
  percobaan: 0,
  terakhirCoba: 0,
  status: "menunggu",
  ...p,
});

describe("jadwal percobaan ulang", () => {
  it("percobaan pertama langsung, tanpa jeda", () => {
    expect(jedaBerikutnya(0)).toBe(0);
  });

  it("naik bertahap", () => {
    expect(jedaBerikutnya(1)).toBeLessThan(jedaBerikutnya(2));
    expect(jedaBerikutnya(2)).toBeLessThan(jedaBerikutnya(3));
  });

  it("MENDATAR, tidak naik tanpa batas", () => {
    // Jeda yang terus berlipat akhirnya jadi berjam-jam — secara praktis sama
    // dengan menyerah, hanya tanpa mengakuinya.
    const jauh = jedaBerikutnya(50);
    expect(jauh).toBe(jedaBerikutnya(5));
    expect(jauh).toBeLessThanOrEqual(300_000);
  });
});

describe("kapan boleh dicoba", () => {
  it("belum pernah dicoba + online → langsung", () => {
    expect(bolehCoba(item(), T, true)).toBe(true);
  });

  it("offline → tunggu, jangan bakar baterai", () => {
    expect(bolehCoba(item(), T, false)).toBe(false);
  });

  it("belum sampai jadwalnya → tunggu", () => {
    const i = item({ percobaan: 2, terakhirCoba: T - 1_000, status: "gagal_jaringan" });
    expect(bolehCoba(i, T, true)).toBe(false);
  });

  it("sudah lewat jadwalnya → coba lagi", () => {
    const i = item({ percobaan: 2, terakhirCoba: T - 999_999, status: "gagal_jaringan" });
    expect(bolehCoba(i, T, true)).toBe(true);
  });

  it("sedang dikirim → jangan dikirim dua kali", () => {
    expect(bolehCoba(item({ status: "kirim" }), T, true)).toBe(false);
  });

  it("gagal jaringan berkali-kali → TETAP dicoba, tidak pernah menyerah", () => {
    // Inti janjinya. Kalau suatu saat ada batas percobaan, uji ini yang
    // menangkapnya — bukan mandor yang kehilangan foto sehari kerja.
    const i = item({ percobaan: 500, terakhirCoba: T - 999_999, status: "gagal_jaringan" });
    expect(bolehCoba(i, T, true)).toBe(true);
  });

  it("DITOLAK server → berhenti, walau sudah lama dan online", () => {
    const i = item({ percobaan: 1, terakhirCoba: T - 999_999, status: "ditolak" });
    expect(bolehCoba(i, T, true)).toBe(false);
  });
});

describe("membedakan sebab kegagalan", () => {
  it("jaringan → dicoba lagi; server → berhenti", () => {
    expect(statusDariKegagalan("jaringan")).toBe("gagal_jaringan");
    expect(statusDariKegagalan("server")).toBe("ditolak");
    expect(bolehCoba(item({ status: statusDariKegagalan("jaringan"), percobaan: 1, terakhirCoba: 0 }), T, true)).toBe(true);
    expect(bolehCoba(item({ status: statusDariKegagalan("server") }), T, true)).toBe(false);
  });
});

describe("ringkasan untuk pelapor", () => {
  it("memisahkan yang masih diperjuangkan dari yang butuh keputusan", () => {
    const r = ringkasAntrean([
      item({ id: "a", status: "menunggu" }),
      item({ id: "b", status: "gagal_jaringan" }),
      item({ id: "c", status: "ditolak" }),
    ]);
    expect(r.menunggu).toBe(2);
    expect(r.ditolak).toBe(1);
    expect(r.perluPerhatian).toBe(true);
  });

  it("antrean kosong tidak memunculkan peringatan apa pun", () => {
    expect(ringkasAntrean([]).perluPerhatian).toBe(false);
  });
});

describe("batas antrean", () => {
  it("ada batasnya, dan tidak absurd", () => {
    // Penyimpanan peramban terbatas. Tanpa batas, jepretan berikutnya hilang
    // diam-diam saat kuota penuh — kegagalan paling buruk yang mungkin di sini.
    expect(MAKS_ANTREAN).toBeGreaterThanOrEqual(50);
    expect(MAKS_ANTREAN).toBeLessThanOrEqual(500);
  });
});
