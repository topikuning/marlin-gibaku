/*
 * ORIENTASI FOTO CEPAT (DECISIONS 424).
 *
 * Kamera dalam aplikasi memotret lewat canvas, dan canvas TIDAK menghasilkan
 * EXIF — jadi tidak ada yang bisa dibaca server. Keputusan orientasinya diambil
 * di HP pada detik rana ditekan, dan aturannya diuji di sini supaya tidak hidup
 * sebagai tebakan di dalam handler rana.
 *
 * Yang paling mudah salah bukan "memutar", melainkan MEMUTAR DUA KALI: sebagian
 * peramban sudah menegakkan bingkainya sendiri, dan aturan yang memutar tanpa
 * syarat merusak justru yang tadinya benar.
 */
import { describe, expect, it } from "vitest";
import { putaranBingkai } from "@/components/knmp/kamera-langsung";

describe("putaranBingkai", () => {
  it("HP tegak + bingkai lanskap (kasus rusak yang dilaporkan) → diputar 90°", () => {
    expect(putaranBingkai(1920, 1080, 0)).toBe(90);
  });

  it("HP terbalik 180° + bingkai lanskap → diputar ke arah sebaliknya", () => {
    expect(putaranBingkai(1920, 1080, 180)).toBe(270);
  });

  it("peramban SUDAH menegakkan bingkainya → jangan disentuh", () => {
    // Layar potret, bingkai sudah potret. Memutar di sini = merusak yang benar.
    expect(putaranBingkai(1080, 1920, 0)).toBe(0);
  });

  it("HP dimiringkan sengaja (foto lanskap) → jangan diputar", () => {
    expect(putaranBingkai(1920, 1080, 90)).toBe(0);
    expect(putaranBingkai(1920, 1080, 270)).toBe(0);
  });

  it("HP miring tapi bingkai tegak → tetap tidak diputar", () => {
    /*
     * Kombinasi ini muncul pada peramban yang memutar bingkainya sendiri
     * MENGIKUTI layar. Memutar lagi akan memiringkannya.
     */
    expect(putaranBingkai(1080, 1920, 90)).toBe(0);
  });

  it("bingkai persegi tidak pernah diputar (tidak ada yang bisa disimpulkan)", () => {
    for (const sudut of [0, 90, 180, 270]) {
      expect(putaranBingkai(1000, 1000, sudut), `sudut ${sudut}`).toBe(0);
    }
  });

  it("sudut layar TIDAK diketahui → jangan sentuh", () => {
    /*
     * Peramban tanpa `screen.orientation` (WebView lama). Memperlakukan "tidak
     * tahu" sebagai "potret" akan memutar foto LANSKAP yang sengaja diambil
     * lanskap – merusak yang tadinya benar, demi menebak yang tidak diketahui.
     */
    expect(putaranBingkai(1920, 1080, null)).toBe(0);
    expect(putaranBingkai(1080, 1920, null)).toBe(0);
  });
});
