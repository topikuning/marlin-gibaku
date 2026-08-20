import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiklusPanel } from "@/app/(app)/paket/[id]/siklus-panel";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * PANEL SIKLUS PAKET (DECISIONS 386).
 *
 * Yang dijaga di sini bukan tata letaknya melainkan tiga hal yang kalau salah
 * membuat panelnya berbohong pelan-pelan:
 *
 *   1. Tahap yang belum dilalui berbunyi "belum", bukan kosong. Kolom kosong
 *      terbaca sebagai data yang hilang, padahal "belum dilalui" adalah
 *      keadaan yang memang benar.
 *   2. Tahap aktif ditandai, dan hanya satu.
 *   3. Ketujuh tahap selalu tampil, termasuk yang belum tercapai – panel yang
 *      memotong tahap di depan menghilangkan gambaran sisa jalannya.
 */

function render(current: PackageStage, masuk: Map<PackageStage, Date>): string {
  return renderToStaticMarkup(<SiklusPanel current={current} masuk={masuk} />);
}

const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("panel siklus paket", () => {
  it("menampilkan KETUJUH tahap, termasuk yang belum tercapai", () => {
    const html = render("kontrak", new Map());
    for (const nama of [
      "Prospek",
      "Tender",
      "Penetapan",
      "Kontrak",
      "Pelaksanaan",
      "Serah Terima",
      "Selesai",
    ]) {
      expect(html).toContain(nama);
    }
  });

  it("tahap tanpa tanggal ditulis “belum”, bukan dikosongkan", () => {
    const html = render("tender", new Map([["tender", tgl("2026-04-03")]]));
    expect(html).toContain("3 Apr 2026");
    // Enam tahap sisanya belum punya tanggal.
    expect(html.split("belum").length - 1).toBe(6);
  });

  it("menandai tahap aktif, dan hanya satu", () => {
    const html = render("pelaksanaan", new Map());
    expect(html.split('aria-current="step"').length - 1).toBe(1);
  });

  it("tanggal per tahap diambil dari peta, bukan dikarang dari urutan", () => {
    const html = render(
      "pelaksanaan",
      new Map<PackageStage, Date>([
        ["prospek", tgl("2026-03-27")],
        ["tender", tgl("2026-04-03")],
        ["pelaksanaan", tgl("2026-04-24")],
      ]),
    );
    expect(html).toContain("27 Mar 2026");
    expect(html).toContain("3 Apr 2026");
    expect(html).toContain("24 Apr 2026");
    // Penetapan & Kontrak dilewati pencatatannya → tetap "belum", tidak ditebak.
    expect(html.split("belum").length - 1).toBe(4);
  });

  it("stage `batal` tidak ada di deret – tidak ada tahap yang ditandai aktif", () => {
    // `batal` sengaja di luar PACKAGE_STAGE_ORDER: ia bukan kemajuan,
    // melainkan penghentian, dan ditandai banner tersendiri di layout.
    const html = render("batal", new Map());
    expect(html).not.toContain('aria-current="step"');
    expect(html).toContain("Prospek");
  });
});
