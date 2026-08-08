// FOTO DI PDF DOKUMENTASI HARUS BISA DIKLIK KE GAMBAR PENUH.
//
// Permintaan user 2026-08-07: *"untuk foto format kkp, fotonya harusnya juga
// bisa diklik ke ukuran yang lebih besar/cloud. tapi tidak perlu di crop, apa
// adanya seperti sekarang, hanya beri link ke gambar yang lebih besar."*
//
// Kenapa diuji sampai ke byte PDF-nya: tautan di PDF bukan markup yang terlihat
// saat diperiksa sepintas, melainkan ANOTASI terpisah dari gambarnya. Kalau
// `doc.link()` tidak dipanggil — atau dipanggil pada koordinat/urutan yang
// salah sehingga tidak ikut tersimpan — dokumennya tetap terbit, fotonya tetap
// tampak normal, dan tidak ada satu pun tanda bahwa kotaknya sebenarnya mati.
// Cacat senyap seperti itu baru ketahuan setelah dokumennya dikirim ke KKP dan
// ada yang mencoba menekan fotonya.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createFormA4Doc, docToBuffer } from "@/lib/pdf/document";
import { gambarDokumentasi, type FotoDok } from "@/lib/pdf/harian-kkp-lampiran";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";

const TAUTAN = "https://marlin.uji/api/foto/TOKENUJI";

const d = { contractorFirm: "PT Uji", contractorAddress: "Jl. Uji No. 1" } as unknown as KkpDailyData;

async function gambarContoh(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: "#999999" } })
    .jpeg()
    .toBuffer();
}

async function render(foto: FotoDok[]): Promise<Buffer> {
  const doc = createFormA4Doc();
  gambarDokumentasi(doc, d, foto, () => doc.addPage());
  return docToBuffer(doc);
}

describe("tautan foto di halaman dokumentasi PDF", () => {
  it("menghasilkan anotasi /Link berisi URL gambar penuh", async () => {
    const pdf = await render([
      { buf: await gambarContoh(), pekerjaan: "Galian", kategori: "DERMAGA", bobot: 1, link: TAUTAN },
    ]);
    expect(pdf.includes(Buffer.from("/Link"))).toBe(true);
    expect(pdf.includes(Buffer.from(TAUTAN))).toBe(true);
  });

  it("tanpa tautan, TIDAK ada anotasi yang dikarang", async () => {
    // Batas yang penting: origin tak diketahui (mis. dipanggil dari cron di
    // luar request) harus berarti "tidak bisa diklik", bukan tautan asal jadi
    // yang membuka halaman galat di depan pemberi kerja.
    const pdf = await render([
      { buf: await gambarContoh(), pekerjaan: "Galian", kategori: "DERMAGA", bobot: 1, link: null },
    ]);
    expect(pdf.includes(Buffer.from("/Link"))).toBe(false);
    // Halamannya tetap terbit — bukti tidak ikut hilang.
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("foto yang GAGAL ditempel pun tetap ditautkan", async () => {
    // Justru di situ orang paling butuh melihat aslinya. Kalau `doc.link()`
    // ikut berada di dalam try gambar, kasus ini kehilangan tautannya diam-diam.
    const rusak = Buffer.from("ini bukan gambar");
    const pdf = await render([
      { buf: rusak, pekerjaan: "Galian", kategori: "DERMAGA", bobot: null, link: TAUTAN },
    ]);
    expect(pdf.includes(Buffer.from(TAUTAN))).toBe(true);
  });
});
