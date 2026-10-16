/*
 * DOKUMENTASI FOTO PER SARANA & PRASARANA – aturan murni (DECISIONS 683).
 *
 * Permintaan user 2026-10-16: di sistem KKP (kawal-knmp) foto dipilah per
 * sarana & prasarana dan bisa dilihat berurutan dari progres kecil ke besar
 * (= tanggal awal ke akhir). MARLIN belum punya.
 */
import { describe, expect, it } from "vitest";
import { ringkasPerMinggu, titikDokumentasi, urutkanFoto } from "@/lib/dokumentasi-sarpras/murni";

const f = (id: string, tanggal: string, minggu: number | null, dibuat = 0, progres = 0) => ({
  id,
  tanggal,
  minggu,
  dibuat,
  progres,
});

describe("urutkanFoto", () => {
  it("tanggal laporan dulu, lalu urutan unggah", () => {
    const u = urutkanFoto([f("c", "2026-07-02", 1, 1), f("b", "2026-07-01", 1, 9), f("a", "2026-07-01", 1, 2)]);
    expect(u.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("ringkasPerMinggu", () => {
  it("satu foto per minggu kontrak – yang TERAKHIR di minggu itu", () => {
    const u = urutkanFoto([
      f("a", "2026-07-01", 1, 1),
      f("b", "2026-07-03", 1, 2),
      f("c", "2026-07-09", 2, 3),
      f("d", "2026-07-20", 4, 4),
    ]);
    expect(ringkasPerMinggu(u).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });

  it("tanpa SPMK (minggu kosong): dikelompokkan per 7 hari sejak foto pertama", () => {
    const u = urutkanFoto([
      f("a", "2026-07-01", null),
      f("b", "2026-07-07", null),
      f("c", "2026-07-08", null),
      f("d", "2026-07-15", null),
    ]);
    expect(ringkasPerMinggu(u).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });
});

describe("titikDokumentasi (0% – 50% – 100%)", () => {
  it("awal = foto pertama; 50% = foto pertama yang progresnya ≥ 50; 100% = foto pertama yang tuntas", () => {
    const u = [f("a", "2026-07-01", 1, 0, 3), f("b", "2026-07-10", 2, 0, 48), f("c", "2026-07-20", 3, 0, 61), f("d", "2026-08-01", 5, 0, 100), f("e", "2026-08-02", 5, 0, 100)];
    const t = titikDokumentasi(u);
    expect([t.awal?.id, t.tengah?.id, t.akhir?.id]).toEqual(["a", "c", "d"]);
  });

  it("belum sampai 50% / 100%: kosong, bukan foto lain yang diakui-akui", () => {
    const t = titikDokumentasi([f("a", "2026-07-01", 1, 0, 3), f("b", "2026-07-10", 2, 0, 20)]);
    expect([t.awal?.id, t.tengah, t.akhir]).toEqual(["a", null, null]);
  });

  it("tanpa foto: semua kosong", () => {
    expect(titikDokumentasi([])).toEqual({ awal: null, tengah: null, akhir: null });
  });
});
