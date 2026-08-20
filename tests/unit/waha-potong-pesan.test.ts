import { describe, expect, it } from "vitest";
import { potongPesan, BATAS_PESAN, MAKS_POTONGAN } from "@/lib/waha/potong-pesan";

/**
 * KIRIM BERTAHAP, BUKAN DIPOTONG (DECISIONS 390).
 *
 * Keberatan user: *"kenapa cuma batasi 15, kalau pun harus dikirim bertahap,
 * ya buat bertahap beberapa pesan"*.
 *
 * Yang dijaga di sini tiga hal yang kalau longgar mengembalikan cacat lama
 * dalam bentuk baru: potongan tidak boleh membelah baris, jumlah bagian harus
 * jujur, dan sisa yang benar-benar tidak terkirim harus DIAKUI.
 */

const barisLokasi = (n: number) =>
  Array.from({ length: n }, (_, i) => `• *Lokasi ${i + 1}* – Belum ada laporan`).join("\n");

describe("potongPesan", () => {
  it("pesan pendek tidak disentuh sama sekali", () => {
    const r = potongPesan("Progress\nhari ini\n\nAda 3 lokasi.");
    expect(r.bagian).toHaveLength(1);
    expect(r.bagian[0]).toBe("Progress\nhari ini\n\nAda 3 lokasi.");
    expect(r.sisaBaris).toBe(0);
    // Satu bagian TIDAK diberi penanda "(bagian 1/1)" – itu cuma kebisingan.
    expect(r.bagian[0]).not.toContain("bagian");
  });

  it("memotong HANYA di batas baris – tidak pernah membelah satu baris", () => {
    const r = potongPesan(barisLokasi(80));
    expect(r.bagian.length).toBeGreaterThan(1);
    for (const p of r.bagian) {
      for (const b of p.split("\n")) {
        if (b.startsWith("•")) {
          // Baris utuh selalu berakhir dengan kalimatnya, bukan terpotong.
          expect(b).toMatch(/^• \*Lokasi \d+\* – Belum ada laporan$/);
        }
      }
    }
  });

  it("setiap bagian diberi penanda n/m yang benar", () => {
    const r = potongPesan(barisLokasi(80));
    const total = r.bagian.length;
    r.bagian.forEach((p, i) => {
      expect(p).toContain(`_(bagian ${i + 1}/${total})_`);
    });
  });

  it("tiap bagian tetap di bawah batas (kecuali baris tunggal yang memang panjang)", () => {
    const r = potongPesan(barisLokasi(80));
    for (const p of r.bagian) {
      // + penanda bagian yang ditambahkan sesudahnya.
      expect(p.length).toBeLessThanOrEqual(BATAS_PESAN + 40);
    }
  });

  it("baris tunggal yang lebih panjang dari batas dikirim UTUH, bukan dibelah", () => {
    /*
     * Kutipan catatan lapangan wajib verbatim (DECISIONS 382). Membelahnya di
     * tengah kata menghasilkan kutipan yang bukan lagi kutipan.
     */
    const panjang = "x".repeat(BATAS_PESAN + 500);
    const r = potongPesan(`Kepala\n${panjang}`);
    expect(r.bagian.some((p) => p.includes(panjang))).toBe(true);
  });

  it("yang tidak terkirim DIAKUI, bukan dihilangkan diam-diam", () => {
    // Cukup banyak untuk melewati MAKS_POTONGAN.
    const r = potongPesan(barisLokasi(2000));
    expect(r.bagian).toHaveLength(MAKS_POTONGAN);
    expect(r.sisaBaris).toBeGreaterThan(0);
    expect(r.bagian.at(-1)).toContain("tidak saya kirim");
    expect(r.bagian.at(-1)).toContain(String(r.sisaBaris));
  });

  it("tidak ada baris yang HILANG selama masih muat", () => {
    /*
     * Penjaga terpenting: 54 lokasi harus benar-benar terkirim seluruhnya,
     * bukan 15 seperti sebelumnya. Ini uji yang memerahkan cacat aslinya.
     */
    const asli = barisLokasi(54);
    const r = potongPesan(asli);
    expect(r.sisaBaris).toBe(0);
    for (let i = 1; i <= 54; i++) {
      expect(r.bagian.join("\n")).toContain(`*Lokasi ${i}*`);
    }
  });
});
