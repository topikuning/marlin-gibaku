// KALIMAT KOLOM PROGRES AGREGAT di daftar paket.
//
// Yang dikunci berkas ini adalah hal-hal yang TIDAK terlihat salah di layar:
// sel yang kosong padahal keadaannya "memang belum ada", dan angka SEBAGIAN
// yang tidak mengaku sebagian. Keduanya tidak melempar galat; angkanya cuma
// terbaca sebagai hal lain.
import { describe, expect, it } from "vitest";
import {
  catatanProgresPaket,
  teksProgresPaket,
  type RingkasProgresPaket,
} from "@/lib/package/progres-paket-teks";

const dasar: RingkasProgresPaket = {
  pct: null,
  lokasiIkut: 0,
  lokasiPenugasan: 0,
  lokasiTanpaRab: 0,
  lokasiDicabut: 0,
  lokasiTersembunyi: 0,
  lokasiTotal: 0,
};
const r = (p: Partial<RingkasProgresPaket>): RingkasProgresPaket => ({ ...dasar, ...p });

describe("sel yang tidak punya angka MENYEBUT sebabnya", () => {
  it("paket tanpa lokasi", () => {
    expect(teksProgresPaket(r({ lokasiTotal: 0 }))).toBe("belum ada lokasi");
  });

  it("punya lokasi tapi belum ada RAB aktif – BUKAN 0,0%", () => {
    /*
     * Inilah jebakannya: `weightedRealizedPct` mengembalikan 0 ketika
     * penyebutnya nol, jadi paket yang belum punya RAB akan tertulis "0,0%" —
     * "belum ada datanya" terbaca "belum ada kemajuannya". Funnel /paket penuh
     * paket semacam itu.
     */
    const t = teksProgresPaket(r({ lokasiTotal: 3, lokasiTanpaRab: 3 }));
    expect(t).toBe("belum ada RAB aktif");
    expect(t).not.toContain("0,0");
  });

  it("seluruh lokasinya dicabut adendum", () => {
    expect(teksProgresPaket(r({ lokasiTotal: 2, lokasiPenugasan: 2, lokasiDicabut: 2 }))).toBe(
      "semua lokasi dicabut adendum",
    );
  });

  it("pencabutan yang sudah DIARSIPKAN tidak diumumkan lewat sel", () => {
    /*
     * Ketetapan user 2026-09-06: riwayat pencabutan yang diarsipkan tidak
     * meninggalkan bekas di layar umum. `lokasiDicabut` di sini sudah
     * dikurangi daftar arsip oleh `progresPaketDaftar`, jadi kalimatnya harus
     * netral – bukan "semua lokasi dicabut adendum" yang justru mengumumkan
     * keberadaan arsipnya, apalagi ke berkas CSV.
     */
    const t = teksProgresPaket(r({ lokasiTotal: 2, lokasiPenugasan: 2, lokasiDicabut: 0 }));
    expect(t).toBe("tidak ada lokasi yang dihitung");
    expect(t).not.toContain("adendum");
  });

  it("seluruh lokasinya di luar penugasan user", () => {
    expect(teksProgresPaket(r({ lokasiTotal: 4, lokasiTersembunyi: 4 }))).toBe(
      "lokasi di luar penugasan Anda",
    );
  });
});

describe("angka yang SEBAGIAN mengaku sebagian", () => {
  it("user ber-scope sempit: selnya menyebut berapa dari berapa", () => {
    /*
     * Penyebutnya SELURUH lokasi paket, dan kalimatnya "lokasi paket ini".
     * Dulu berbunyi "lokasi penugasan Anda" dengan penyebut yang sama, dan itu
     * menyatakan penugasan yang tidak pernah ada: di sini penugasannya EMPAT,
     * yang menyumbang angka DUA, dan paketnya berisi TUJUH – tak satu pun dari
     * ketiganya boleh tertukar.
     */
    const t = teksProgresPaket(
      r({ pct: 42.35, lokasiIkut: 2, lokasiPenugasan: 4, lokasiTersembunyi: 3, lokasiTotal: 7 }),
    );
    expect(t).toBe("42,4% – 2 dari 7 lokasi paket ini");
    expect(t).not.toContain("penugasan");
    // Tanda pisah UI = en-dash, dijaga juga oleh tests/unit/tanda-pisah-ui.
    expect(t).toContain("–");
    // Em-dash disusun dari kodenya: penjaga tanda pisah sengaja menangkap
    // bentuk escape "\u2014" juga, jadi menuliskannya utuh di sini justru
    // membuat berkas uji ini sendiri jadi pelanggarnya.
    expect(t).not.toContain(String.fromCharCode(0x2014));
  });

  it("paket yang UTUH tidak dibebani keterangan apa pun", () => {
    // "3 dari 3" cuma menambah kebisingan pada baris yang tidak bermasalah.
    expect(
      teksProgresPaket(r({ pct: 10, lokasiIkut: 3, lokasiPenugasan: 3, lokasiTotal: 3 })),
    ).toBe("10,0%");
  });

  it("lokasi dicabut TIDAK membuat baris utuh mengaku sebagian", () => {
    // Dicabut adendum bukan "tersembunyi dari Anda" – ia memang di luar
    // kontrak. Keterangannya masuk tooltip, bukan teks sel.
    expect(
      teksProgresPaket(
        r({ pct: 88, lokasiIkut: 2, lokasiPenugasan: 3, lokasiDicabut: 1, lokasiTotal: 3 }),
      ),
    ).toBe("88,0%");
  });
});

describe("tooltip menerangkan dasar angkanya, tanpa angka baru", () => {
  it("menyebut kumulatif, penimbang, dan tingkat status laporan", () => {
    const c = catatanProgresPaket(r({ pct: 50, lokasiIkut: 4, lokasiPenugasan: 4, lokasiTotal: 4 }));
    expect(c).toContain("kumulatif");
    expect(c).toContain("RAB aktif");
    expect(c).toContain("dikirim");
    expect(c).toContain("final");
  });

  it("menyebut lokasi yang TIDAK ikut, satu per satu sebabnya", () => {
    const c = catatanProgresPaket(
      r({
        pct: 50, lokasiIkut: 2, lokasiPenugasan: 4, lokasiTanpaRab: 1,
        lokasiDicabut: 1, lokasiTersembunyi: 3, lokasiTotal: 7,
      }),
    );
    expect(c).toContain("1 lokasi belum punya RAB aktif");
    expect(c).toContain("1 lokasi dicabut adendum");
    // Cacah PENUGASAN disebut apa adanya – bukan disamakan dengan cacah lokasi
    // paket, dan bukan disamakan dengan yang menyumbang angka.
    expect(c).toContain("Penugasan Anda di paket ini 4 lokasi");
    expect(c).toContain("3 sisanya di luar penugasan");
    expect(c).toContain("BUKAN progres seluruh paket");
  });

  it("tidak memuat satu pun persen selain yang sudah ada di selnya", () => {
    // Tooltip yang memuat hitungan kedua (rencana/deviasi) jadi angka basi
    // begitu definisinya bergeser, dan tidak ada tes yang menjaganya.
    const c = catatanProgresPaket(r({ pct: 37.2, lokasiIkut: 1, lokasiPenugasan: 1, lokasiTotal: 1 }));
    expect(c).not.toMatch(/\d+,\d%/);
  });
});
