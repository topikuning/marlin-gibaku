/*
 * NAMA BERKAS SAAT DIUNDUH (DECISIONS 676).
 *
 * Laporan user 2026-10-14: dokumen dari /dokumen tersimpan bernama
 * "ZG9jdW1lbnRzLzIwMjYv….tmwvg0.hmrEsx…" – token alamat arsip, tanpa
 * ekstensi yang jelas. Yang diminta: nama seperti saat diunggah, atau lebih rapi.
 */
import { describe, expect, it } from "vitest";
import {
  bacaRuasNama,
  bolehTampilLangsung,
  kepalaDisposisi,
  namaUnduhan,
  ruasNama,
} from "@/lib/penyimpanan/nama-unduhan";

const PDF = "application/pdf";

describe("namaUnduhan", () => {
  it("nama unggahan dipakai apa adanya", () => {
    expect(namaUnduhan("SPBBJ-CV.Inti-Prakarsa.pdf", PDF)).toBe("SPBBJ-CV.Inti-Prakarsa.pdf");
    expect(namaUnduhan("Kontrak Batu Putih.PDF", PDF)).toBe("Kontrak Batu Putih.PDF");
    expect(namaUnduhan("foto lokasi.jpeg", "image/jpeg")).toBe("foto lokasi.jpeg");
  });

  it("ekstensi ditambahkan bila tidak ada atau tidak sesuai isinya", () => {
    expect(namaUnduhan("CV.Inti", PDF)).toBe("CV.Inti.pdf");
    expect(namaUnduhan("Berita Acara", PDF)).toBe("Berita Acara.pdf");
    expect(namaUnduhan("rekap", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("rekap.xlsx");
  });

  it("jenis yang tidak dikenal: nama tidak diberi ekstensi karangan", () => {
    expect(namaUnduhan("gambar.dwg", "application/octet-stream")).toBe("gambar.dwg");
  });

  it("folder, karakter terlarang, dan spasi berlebih dibuang", () => {
    expect(namaUnduhan("C:\\Users\\Hery\\Desktop\\SPMK  final?.pdf", PDF)).toBe("SPMK final.pdf");
    expect(namaUnduhan("a/b/Surat: \"Teguran\" <1>.pdf", PDF)).toBe("Surat Teguran 1.pdf");
    expect(namaUnduhan("baris\nbaru.pdf", PDF)).toBe("barisbaru.pdf");
  });

  it("nama kosong memakai cadangan", () => {
    expect(namaUnduhan("", PDF)).toBe("dokumen.pdf");
    expect(namaUnduhan(null, PDF, "surat")).toBe("surat.pdf");
    expect(namaUnduhan("...", "image/png", "lampiran")).toBe("lampiran.png");
  });

  it("nama sangat panjang dipotong, ekstensinya tetap", () => {
    const nama = namaUnduhan(`${"Surat Perjanjian Pembangunan Kampung Nelayan ".repeat(8)}.pdf`, PDF);
    expect(nama.length).toBeLessThanOrEqual(150);
    expect(nama.endsWith(".pdf")).toBe(true);
    expect(nama.startsWith("Surat Perjanjian")).toBe(true);
  });
});

describe("kepalaDisposisi", () => {
  it("PDF dan gambar dibuka di tab dengan nama aslinya", () => {
    expect(kepalaDisposisi("Kontrak.pdf", PDF)).toBe(`inline; filename="Kontrak.pdf"; filename*=UTF-8''Kontrak.pdf`);
  });

  it("nama non-ASCII: cadangan ASCII + UTF-8 lengkap", () => {
    const h = kepalaDisposisi("Berita Acara – Café (1).pdf", PDF);
    expect(h).toContain(`filename="Berita Acara _ Cafe (1).pdf"`);
    expect(h).toContain("filename*=UTF-8''Berita%20Acara%20%E2%80%93%20Caf%C3%A9%20%281%29.pdf");
  });

  it("jenis yang bisa dijalankan peramban (HTML, SVG) tidak pernah dibuka di tab", () => {
    expect(kepalaDisposisi("x.html", "text/html")).toMatch(/^attachment;/);
    expect(kepalaDisposisi("x.svg", "image/svg+xml")).toMatch(/^attachment;/);
    expect(bolehTampilLangsung("image/png")).toBe(true);
    expect(bolehTampilLangsung("application/pdf; charset=binary")).toBe(true);
  });

  it("baris baru di nama tidak bisa menyusup jadi header lain", () => {
    expect(kepalaDisposisi("a\r\nSet-Cookie: x.pdf", PDF)).not.toMatch(/[\r\n]/);
  });
});

describe("ruas nama di alamat", () => {
  it("bolak-balik utuh", () => {
    const nama = "SPPBJ #2 – 50% selesai.pdf";
    expect(bacaRuasNama(ruasNama(nama))).toBe(nama);
    // Next sudah men-decode: ruas yang bukan encoding sah dipakai apa adanya.
    expect(bacaRuasNama("50% selesai.pdf")).toBe("50% selesai.pdf");
  });
});
