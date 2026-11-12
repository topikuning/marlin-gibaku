import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// Rusak fontconfig dengan SENGAJA – sama dengan uji cap foto: tanda tangan
// ketik harus tetap memakai huruf tulisan tangan dari assets/fonts, bukan
// bergantung font sistem server.
process.env.FONTCONFIG_FILE = "/nonexistent/fonts.conf";
process.env.FONTCONFIG_PATH = "/nonexistent";
vi.mock("server-only", () => ({}));

const { namaUntukTtd, pilihHuruf, HURUF_TTD, ttdKetikPng, ttdKetikDataUrl } = await import("@/lib/export/ttd-ketik");
const { kotakTtdKetik, rasioPng, ukuranTtd, PERSEN_TTD_KETIK } = await import("@/lib/export/ttd-ukuran");

/**
 * TANDA TANGAN KETIK (DECISIONS 763). Permintaan user 2026-11-12: *"jika tanda
 * tangan belum diupload, bisakah kamu membuatkan tanda tangan dengan model font
 * handwriting untuk pengisi awal, dengan lebar menyesuaikan"* – supaya slot yang
 * namanya sudah ada tidak tercetak kosong.
 */

const ukuran = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return { w: m.width!, h: m.height!, alpha: m.hasAlpha, format: m.format };
};

/** Banyaknya piksel tinta (alfa > 0) dan rerata warnanya. */
async function tinta(b: Buffer) {
  const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  let bening = 0;
  let r = 0;
  let g = 0;
  let bl = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] === 0) {
      bening++;
      continue;
    }
    if (data[i + 3]! < 200) continue;
    n++;
    r += data[i]!;
    g += data[i + 1]!;
    bl += data[i + 2]!;
  }
  return { n, bening, r: r / n, g: g / n, b: bl / n };
}

describe("nama yang ditulis sebagai tanda tangan", () => {
  it("gelar depan dan belakang tidak ikut", () => {
    expect(namaUntukTtd("Ir. H. Ahmad Fauzi, S.T., M.T.")).toBe("Ahmad Fauzi");
    expect(namaUntukTtd("Dr. Sri Wahyuni, M.Si")).toBe("Sri Wahyuni");
    expect(namaUntukTtd("Hj. Siti Aminah")).toBe("Siti Aminah");
    expect(namaUntukTtd("Prof. Dr. Ir. Bambang")).toBe("Bambang");
  });

  it("singkatan yang bagian dari nama tetap ada", () => {
    expect(namaUntukTtd("Muh. Rizal")).toBe("Muh. Rizal");
    expect(namaUntukTtd("Moh. Hasan Basri")).toBe("Moh. Hasan Basri");
  });

  it("spasi dirapikan; nama kosong → tidak ada tanda tangan", () => {
    expect(namaUntukTtd("  Budi   Santoso  ")).toBe("Budi Santoso");
    expect(namaUntukTtd(null)).toBeNull();
    expect(namaUntukTtd("   ")).toBeNull();
    expect(namaUntukTtd("Ir.")).toBeNull();
  });
});

describe("pilihan huruf", () => {
  it("nama yang sama selalu memakai huruf yang sama", () => {
    expect(pilihHuruf("Budi Santoso")).toBe(pilihHuruf("Budi Santoso"));
    expect(pilihHuruf("Budi Santoso")).toBe(pilihHuruf("  budi   santoso "));
  });

  it("kedua huruf terpakai, supaya tiga tanda tangan satu halaman tidak seragam", () => {
    const nama = ["Budi Santoso", "Sari Koordinator", "Hadi Manajer", "Ahmad Mu'min", "Rina Wijaya", "Dedi Kurnia"];
    expect(new Set(nama.map(pilihHuruf)).size).toBe(HURUF_TTD.length);
  });
});

describe("gambar tanda tangan ketik", () => {
  it("PNG berlatar bening dengan tinta biru tua", async () => {
    const png = await ttdKetikPng("Budi Santoso");
    expect(png).not.toBeNull();
    expect(await ukuran(png!)).toMatchObject({ format: "png", alpha: true });
    const t = await tinta(png!);
    expect(t.n).toBeGreaterThan(500);
    expect(t.bening).toBeGreaterThan(t.n); // sebagian besar bidang tetap bening
    expect(t.b).toBeGreaterThan(t.r + 40); // biru, bukan hitam/abu
  });

  it("lebar mengikuti panjang nama; tinggi tetap setara", async () => {
    const pendek = await ukuran((await ttdKetikPng("Budi Santoso", { huruf: 0 }))!);
    const panjang = await ukuran((await ttdKetikPng("Sri Wahyuningsih Kusumawardani", { huruf: 0 }))!);
    expect(panjang.w).toBeGreaterThan(pendek.w * 1.8);
    expect(panjang.h).toBeLessThan(pendek.h * 1.8);
    // Memanjang seperti coretan, bukan kotak.
    expect(pendek.w / pendek.h).toBeGreaterThan(2.5);
  });

  it("huruf tulisan tangan benar-benar dipakai walau fontconfig rusak (dua huruf → dua bentuk)", async () => {
    const a = await ukuran((await ttdKetikPng("Budi Santoso", { huruf: 0 }))!);
    const b = await ukuran((await ttdKetikPng("Budi Santoso", { huruf: 1 }))!);
    // Bila keduanya jatuh ke huruf cadangan sistem, ukurannya akan sama persis.
    expect(`${a.w}x${a.h}`).not.toBe(`${b.w}x${b.h}`);
  });

  it("tanda baca dalam nama tidak merusak gambar", async () => {
    const png = await ttdKetikPng("Ahmad Mu'min & <Rekan>");
    expect(png).not.toBeNull();
    expect((await tinta(png!)).n).toBeGreaterThan(500);
  });

  it("nama kosong → tidak ada gambar", async () => {
    expect(await ttdKetikPng(null)).toBeNull();
    expect(await ttdKetikPng("  ")).toBeNull();
  });

  it("versi alamat data untuk halaman cetak", async () => {
    const url = await ttdKetikDataUrl("Budi Santoso");
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(await ttdKetikDataUrl(null)).toBeNull();
  });
});

describe("kotak tanda tangan ketik: setinggi coretan, lebarnya mengikuti nama", () => {
  // Kolom 300, ruang di atas nama 100 → coretan biasa 124×62 (BENTUK_TTD 2).
  const u = ukuranTtd(300, 100);

  it("nama sedang: tinggi sama dengan coretan biasa, lebar = tinggi × rasio", () => {
    const k = kotakTtdKetik(u, 300, 4);
    expect(k.tinggi).toBe(u.ttd.tinggi);
    expect(k.lebar).toBe(Math.round(u.ttd.tinggi * 4));
    expect(k.lebar).toBeGreaterThan(u.ttd.lebar);
  });

  it("nama panjang: berhenti di 90% kolom, tingginya yang mengalah (bentuk tidak diregangkan)", () => {
    const k = kotakTtdKetik(u, 300, 9);
    expect(k.lebar).toBe(Math.round((300 * PERSEN_TTD_KETIK) / 100));
    expect(k.tinggi).toBe(Math.round(k.lebar / 9));
    expect(k.tinggi).toBeLessThan(u.ttd.tinggi);
  });

  it("rasio tidak sah → kotak coretan biasa", () => {
    expect(kotakTtdKetik(u, 300, 0)).toEqual(u.ttd);
    expect(kotakTtdKetik(u, 300, Number.NaN)).toEqual(u.ttd);
  });

  it("rasio dibaca dari kepala PNG", async () => {
    const png = await sharp({ create: { width: 640, height: 80, channels: 4, background: "#0000" } }).png().toBuffer();
    expect(rasioPng(png)).toBe(8);
    expect(rasioPng(Buffer.from("bukan png sama sekali, cukup panjang"))).toBeNull();
  });
});
