// TANDA TANGAN & STEMPEL BENAR-BENAR MASUK KE PDF (DECISIONS 331).
//
// Cacat yang ditangkap berkas ini nyata dan sempat ter-merge ke `main`:
// `gambarTtdPdf` menyerahkan `Buffer` ke `doc.image()`, padahal pdfkit yang
// di-vendor (`assets/pdfkit-standalone.cjs`) menyangka argumen begitu sebagai
// NAMA BERKAS lalu memanggil `fs.readFileSync` — yang di bundel itu sengaja
// dikosongkan. Hasilnya `TypeError` yang ditelan `try/catch`, dan tanda tangan
// hilang DIAM-DIAM dari setiap PDF.
//
// Kenapa 19 uji `ttd-stempel-cetak.test.ts` tidak menangkapnya: semuanya menguji
// ARITMETIKA ukuran — angka yang benar, dihitung dengan benar, lalu diserahkan
// ke pemanggil yang membuangnya. Aritmetika yang betul tidak membuktikan
// gambarnya sampai ke kertas.
//
// Karena itu berkas ini tidak memeriksa satu angka pun. Ia merender PDF
// SUNGGUHAN lewat `createFormA4Doc` yang dipakai produksi, lalu membuktikan
// bahwa berkas hasilnya memuat objek gambar. Satu-satunya cara lolos adalah
// gambarnya memang tertempel.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

const { createFormA4Doc, docToBuffer } = await import("@/lib/pdf/document");
const { gambarTtdPdf } = await import("@/lib/pdf/ttd-gambar");
const sharp = (await import("sharp")).default;

/** PNG kecil sungguhan — bukan bita palsu; pdfkit membaca header PNG-nya. */
async function pngContoh(warna: string): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 60, channels: 3, background: warna } })
    .png()
    .toBuffer();
}

/**
 * Berapa objek gambar (XObject) yang tertanam di PDF. Penanda `/Subtype/Image`
 * hanya ditulis pdfkit kalau gambarnya BENAR-BENAR diproses; kalau
 * `doc.image()` melempar dan ditelan, penanda ini tidak pernah ada.
 */
function jumlahGambar(pdf: Buffer): number {
  const teks = pdf.toString("latin1");
  return (teks.match(/\/Subtype\s*\/Image/g) ?? []).length;
}

async function render(berkas: { ttd: Buffer | null; stempel: Buffer | null }) {
  const doc = createFormA4Doc({ title: "uji" });
  gambarTtdPdf(doc, berkas, {
    xTengah: 200,
    yDasar: 400,
    lebarKolom: 260,
    tinggiCelah: 34,
  });
  return docToBuffer(doc);
}

describe("gambar tanda tangan & stempel benar-benar tertanam di PDF", () => {
  it("stempel + tanda tangan menghasilkan DUA objek gambar", async () => {
    const pdf = await render({ ttd: await pngContoh("#123456"), stempel: await pngContoh("#654321") });
    expect(jumlahGambar(pdf)).toBe(2);
  });

  it("hanya stempel → satu objek gambar", async () => {
    const pdf = await render({ ttd: null, stempel: await pngContoh("#654321") });
    expect(jumlahGambar(pdf)).toBe(1);
  });

  it("hanya tanda tangan → satu objek gambar", async () => {
    const pdf = await render({ ttd: await pngContoh("#123456"), stempel: null });
    expect(jumlahGambar(pdf)).toBe(1);
  });

  it("tanpa gambar → PDF tetap terbit, tanpa objek gambar", async () => {
    // Ruang kosong untuk tanda tangan pena. Yang penting: tidak melempar.
    const pdf = await render({ ttd: null, stempel: null });
    expect(jumlahGambar(pdf)).toBe(0);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("gambar rusak tidak menggagalkan seluruh PDF", async () => {
    // Janji modulnya: satu gambar rusak hanya menghilangkan gambar itu.
    const pdf = await render({ ttd: Buffer.from("ini bukan gambar"), stempel: null });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(jumlahGambar(pdf)).toBe(0);
  });
});
