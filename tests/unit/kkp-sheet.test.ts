import { describe, expect, it } from "vitest";
import { buildKurvaSheet, orderCategoriesByRab } from "@/lib/scurve/kkp-sheet";

describe("buildKurvaSheet (profil mingguan per-kategori dari jadwal item – DECISIONS 082)", () => {
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

describe("angka tampil kolom Bobot (%) – kolom WAJIB menjumlah (Excel: =SUM(M1:MN))", () => {
  // Angka yang tidak habis dibagi: bila tiap sel dibulatkan sendiri-sendiri,
  // Σ sel minggu meleset dari bobot kategori dan `=SUM(...)` di Excel akan
  // menampilkan angka yang berbeda dari bobot resmi.
  const spread = (total: number, weeks: number[], n: number) => {
    const w = new Array<number>(n).fill(0);
    for (const i of weeks) w[i] = total / weeks.length;
    return w;
  };
  const N = 7;
  const cats = [
    { code: "I", name: "PEKERJAAN PERSIAPAN", weekly: spread(4.33, [0, 1, 2, 3, 4, 5, 6], N) },
    { code: "II", name: "PEKERJAAN TAMBATAN PERAHU", weekly: spread(11.19, [2, 3, 4], N) },
    { code: "III", name: "PEKERJAAN KANTOR PENGELOLA", weekly: spread(84.48, [1, 2, 3, 4, 5, 6], N) },
  ];
  const sheet = buildKurvaSheet({
    categories: cats,
    totalWeeks: N,
    contractStart: new Date(Date.UTC(2026, 3, 1)),
    actualCum: Array(N).fill(null),
    currentWeek: 1,
  });

  it("Σ weeklyShown == bobotShown PERSIS di tiap kategori", () => {
    for (const c of sheet.categories) {
      const sum = c.weeklyShown.reduce((s, v) => s + v, 0);
      expect(sum, c.name).toBeCloseTo(c.bobotShown, 9);
    }
  });

  it("Σ bobotShown == total tabel (100,00) dan bobotShown ≈ bobot penuh presisi", () => {
    const sum = sheet.categories.reduce((s, c) => s + c.bobotShown, 0);
    expect(sum).toBeCloseTo(100, 9);
    expect(sheet.totalBobotShown).toBe(100);
    for (const c of sheet.categories) expect(Math.abs(c.bobotShown - c.bobot), c.name).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it("minggu tanpa pekerjaan TETAP kosong; sel lain bergeser ≤0,002 dari nilai asli", () => {
    for (const c of sheet.categories) {
      c.weekly.forEach((raw, i) => {
        if (raw === 0) expect(c.weeklyShown[i], `${c.name} M${i + 1}`).toBe(0);
        else expect(Math.abs(c.weeklyShown[i] - raw), `${c.name} M${i + 1}`).toBeLessThanOrEqual(0.002 + 1e-9);
      });
    }
  });

  it("jadwal yang belum menutup 100% ditampilkan apa adanya, tidak dipaksa penuh", () => {
    const parsial = buildKurvaSheet({
      categories: [{ code: "I", name: "A", weekly: spread(90, [0, 1, 2], 3) }],
      totalWeeks: 3,
      contractStart: new Date(Date.UTC(2026, 3, 1)),
      actualCum: [null, null, null],
      currentWeek: 1,
    });
    expect(parsial.totalBobotShown).toBe(90);
    expect(parsial.categories[0].weeklyShown.reduce((s, v) => s + v, 0)).toBeCloseTo(90, 9);
  });
});

describe("angka tampil – properti bertahan di 300 jadwal acak (LCG deterministik)", () => {
  // Pembulatan penjaga-jumlah gampang bocor di kasus pinggir: kategori 1 minggu,
  // bobot sangat kecil, jadwal berlubang, minggu sangat banyak. Fuzz deterministik
  // (tanpa Math.random supaya kegagalan bisa diulang) menyapu bentuk-bentuk itu.
  let seed = 20260727;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  it("Σ weeklyShown == bobotShown, Σ bobotShown == totalBobotShown, jeda tetap 0", () => {
    for (let iter = 0; iter < 300; iter++) {
      const N = 1 + Math.floor(rnd() * 40);
      const nCat = 1 + Math.floor(rnd() * 12);
      // Bobot acak lalu dinormalisasi ke 100 (seperti bobot RAB sungguhan).
      const raw = Array.from({ length: nCat }, () => 0.05 + rnd() * 20);
      const scale = 100 / raw.reduce((s, v) => s + v, 0);
      const cats = raw.map((b, i) => {
        const bobot = b * scale;
        const start = Math.floor(rnd() * N);
        const len = 1 + Math.floor(rnd() * (N - start));
        const weekly = new Array<number>(N).fill(0);
        for (let w = start; w < start + len; w++) weekly[w] = bobot / len;
        return { code: `K${i + 1}`, name: `KATEGORI ${i + 1}`, weekly };
      });
      const sheet = buildKurvaSheet({
        categories: cats,
        totalWeeks: N,
        contractStart: new Date(Date.UTC(2026, 3, 1)),
        actualCum: Array(N).fill(null),
        currentWeek: 1,
      });

      const ctx = `iter ${iter} · N=${N} · kategori=${nCat}`;
      let totalShown = 0;
      for (const c of sheet.categories) {
        // Kolom "Bobot (%)" di Excel = SUM sel minggu → keduanya WAJIB identik.
        expect(c.weeklyShown.reduce((s, v) => s + v, 0), `${ctx} · ${c.name}`).toBeCloseTo(c.bobotShown, 9);
        c.weekly.forEach((rawV, i) => {
          if (rawV === 0) expect(c.weeklyShown[i], `${ctx} · ${c.name} M${i + 1} jeda`).toBe(0);
        });
        // Tidak ada sel yang dipakai jadi "tempat buang" galat pembulatan.
        // Batas per sel = pembulatan bobot kategori ke 2 desimal (≤0,01; seluruhnya
        // jatuh ke satu sel bila kategori cuma aktif 1 minggu) + pembulatan sel ke
        // 3 desimal (<0,001).
        c.weekly.forEach((rawV, i) => {
          expect(Math.abs(c.weeklyShown[i] - rawV), `${ctx} · ${c.name} M${i + 1} geser`).toBeLessThanOrEqual(0.011);
        });
        // Baris tampil tidak boleh menyimpang dari bobot sebenarnya lebih dari
        // satu digit terakhir kolom bobot (2 desimal).
        expect(Math.abs(c.bobotShown - c.bobot), `${ctx} · ${c.name} bobot`).toBeLessThanOrEqual(0.01 + 1e-9);
        totalShown += c.bobotShown;
      }
      expect(totalShown, `${ctx} · total`).toBeCloseTo(sheet.totalBobotShown, 9);
      expect(sheet.totalBobotShown, `${ctx} · total == 100`).toBe(100);
    }
  });
});

describe("orderCategoriesByRab", () => {
  // Kasus nyata: jadwal tersimpan datang dalam urutan penyimpanan, sehingga
  // nomor romawi di tabel KKP meloncat (XIV, XV, … lalu I, II).
  //
  // Identitasnya `lineageKey`, BUKAN nama — nama kategori bisa diganti user
  // ("ganti judul kategori"), dan pengurutan by-name membuat kategori yang baru
  // diganti judulnya terlempar ke belakang seolah bukan bagian RAB
  // (temuan user 2026-08-06).
  const rab = ["I", "II", "III", "IV", "V"];
  const key = (c: { lineageKey: string }) => c.lineageKey;

  it("mengembalikan urutan RAB, bukan urutan penyimpanan", () => {
    const stored = [
      { lineageKey: "IV" },
      { lineageKey: "V" },
      { lineageKey: "I" },
      { lineageKey: "II" },
      { lineageKey: "III" },
    ];
    expect(orderCategoriesByRab(stored, rab, key).map(key)).toEqual(rab);
  });

  it("judul kategori yang DIGANTI tetap di tempatnya", () => {
    // Inti temuannya: dulu baris ini kehilangan pasangannya dan jatuh ke
    // belakang daftar karena namanya tidak lagi cocok dengan RAB.
    const stored = [
      { lineageKey: "II", name: "PEKERJAAN REVETMENT" },
      { lineageKey: "I", name: "PEKERJAAN (kategori I – judul tidak ada di file)" },
      { lineageKey: "III", name: "PEKERJAAN TAMBATAN PERAHU" },
    ];
    expect(orderCategoriesByRab(stored, rab, key).map(key)).toEqual(["I", "II", "III"]);
  });

  it("kategori di luar daftar RAB ditaruh di belakang, urutan relatifnya utuh", () => {
    const stored = [
      { lineageKey: "XB" },
      { lineageKey: "II" },
      { lineageKey: "XA" },
      { lineageKey: "I" },
    ];
    expect(orderCategoriesByRab(stored, rab, key).map(key)).toEqual(["I", "II", "XB", "XA"]);
  });

  it("tidak membuang/menggandakan baris & tidak mengubah array asal", () => {
    const stored = rab.map((lineageKey) => ({ lineageKey, weekly: [1] }));
    const before = stored.map(key);
    const out = orderCategoriesByRab(stored, [...rab].reverse(), key);
    expect(out).toHaveLength(stored.length);
    expect(new Set(out.map(key)).size).toBe(stored.length);
    expect(stored.map(key)).toEqual(before);
  });

  it("kunci kembar di RAB memakai kemunculan pertama; daftar RAB kosong = urutan tetap", () => {
    const dua = [{ lineageKey: "A" }, { lineageKey: "B" }];
    expect(orderCategoriesByRab(dua, ["B", "A", "B"], key).map(key)).toEqual(["B", "A"]);
    expect(orderCategoriesByRab(dua, [], key).map(key)).toEqual(["A", "B"]);
  });
});
