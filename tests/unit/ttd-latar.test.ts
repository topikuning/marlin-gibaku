// LATAR PUTIH STEMPEL DIBUANG SEBELUM MASUK PDF.
//
// Keluhan user atas berkas 26 Agustus 2026: di blok tanda tangan, stempel
// pelaksana MENUTUPI baris "( Ahmad Mu'min )" — bukan menimpa seperti cap di
// atas tinta, melainkan menghapusnya dengan kotak putih.
//
// DECISIONS 412 sudah membalik urutan menggambar (gambar dulu, teks sesudahnya)
// dan itu memang perlu, tapi tidak cukup: membalik urutan hanya menentukan siapa
// yang menang di piksel yang sama, tidak membuat latar stempelnya tembus
// pandang. Penyaji HTML lolos karena `mix-blend-multiply`; pdfkit tidak punya
// blend mode sama sekali, jadi putihnya harus dibuang dari gambarnya sendiri.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AMBANG_PUTIH, AMBANG_TINTA, hapusLatarPutih } from "@/lib/export/ttd-latar";

/** Satu piksel RGBA sebagai larik siap olah. */
function piksel(r: number, g: number, b: number, a = 255): Uint8Array {
  return new Uint8Array([r, g, b, a]);
}

describe("hapusLatarPutih", () => {
  it("kertas putih jadi tembus pandang sepenuhnya", () => {
    const p = piksel(255, 255, 255);
    expect(hapusLatarPutih(p)).toBe(1);
    expect(p[3]).toBe(0);
  });

  it("tinta gelap TIDAK disentuh sama sekali", () => {
    // Kalau tinta ikut dipudarkan, stempelnya jadi samar dan dokumen resmi
    // kehilangan bukti yang justru dicari pemeriksa.
    const p = piksel(20, 20, 20);
    expect(hapusLatarPutih(p)).toBe(0);
    expect(p[3]).toBe(255);
  });

  it("tinta MERAH stempel tetap legap", () => {
    /*
     * Kecerahan dihitung dengan bobot Rec. 601, bukan rata-rata. Merah stempel
     * (200, 30, 40) punya rata-rata 90 tapi komponen merahnya tinggi; rata-rata
     * naif akan membuat merah muda ikut dianggap kertas.
     */
    const p = piksel(200, 30, 40);
    expect(hapusLatarPutih(p)).toBe(0);
    expect(p[3]).toBe(255);
  });

  it("tepi yang di-antialias dilandaikan, bukan dipotong bergerigi", () => {
    const tengah = Math.round((AMBANG_PUTIH + AMBANG_TINTA) / 2);
    const p = piksel(tengah, tengah, tengah);
    hapusLatarPutih(p);
    expect(p[3]).toBeGreaterThan(0);
    expect(p[3]).toBeLessThan(255);
  });

  it("bagian yang MEMANG sudah transparan dibiarkan", () => {
    const p = piksel(10, 10, 10, 0);
    expect(hapusLatarPutih(p)).toBe(0);
    expect(p[3]).toBe(0);
  });
});

describe("stempel sungguhan lewat jalur yang sama dengan produksi", () => {
  it("REGRESI: cap di atas kertas putih tidak lagi jadi kotak legap", async () => {
    /*
     * Tiruan stempel pindaian: kertas putih dengan coretan gelap di tengahnya —
     * bentuk yang sama dengan berkas yang dikeluhkan. Yang dibuktikan: SEBAGIAN
     * BESAR gambarnya jadi tembus pandang (kertasnya), sementara coretannya
     * tetap legap.
     */
    const sisi = 40;
    const cap = await sharp({
      create: { width: sisi, height: sisi, channels: 3, background: "#ffffff" },
    })
      .composite([
        {
          input: {
            create: { width: 20, height: 8, channels: 3, background: "#8b1a1a" },
          },
          top: 16,
          left: 10,
        },
      ])
      .png()
      .toBuffer();

    const { data, info } = await sharp(cap).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    hapusLatarPutih(data);

    let tembus = 0;
    let legap = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) tembus++;
      else if (data[i] === 255) legap++;
    }
    const total = sisi * sisi;
    // Kertasnya (± 90% luas) hilang, coretannya (± 10%) bertahan utuh.
    expect(tembus / total).toBeGreaterThan(0.8);
    expect(legap).toBeGreaterThanOrEqual(20 * 8);

    // Dan hasilnya masih PNG sah yang bisa ditempel pdfkit.
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
    expect((await sharp(png).metadata()).hasAlpha).toBe(true);
  });
});
