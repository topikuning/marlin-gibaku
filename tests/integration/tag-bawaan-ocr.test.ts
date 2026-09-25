// TAG BAWAAN FOTO – OCR SUNGGUHAN (DECISIONS 617).
//
// Foto lapangan asli (tests/fixtures/IMG20260801WA0035.jpg) diberi cap
// tiruan aplikasi kamera di posisi berbeda, lalu dibaca lewat jalur yang sama
// dengan unggahan. Foto aslinya sendiri adalah jebakan: papan bertuliskan
// "KECAMATAN PACIRAN – KAB/KOTA LAMONGAN" yang BUKAN cap lokasi.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { bacaTulisanFoto } = await import("@/lib/photo-stamp/ocr");
const { nilaiTagBawaan } = await import("@/lib/photo-stamp/tag-bawaan");

const FOTO = readFileSync(new URL("../fixtures/IMG20260801WA0035.jpg", import.meta.url));
const WILAYAH = ["Kranji", "Paciran", "Lamongan", "Jawa Timur"];

async function denganCap(opts: { x: number; y: number; baris: string[]; kotak: boolean; fs: number }) {
  const { width: w = 0, height: h = 0 } = await sharp(FOTO).metadata();
  const lh = Math.round(opts.fs * 1.3);
  const lebar = Math.max(...opts.baris.map((l) => l.length * opts.fs * 0.56)) + 30;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const teks = opts.baris
    .map(
      (l, j) =>
        `<text x="${opts.x + 15}" y="${opts.y + 10 + (j + 1) * lh - lh * 0.25}" font-family="DejaVu Sans" font-size="${opts.fs}" fill="white" ${opts.kotak ? "" : 'stroke="black" stroke-width="1" paint-order="stroke"'}>${esc(l)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${opts.kotak ? `<rect x="${opts.x}" y="${opts.y}" width="${lebar}" height="${opts.baris.length * lh + 20}" fill="black" fill-opacity="0.4"/>` : ""}${teks}</svg>`;
  return sharp(FOTO).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 80 }).toBuffer();
}

async function nilai(gambar: Buffer) {
  const teks = await bacaTulisanFoto(gambar);
  expect(teks, "OCR tidak menghasilkan apa pun").not.toBeNull();
  return nilaiTagBawaan(teks!, { namaWilayah: WILAYAH });
}

describe("OCR tag bawaan pada foto lapangan sungguhan", { timeout: 60_000 }, () => {
  it("foto tanpa cap (papan kecamatan/kabupaten) → tidak ada yang disembunyikan", async () => {
    const h = await nilai(FOTO);
    expect(h).toMatchObject({ lokasi: false, waktu: false });
  });

  it("cap kotak kanan-bawah: tanggal + alamat + koordinat → keduanya", async () => {
    const h = await nilai(
      await denganCap({
        x: 1040,
        y: 710,
        kotak: true,
        fs: 26,
        baris: ["25/09/2026 14:32", "Jl. Raya Paciran, Kec. Paciran", "Lat -6.8712 Long 112.3721"],
      }),
    );
    expect(h).toMatchObject({ lokasi: true, waktu: true });
  });

  it("cap tanpa kotak kiri-bawah: tanggal + nama wilayah → keduanya", async () => {
    const h = await nilai(
      await denganCap({ x: 30, y: 640, kotak: false, fs: 30, baris: ["Jumat, 25 Sep 2026 09:15", "Kranji, Paciran, Lamongan"] }),
    );
    expect(h.waktu).toBe(true);
    expect(h.lokasi).toBe(true);
  });

  it("hanya tanggal → hanya tanggal yang disembunyikan", async () => {
    const h = await nilai(await denganCap({ x: 1180, y: 30, kotak: true, fs: 30, baris: ["2026-09-25 07:48"] }));
    expect(h).toMatchObject({ lokasi: false, waktu: true });
  });

  it("alamat tanpa tanggal → TIDAK dianggap cap lokasi (bisa papan/spanduk)", async () => {
    const h = await nilai(
      await denganCap({ x: 30, y: 780, kotak: true, fs: 26, baris: ["Jl. Raya Paciran, Kec. Paciran, Kab. Lamongan"] }),
    );
    expect(h).toMatchObject({ lokasi: false, waktu: false });
  });
});
