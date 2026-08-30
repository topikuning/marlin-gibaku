// "versi kkp" harus MENENTUKAN berkas mana yang dikirim, bukan jadi kata sisa.
//
// Keluhan user 2026-08-31: *"permintaanku jelas, minta laporan harian versi
// kkp, tapi malah pdf yang diberikan versi marlin sendiri"*. Dua cacat
// bertumpuk di jalur WhatsApp:
//
// 1. Skema niat tidak punya dimensi BENTUK DOKUMEN sama sekali, jadi kata
//    "versi kkp" tidak pernah sampai ke keputusan apa pun. Jalur berkasnya
//    memanggil `renderHarianRingkasPdf` tanpa syarat.
// 2. Berkas yang dikirim itu — "RINGKASAN PELAKSANAAN HARIAN", dokumen bacaan
//    untuk grup WA (DECISIONS 261) — diberi keterangan "Blanko harian" dan
//    dijelaskan sebagai "blanko lapangan". Kepala `harian-ringkas.ts` sendiri
//    menulis bahwa ia BUKAN blanko KKP. Jadi MARLIN salah menyebut nama
//    dokumennya sendiri, dan orang yang membaca keterangan itu berhak mengira
//    ia sudah memegang blanko KKP.
//
// Bentuknya dibaca ATURAN, bukan AI: satu kata ini menentukan berkas mana yang
// keluar, dan tebakan yang meleset mengirim dokumen yang salah ke grup PPK.
import { describe, expect, it } from "vitest";
import { bacaBentukDokumen } from "@/lib/waha/parser-niat";
import { balasProduksiBerkas } from "@/lib/waha/tanya-format";

describe("bacaBentukDokumen", () => {
  it("membaca permintaan aslinya", () => {
    expect(bacaBentukDokumen("aku minta pdf laporan harian versi kkp dari Danasari")).toBe("kkp");
  });

  it("membaca sebutan lain untuk blanko yang sama", () => {
    for (const t of [
      "minta blanko kkp danasari",
      "laporan harian format kkp",
      "kirim laporan harian kkp danasari hari ini",
      "pdf harian bentuk KKP",
    ]) {
      expect(bacaBentukDokumen(t), t).toBe("kkp");
    }
  });

  it("membaca permintaan ringkasan MARLIN secara tersurat", () => {
    for (const t of ["minta ringkasan harian danasari", "laporan harian versi marlin"]) {
      expect(bacaBentukDokumen(t), t).toBe("ringkas");
    }
  });

  it("tidak menebak saat bentuknya tidak disebut", () => {
    expect(bacaBentukDokumen("minta pdf laporan harian danasari")).toBeNull();
  });

  it("tidak tersulut oleh kata yang kebetulan memuat huruf yang sama", () => {
    expect(bacaBentukDokumen("laporan harian kkpx")).toBeNull();
    expect(bacaBentukDokumen("progress knmp danasari")).toBeNull();
  });
});

describe("balasProduksiBerkas", () => {
  it("menyebut nama dokumen yang BENAR untuk blanko KKP", () => {
    const t = balasProduksiBerkas("Danasari", "2026-08-31", "kkp");
    expect(t).toContain("Blanko harian KKP");
    expect(t).not.toContain("Ringkasan");
  });

  it("berhenti menyebut ringkasan MARLIN sebagai blanko", () => {
    const t = balasProduksiBerkas("Danasari", "2026-08-31", "ringkas");
    expect(t).toContain("Ringkasan pelaksanaan harian");
    // Inilah kalimat yang menyesatkan: dokumen bacaan disebut blanko lapangan.
    expect(t).not.toContain("Ini blanko lapangan");
  });

  it("menunjukkan jalan ke bentuk yang satunya", () => {
    expect(balasProduksiBerkas("Danasari", "2026-08-31", "ringkas")).toContain("versi kkp");
    expect(balasProduksiBerkas("Danasari", "2026-08-31", "kkp")).toContain("ringkasan");
  });
});
