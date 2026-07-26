import { describe, expect, it } from "vitest";
import { buildKurvaSheet, orderCategoriesByRab } from "@/lib/scurve/kkp-sheet";

describe("buildKurvaSheet (profil mingguan per-kategori dari jadwal item — DECISIONS 082)", () => {
  // Profil mingguan per kategori (increment %/minggu) — sudah dihitung upstream.
  const categories = [
    { code: "I", name: "PEKERJAAN PERSIAPAN", weekly: [8, 6, 4, 0, 0, 0] },
    { code: "II", name: "PEKERJAAN STRUKTUR", weekly: [0, 0, 12, 24, 12, 0] },
    { code: "III", name: "PEKERJAAN PENERANGAN", weekly: [0, 0, 0, 0, 16, 18] },
  ];
  const contractStart = new Date(Date.UTC(2026, 2, 1)); // 1 Mar 2026
  const sheet = buildKurvaSheet({
    categories,
    totalWeeks: 6,
    contractStart,
    actualCum: Array(6).fill(null),
    currentWeek: 1,
  });

  it("kumulatif rencana monotonik & berakhir 100", () => {
    for (let i = 1; i < sheet.kumulatifRencana.length; i++) {
      expect(sheet.kumulatifRencana[i]).toBeGreaterThanOrEqual(sheet.kumulatifRencana[i - 1] - 1e-9);
    }
    expect(sheet.kumulatifRencana.at(-1)).toBeCloseTo(100, 5);
  });

  it("rencana/minggu = Σ kategori; bobot kategori = Σ weekly-nya", () => {
    expect(sheet.rencanaPerWeek[2]).toBeCloseTo(4 + 12, 5); // persiapan mgg3 + struktur mgg3
    expect(sheet.categories[2].bobot).toBeCloseTo(34, 5); // penerangan total
  });

  it("PENERANGAN nol sampai minggu 4, terisi 5–6 (presedensi terjaga)", () => {
    const pen = sheet.categories[2];
    for (let w = 0; w < 4; w++) expect(pen.weekly[w]).toBe(0);
    expect(pen.weekly[4]).toBeGreaterThan(0);
    expect(pen.weekly[5]).toBeGreaterThan(0);
  });

  it("kolom dikelompokkan per bulan; total span = totalWeeks", () => {
    const span = sheet.monthGroups.reduce((s, g) => s + g.span, 0);
    expect(span).toBe(6);
    expect(sheet.monthGroups[0].label).toBe("MARET");
  });

  it("realisasi null → deviasi null", () => {
    expect(sheet.deviasi.every((d) => d === null)).toBe(true);
  });
});

describe("orderCategoriesByRab", () => {
  // Kasus nyata: jadwal tersimpan datang dalam urutan penyimpanan, sehingga
  // nomor romawi di tabel KKP meloncat (XIV, XV, … lalu I, II).
  const rab = [
    "PEKERJAAN PERSIAPAN", // I
    "PEKERJAAN REVETMENT", // II
    "PEKERJAAN TAMBATAN PERAHU", // III
    "PEKERJAAN JALAN LINGKUNGAN DAN SALURAN", // IV
    "PEKERJAAN LANDSKAPING KAWASAN", // V
  ];

  it("mengembalikan urutan RAB, bukan urutan penyimpanan", () => {
    const stored = [
      { name: "PEKERJAAN JALAN LINGKUNGAN DAN SALURAN" },
      { name: "PEKERJAAN LANDSKAPING KAWASAN" },
      { name: "PEKERJAAN PERSIAPAN" },
      { name: "PEKERJAAN REVETMENT" },
      { name: "PEKERJAAN TAMBATAN PERAHU" },
    ];
    expect(orderCategoriesByRab(stored, rab).map((c) => c.name)).toEqual(rab);
  });

  it("kategori di luar daftar RAB ditaruh di belakang, urutan relatifnya utuh", () => {
    const stored = [
      { name: "PEKERJAAN TAMBAHAN B" },
      { name: "PEKERJAAN REVETMENT" },
      { name: "PEKERJAAN TAMBAHAN A" },
      { name: "PEKERJAAN PERSIAPAN" },
    ];
    expect(orderCategoriesByRab(stored, rab).map((c) => c.name)).toEqual([
      "PEKERJAAN PERSIAPAN",
      "PEKERJAAN REVETMENT",
      "PEKERJAAN TAMBAHAN B",
      "PEKERJAAN TAMBAHAN A",
    ]);
  });

  it("tidak membuang/menggandakan baris & tidak mengubah array asal", () => {
    const stored = rab.map((name) => ({ name, weekly: [1] }));
    const before = stored.map((c) => c.name);
    const out = orderCategoriesByRab(stored, [...rab].reverse());
    expect(out).toHaveLength(stored.length);
    expect(new Set(out.map((c) => c.name)).size).toBe(stored.length);
    expect(stored.map((c) => c.name)).toEqual(before);
  });

  it("nama kembar di RAB memakai kemunculan pertama; daftar RAB kosong = urutan tetap", () => {
    expect(orderCategoriesByRab([{ name: "A" }, { name: "B" }], ["B", "A", "B"]).map((c) => c.name)).toEqual(["B", "A"]);
    expect(orderCategoriesByRab([{ name: "A" }, { name: "B" }], []).map((c) => c.name)).toEqual(["A", "B"]);
  });
});
