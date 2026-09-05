import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LAPIS, Lapisan } from "@/components/ui/lapisan";

/**
 * LAPISAN LAYAR PENUH: URUTAN & PORTAL.
 *
 * Keluhan user 2026-09-05 di dasbor: *"tumpang tindih semua"* — peta beserta
 * legendanya menyala DI ATAS penampil foto, dan penampilnya berdiri di tengah
 * kartu, bukan di tengah layar.
 *
 * Dua hal yang dijaga di sini, dan keduanya sebab yang berbeda:
 *   1. ANGKA: tiap lapis harus mengalahkan kendali Leaflet (z-index 1000).
 *      Ini yang menjelaskan lapisan ber-z 40/50/60 tenggelam di bawah peta.
 *   2. TEMPAT: lapisan tidak boleh dirender di tempatnya berdiri. `fixed`
 *      diukur ke viewport HANYA bila tak ada leluhur ber-`transform`; begitu
 *      ada, ia terkurung di dalam kartu dan angka setinggi apa pun tak
 *      menolong. Karena itu render server tidak menghasilkan apa-apa: isinya
 *      baru dipasang di klien, ke `document.body`.
 */

/** z-index kendali Leaflet (leaflet.css) — acuan, bukan milik kita. */
const Z_KENDALI_PETA = 1000;

describe("skala lapisan layar penuh", () => {
  it("setiap lapis mengalahkan kendali peta", () => {
    for (const [nama, z] of Object.entries(LAPIS)) {
      expect(z, nama).toBeGreaterThan(Z_KENDALI_PETA);
    }
  });

  it("urutannya jelas: panel < kamera < penampil", () => {
    expect(LAPIS.panel).toBeLessThan(LAPIS.kamera);
    expect(LAPIS.kamera).toBeLessThan(LAPIS.penampil);
  });
});

describe("lapisan di-portal, bukan dirender di tempatnya", () => {
  it("render server tidak menghasilkan simpul apa pun (tak ada beda hidrasi)", () => {
    const html = renderToStaticMarkup(
      <div id="kartu">
        <Lapisan lapis="penampil">isi</Lapisan>
      </div>,
    );
    expect(html).toBe('<div id="kartu"></div>');
    expect(html).not.toContain("isi");
  });
});
