/*
 * URUTAN GAMBAR BLOK TANDA TANGAN PDF (DECISIONS 412).
 *
 * Keluhan user 2026-08-22 dengan tangkapan layar: stempel perusahaan menutupi
 * tulisan "Dibuat Oleh : / Kontraktor Pelaksana / CV. …".
 *
 * Sebabnya URUTAN MENGGAMBAR, bukan ukuran atau posisi. PDF tidak punya
 * z-index: yang digambar belakangan menimpa yang lebih dulu. Stempel hasil
 * pindaian membawa latar putih yang tidak tembus pandang, jadi ia benar-benar
 * menghapus teks di bawahnya.
 *
 * Uji ini memakai `doc` TIRUAN yang mencatat urutan panggilan. Itu bukan
 * kekurangan — urutan panggilan PERSIS itulah yang jadi lapisan di berkas
 * jadinya, jadi yang diperiksa memang mekanismenya, bukan tiruan mekanisme.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { blokTandaTanganPdf } = await import("@/lib/pdf/ttd-gambar");

type Jejak = "image" | "text";

function docTiruan(jejak: Jejak[]) {
  return {
    image: (..._a: unknown[]) => {
      jejak.push("image");
    },
    text: (..._a: unknown[]) => {
      jejak.push("text");
    },
  } as unknown as Parameters<typeof blokTandaTanganPdf>[0];
}

const OPSI = { xTengah: 100, yDasar: 200, lebarKolom: 180, ruangDiAtasNama: 70 };
const isi = (n: string) => Buffer.from(n);

describe("stempel di belakang, teks paling atas", () => {
  it("SEMUA gambar digambar sebelum teks", () => {
    const jejak: Jejak[] = [];
    const doc = docTiruan(jejak);
    blokTandaTanganPdf(
      doc,
      [
        { berkas: { ttd: isi("ttd-a"), stempel: isi("stempel-a") }, opsi: OPSI },
        { berkas: { ttd: isi("ttd-b"), stempel: isi("stempel-b") }, opsi: OPSI },
      ],
      () => {
        (doc as unknown as { text: (s: string) => void }).text("Dibuat Oleh :");
        (doc as unknown as { text: (s: string) => void }).text("Kontraktor Pelaksana");
        return 42;
      },
    );

    // 4 gambar (2 stempel + 2 coretan), lalu 2 teks — tidak boleh ada satu pun
    // `image` yang muncul SESUDAH `text`.
    expect(jejak).toEqual(["image", "image", "image", "image", "text", "text"]);
    expect(jejak.lastIndexOf("image")).toBeLessThan(jejak.indexOf("text"));
  });

  it("stempel digambar sebelum coretan tanda tangan", () => {
    /*
     * Lapisan di dalam blok itu sendiri: stempel PALING belakang, coretan di
     * atasnya. Meniru cara orang membubuhkannya — tinta tanda tangan tetap
     * terbaca walau stempel menimpa sisi kirinya.
     */
    const urut: string[] = [];
    const doc = {
      image: (data: ArrayBuffer) => urut.push(Buffer.from(data).toString()),
      text: () => urut.push("TEKS"),
    } as unknown as Parameters<typeof blokTandaTanganPdf>[0];

    blokTandaTanganPdf(
      doc,
      [{ berkas: { ttd: isi("CORETAN"), stempel: isi("STEMPEL") }, opsi: OPSI }],
      () => (doc as unknown as { text: () => void }).text(),
    );
    expect(urut).toEqual(["STEMPEL", "CORETAN", "TEKS"]);
  });

  it("nilai kembalian teks diteruskan apa adanya", () => {
    // Pemanggilnya memakai `y` berikutnya dari `gridRow`; kalau pembungkus ini
    // menelannya, tata letak halaman berikutnya bergeser tanpa ada yang tahu.
    const doc = docTiruan([]);
    expect(blokTandaTanganPdf(doc, [], () => 123)).toBe(123);
  });

  it("tanpa gambar sama sekali, teksnya tetap digambar", () => {
    // Lokasi yang belum mengunggah tanda tangan harus tetap tercetak blok
    // kosongnya untuk ditandatangani pena.
    const jejak: Jejak[] = [];
    const doc = docTiruan(jejak);
    blokTandaTanganPdf(doc, [], () => (doc as unknown as { text: () => void }).text());
    expect(jejak).toEqual(["text"]);
  });
});
