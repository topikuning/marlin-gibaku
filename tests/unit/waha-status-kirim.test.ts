import { describe, expect, it } from "vitest";
import {
  kalimatStatusKirim,
  statusBerikutnya,
  statusDariAck,
  LABEL_STATUS_KIRIM,
} from "@/lib/waha/status-kirim";
import type { WaOutboundStatus } from "@/generated/prisma/enums";

/**
 * MESIN STATUS kiriman WhatsApp (DECISIONS 374).
 *
 * Dua hal yang dijaga di sini, dan keduanya soal KEJUJURAN:
 *
 * 1. "diterima WAHA" tidak pernah boleh terbaca sebagai "sampai". HTTP 2xx
 *    hanya membuktikan WAHA menerima permintaannya — ia menjawab 2xx juga saat
 *    sesinya belum login, dan pesannya tidak pernah keluar.
 * 2. Status tidak boleh MUNDUR. Ack tiba lewat jaringan dan tidak dijamin
 *    berurutan; `read` bisa mendarat sebelum `delivered`. Riwayat status yang
 *    berkedip membuat orang berhenti mempercayainya sama sekali.
 */

describe("statusDariAck", () => {
  it("angka ack WhatsApp dipetakan sesuai artinya", () => {
    expect(statusDariAck(1)).toBe("terkirim"); // sampai server
    expect(statusDariAck(2)).toBe("sampai"); // sampai perangkat
    expect(statusDariAck(3)).toBe("dibaca");
    expect(statusDariAck(4)).toBe("dibaca"); // diputar (audio) — tetap sudah dibaca
  });

  it("ack negatif = gagal", () => {
    expect(statusDariAck(-1)).toBe("gagal");
  });

  it("bentuk teks dari sebagian engine juga dikenali", () => {
    // Menebak satu bentuk berarti rekonsiliasi diam-diam mati di engine lain.
    expect(statusDariAck("server")).toBe("terkirim");
    expect(statusDariAck("device")).toBe("sampai");
    expect(statusDariAck("read")).toBe("dibaca");
    expect(statusDariAck("ERROR")).toBe("gagal");
  });

  it("ack 0 (pending) TIDAK dipetakan", () => {
    // Ia tidak menambah apa pun di atas "diterima WAHA"; memetakannya cuma
    // menambah perubahan status tanpa arti baru.
    expect(statusDariAck(0)).toBeNull();
  });

  it("kosong / tak dikenal → null, bukan tebakan", () => {
    for (const v of [null, undefined, "entah"]) expect(statusDariAck(v)).toBeNull();
  });
});

describe("statusBerikutnya — status tidak boleh mundur", () => {
  it("maju satu tingkat diterima", () => {
    expect(statusBerikutnya("diterima_waha", "terkirim")).toBe("terkirim");
    expect(statusBerikutnya("terkirim", "sampai")).toBe("sampai");
    expect(statusBerikutnya("sampai", "dibaca")).toBe("dibaca");
  });

  it("melompat maju juga diterima — ack tengah boleh hilang", () => {
    // WhatsApp tidak menjamin seluruh ack tiba. Menuntut urutan lengkap berarti
    // pesan yang jelas sudah dibaca tertahan di "terkirim" selamanya.
    expect(statusBerikutnya("diterima_waha", "dibaca")).toBe("dibaca");
  });

  it("ack DUPLIKAT tidak mengubah apa pun", () => {
    expect(statusBerikutnya("sampai", "sampai")).toBeNull();
  });

  it("ack TERLAMBAT tidak menurunkan status", () => {
    /*
     * Inti pagar ini. `delivered` yang mendarat sesudah `read` tidak boleh
     * menurunkan pesan yang sudah dibaca — pembaca layar status akan melihat
     * angka yang naik-turun dan berhenti mempercayainya.
     */
    expect(statusBerikutnya("dibaca", "sampai")).toBeNull();
    expect(statusBerikutnya("dibaca", "terkirim")).toBeNull();
    expect(statusBerikutnya("sampai", "terkirim")).toBeNull();
  });

  it("GAGAL menang atas status maju mana pun", () => {
    // Ia punya bukti sendiri (galat dari WAHA). Menyembunyikannya karena
    // "sudah pernah terkirim" berarti melaporkan pesan hilang sebagai sampai.
    expect(statusBerikutnya("terkirim", "gagal")).toBe("gagal");
    expect(statusBerikutnya("dibaca", "gagal")).toBe("gagal");
  });

  it("sesudah final, ack maju tidak menghidupkannya kembali", () => {
    expect(statusBerikutnya("gagal", "dibaca")).toBeNull();
    expect(statusBerikutnya("ditolak", "terkirim")).toBeNull();
  });

  it("urutan ack acak selalu berakhir di tingkat TERTINGGI", () => {
    // Properti, bukan contoh: berapa pun urutan tibanya, hasil akhirnya sama.
    const acak: WaOutboundStatus[] = ["sampai", "terkirim", "dibaca", "terkirim", "sampai"];
    let s: WaOutboundStatus = "diterima_waha";
    for (const a of acak) s = statusBerikutnya(s, a) ?? s;
    expect(s).toBe("dibaca");
  });
});

describe("kata-kata yang dipakai UI", () => {
  it('"diterima WAHA" TIDAK boleh berbunyi "terkirim"', () => {
    /*
     * Inilah yang dulu ditulis UI begitu HTTP 2xx. Kalau label ini suatu saat
     * diganti jadi "Terkirim" demi terlihat rapi, seluruh perbaikan ini batal
     * tanpa satu baris kode pun berubah.
     */
    expect(LABEL_STATUS_KIRIM.diterima_waha.toLowerCase()).not.toContain("terkirim");
    expect(LABEL_STATUS_KIRIM.diterima_waha.toLowerCase()).not.toContain("sampai");
  });

  it("kalimatnya menyatakan ketidakpastian secara eksplisit", () => {
    expect(kalimatStatusKirim("diterima_waha").toLowerCase()).toContain("belum tentu sampai");
  });

  it("tiap status punya kalimatnya sendiri", () => {
    const semua: WaOutboundStatus[] = [
      "antre",
      "diterima_waha",
      "terkirim",
      "sampai",
      "dibaca",
      "gagal",
      "ditolak",
    ];
    const kalimat = semua.map(kalimatStatusKirim);
    expect(new Set(kalimat).size).toBe(semua.length);
  });
});
