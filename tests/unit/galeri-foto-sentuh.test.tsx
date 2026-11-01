import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import type { PhotoView } from "@/lib/photos";

/**
 * TOMBOL FOTO HARUS BISA DISENTUH JARI (DECISIONS 730).
 *
 * Keluhan user 2026-11-01 (tangkapan layar panel "Foto tanpa pekerjaan" di
 * ponsel): *"apa menurutmu ini tidak super terlalu kecil? kamu gak mikir ux di
 * mobile, klik atau touch di area sekecil itu"*.
 *
 * Dulu tombol hapus dan "kembalikan" ditempel di POJOK thumbnail 56 px, masing-
 * masing ±22 px (p-1 + ikon 14 px), berdempetan dengan area "buka foto" di
 * bawahnya. Pedoman sentuh minimal 44 px; meleset sedikit = membuka foto, atau
 * lebih buruk, menekan Hapus.
 *
 * Yang dijaga:
 *   1. Kisi thumbnail tidak lagi memuat tombol aksi apa pun – seluruh thumbnail
 *      satu sasaran: buka foto. Hapus/putar ada di tampilan foto besar.
 *   2. Kisi yang punya aksi MENYEBUT jalannya, supaya hapus yang pindah tempat
 *      tidak terbaca "hilang".
 *   3. Tata letak "baris" (panel yang tugasnya memang aksi): tiap foto punya
 *      tombol berlabel setinggi 44 px (h-11), bukan ikon di pojok.
 */
const foto = (id: string): PhotoView =>
  ({ id, thumbUrl: `https://contoh.test/${id}.jpg`, fullUrl: `https://contoh.test/${id}-besar.jpg`, lat: -6.2, lng: 106.8 }) as PhotoView;
const aksi = async () => undefined;
const tombol = (html: string) => [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);

describe("galeri foto: sasaran sentuh", () => {
  it("kisi: tidak ada tombol aksi di atas thumbnail; satu-satunya tombol = buka foto", () => {
    const html = renderToStaticMarkup(
      <PhotoGallery photos={[foto("a"), foto("b")]} thumbClass="h-14 w-14" canDelete deleteAction={aksi} rotateAction={aksi} />,
    );
    const semua = tombol(html);
    expect(semua).toHaveLength(2);
    for (const b of semua) expect(b).toContain('aria-label="Buka foto"');
    expect(html).not.toContain("Hapus foto");
  });

  it("kisi yang punya aksi menyebut jalannya; kisi tanpa aksi tidak", () => {
    const denganAksi = renderToStaticMarkup(<PhotoGallery photos={[foto("a")]} canDelete deleteAction={aksi} />);
    expect(denganAksi).toContain("Ketuk foto untuk");
    const tanpaAksi = renderToStaticMarkup(<PhotoGallery photos={[foto("a")]} />);
    expect(tanpaAksi).not.toContain("Ketuk foto untuk");
  });

  it("baris: tiap foto punya tombol berlabel setinggi 44 px untuk kembalikan dan hapus", () => {
    const html = renderToStaticMarkup(
      <PhotoGallery
        photos={[foto("a")]}
        tataLetak="baris"
        canDelete
        deleteAction={aksi}
        reuse={{ label: "Kembalikan ke Foto Cepat", run: aksi }}
      />,
    );
    const aksiBaris = tombol(html).filter((b) => !b.includes('aria-label="Buka foto"'));
    expect(aksiBaris.map((b) => b.replace(/<[^>]+>/g, "").trim())).toEqual(["Kembalikan ke Foto Cepat", "Hapus"]);
    for (const b of aksiBaris) expect(b).toMatch(/\bmin-h-11\b/);
  });
});
