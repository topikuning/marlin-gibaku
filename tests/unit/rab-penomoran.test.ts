import { describe, expect, it } from "vitest";
import { kodeTampil, penyusunJudul, type NodePenomoran } from "@/lib/rab/penomoran";

describe("kodeTampil – nomor RAB seperti di berkas", () => {
  it("membuang sufiks kode kembar; titik penutup berkas dipertahankan", () => {
    expect(kodeTampil("VI#2")).toBe("VI");
    expect(kodeTampil("III.1#2")).toBe("III.1");
    expect(kodeTampil("III.1.#2")).toBe("III.1.");
    expect(kodeTampil("1.1.1.")).toBe("1.1.1.");
    expect(kodeTampil(" 7 ")).toBe("7");
  });

  it("huruf yang diberi awalan induk oleh parser kembali ke hurufnya bila induknya tampil", () => {
    expect(kodeTampil("1.a", "1")).toBe("a");
    expect(kodeTampil("10.g", "10")).toBe("g");
    expect(kodeTampil("7.d.1", "7")).toBe("d.1");
    // Tanpa induk tampil, kode lengkap dipertahankan supaya tetap bisa diacu.
    expect(kodeTampil("1.a")).toBe("1.a");
  });

  it("nomor bertitik yang memang tertulis begitu di berkas tidak dipotong", () => {
    expect(kodeTampil("6.1", "6")).toBe("6.1");
    expect(kodeTampil("1.1.1.", "1")).toBe("1.1.1.");
    expect(kodeTampil("6.1.a", "6.1.")).toBe("a");
    expect(kodeTampil("III.1", "III")).toBe("III.1");
  });

  it("kode karangan parser untuk baris tanpa nomor tidak ditampilkan sebagai nomor", () => {
    expect(kodeTampil("~3")).toBe("");
    expect(kodeTampil("~1.b")).toBe("b");
    expect(kodeTampil("-.a")).toBe("a");
  });
});

const n = (id: string, parentId: string | null, kind: string, code: string, name = id): NodePenomoran => ({
  id,
  parentId,
  kind,
  code,
  name,
});

describe("penyusunJudul – baris judul di antara kategori dan item", () => {
  // Bentuk nyata RAB KKP: kategori → grup → item huruf; kategori → sub → item; sub → grup → item.
  const nodes = [
    n("II", null, "kategori", "II"),
    n("g1", "II", "grup", "1", "Pekerjaan Pondasi"),
    n("a", "g1", "item", "1.a", "Galian Tanah"),
    n("b", "g1", "item", "1.b", "Batu Belah"),
    n("lepas", "II", "item", "8", "Item langsung di kategori"),
    n("III", null, "kategori", "III"),
    n("s1", "III", "sub", "III.1", "Perancah"),
    n("p1", "s1", "item", "1", "Perancah jalan kerja"),
    n("s2", "III", "sub", "III.2", "Struktur"),
    n("g2", "s2", "grup", "1", "Tapak dan Kolom"),
    n("t", "g2", "item", "1.1.1.", "Pondasi Tapak"),
    n("ta", "g2", "item", "1.a", "Bekesting"),
  ];

  it("judul leluhur keluar sekali, tepat sebelum item pertamanya, berurutan dari atas", () => {
    const susun = penyusunJudul(nodes);
    expect(susun("a")).toEqual({ kode: "a", tingkat: 1, judul: [{ kode: "1", nama: "Pekerjaan Pondasi", tingkat: 0 }] });
    expect(susun("b")).toEqual({ kode: "b", tingkat: 1, judul: [] });
    expect(susun("lepas")).toEqual({ kode: "8", tingkat: 0, judul: [] });
    expect(susun("p1")).toEqual({ kode: "1", tingkat: 1, judul: [{ kode: "III.1", nama: "Perancah", tingkat: 0 }] });
    expect(susun("t")).toEqual({
      kode: "1.1.1.",
      tingkat: 2,
      judul: [
        { kode: "III.2", nama: "Struktur", tingkat: 0 },
        { kode: "1", nama: "Tapak dan Kolom", tingkat: 1 },
      ],
    });
    expect(susun("ta")).toEqual({ kode: "a", tingkat: 2, judul: [] });
  });

  it("node yang tidak dikenal tetap aman (tanpa judul, kode kosong)", () => {
    expect(penyusunJudul(nodes)("hilang")).toEqual({ kode: "", tingkat: 0, judul: [] });
  });

  it("pohon melingkar tidak membuat putaran tanpa akhir", () => {
    const rusak = [n("x", "y", "grup", "1"), n("y", "x", "grup", "2"), n("i", "x", "item", "1.a")];
    const hasil = penyusunJudul(rusak)("i");
    expect(hasil.kode).toBe("a");
    expect(hasil.judul.length).toBeLessThan(40);
  });
});
