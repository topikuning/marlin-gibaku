import { describe, expect, it } from "vitest";
import {
  classifyTrade,
  computeTradeWindows,
  autoCategorySchedule,
  cumulativeFromWeeklyRows,
  curveFromCategorySchedule,
  DEFAULT_CONTRACT_DAYS,
  generateScurve,
  rescheduleToCurve,
  scheduleItems,
  segmentsFromWeekly,
  smoothstep,
  TRADE_BANDS,
  TYPICAL_TRADE_MIX,
  weeklyFromSegments,
} from "@/lib/scurve/generate";

describe("smoothstep", () => {
  it("nilai batas dan tengah", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5); // 3(0.25) − 2(0.125) = 0.5
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });
});

describe("generateScurve", () => {
  const categories = [
    { name: "PEKERJAAN PERSIAPAN", totalValue: 100_000_000n },
    { name: "PEKERJAAN PONDASI BANGUNAN", totalValue: 400_000_000n },
    { name: "PEKERJAAN BANGUNAN BALAI NELAYAN", totalValue: 300_000_000n },
    { name: "PEKERJAAN LANDSKAPING", totalValue: 200_000_000n },
  ];
  const curve = generateScurve(categories, DEFAULT_CONTRACT_DAYS);

  it("panjang = ceil(hari/7) minggu", () => {
    expect(curve.length).toBe(Math.ceil(150 / 7)); // 22
  });

  it("monotonik naik", () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
  });

  it("berakhir di 100 (±0.01)", () => {
    expect(curve[curve.length - 1]).toBeCloseTo(100, 2);
  });

  it("kategori nilai 0 diabaikan tanpa merusak kurva", () => {
    const c2 = generateScurve(
      [...categories, { name: "PEKERJAAN KOSONG", totalValue: 0n }],
      150,
    );
    expect(c2).toEqual(curve);
  });
});

describe("classifyTrade", () => {
  it("keyword nama item (tabel lama)", () => {
    expect(classifyTrade("Pekerjaan Pondasi Batu Kali", "")).toBe("pondasi");
    expect(classifyTrade("Galian tanah biasa sedalam 1 m", "")).toBe("tanah");
    expect(classifyTrade("Beton K-250 ready mix", "")).toBe("struktur");
    expect(classifyTrade("Instalasi listrik titik lampu", "")).toBe("mep");
    expect(classifyTrade("Pasang keramik 40x40", "")).toBe("finishing");
    expect(classifyTrade("Pembuatan papan nama proyek", "")).toBe("persiapan");
    expect(classifyTrade("Penanaman pohon peneduh", "")).toBe("landscape");
    expect(classifyTrade("Rumput gebalan", "")).toBe("sarana_luar"); // "GEBALAN" (sarana_luar) dicek sebelum landscape
  });

  it("fallback ke nama kategori, lalu lainnya", () => {
    expect(classifyTrade("Pekerjaan lain-lain", "PEKERJAAN ATAP DAN PLAFOND")).toBe("atap");
    expect(classifyTrade("Dokumentasi", "")).toBe("lainnya");
  });

  it("kalibrasi korpus RAB NTB — item yang dulu 'lainnya'", () => {
    // listrik/plumbing → mep
    expect(classifyTrade("Pekerjaan Pemasangan MCB 2 Ampere", "")).toBe("mep");
    expect(classifyTrade("Biaya Pasang Baru Daya 33 KVA", "PEKERJAAN PERSIAPAN")).toBe("mep");
    expect(classifyTrade("Pasang Downlight Ø 5 Inch+ LED 9 watt", "")).toBe("mep");
    expect(classifyTrade("Pekerjaan Pemasangan Closet Duduk", "")).toBe("mep");
    expect(classifyTrade("Pekerjaan Pasang Kran Air Ø ½ Inch", "")).toBe("mep");
    expect(classifyTrade("Pengadaan Tiang PJU 7 meter", "")).toBe("mep");
    // alat berat & K3 → persiapan
    expect(classifyTrade("Excavator", "PEKERJAAN PERSIAPAN")).toBe("persiapan");
    expect(classifyTrade("Concrete Mixer Pump", "PEKERJAAN PERSIAPAN")).toBe("persiapan");
    expect(classifyTrade("Peralatan P3K (Kotak P3K, Tandu)", "")).toBe("persiapan");
    // reinforcement/anchor → struktur
    expect(classifyTrade("Pekerjaan Gelar Wiremesh M8-150", "")).toBe("struktur");
    expect(classifyTrade("Pekerjaan Pemasangan Dynabolt M8 x 100 mm", "")).toBe("struktur");
    // hindari salah tebak: ACIAN tetap dinding (bukan 'AC'→mep)
    expect(classifyTrade("Pekerjaan Acian dinding", "")).toBe("dinding");
  });
});

describe("computeTradeWindows (algoritma jadwal per-lokasi)", () => {
  const bandOf = (k: string) => TRADE_BANDS.find((b) => b.key === k)!;

  it("jendela selalu di dalam band presedensi [bandStart,bandEnd]", () => {
    const w = computeTradeWindows(TYPICAL_TRADE_MIX);
    for (const b of TRADE_BANDS) {
      expect(w[b.key].start).toBeGreaterThanOrEqual(b.bandStart - 1e-9);
      expect(w[b.key].end).toBeLessThanOrEqual(b.bandEnd + 1e-9);
      expect(w[b.key].end).toBeGreaterThan(w[b.key].start);
    }
  });

  it("presedensi lapangan: persiapan mulai sebelum struktur mulai sebelum finishing", () => {
    const w = computeTradeWindows(TYPICAL_TRADE_MIX);
    expect(w.persiapan.start).toBeLessThan(w.struktur.start);
    expect(w.struktur.start).toBeLessThan(w.finishing.start);
    expect(w.finishing.end).toBeGreaterThanOrEqual(w.struktur.end);
  });

  it("anchor: persiapan mulai di awal band (front), landscape selesai di akhir (tail)", () => {
    const w = computeTradeWindows(TYPICAL_TRADE_MIX);
    expect(w.persiapan.start).toBeCloseTo(bandOf("persiapan").bandStart, 6);
    expect(w.landscape.end).toBeCloseTo(bandOf("landscape").bandEnd, 6);
  });

  it("cost-based duration: trade lebih berat → jendela lebih lebar (dalam band sama)", () => {
    const ringan = computeTradeWindows({ struktur: 0.05, mep: 0.95 });
    const berat = computeTradeWindows({ struktur: 0.95, mep: 0.05 });
    const durStrukturBerat = berat.struktur.end - berat.struktur.start;
    const durStrukturRingan = ringan.struktur.end - ringan.struktur.start;
    expect(durStrukturBerat).toBeGreaterThan(durStrukturRingan);
    // mep sebaliknya
    expect(ringan.mep.end - ringan.mep.start).toBeGreaterThan(berat.mep.end - berat.mep.start);
  });

  it("adaptif per-lokasi: lokasi struktur-berat → kurva lebih curam di tengah drpd lokasi rata", () => {
    const strukturBerat = scheduleItems(
      [
        { name: "Beton K-250", categoryName: "STRUKTUR", amount: 800_000_000n },
        { name: "Pasang keramik", categoryName: "FINISHING", amount: 100_000_000n },
        { name: "Pembersihan lahan", categoryName: "PERSIAPAN", amount: 100_000_000n },
      ],
      150,
    );
    // Kurva valid & monoton, puncak laju ada di paruh tengah (struktur dominan).
    const mid = Math.floor(strukturBerat.length / 2);
    const rate = (i: number) => strukturBerat[i] - (i > 0 ? strukturBerat[i - 1] : 0);
    expect(rate(mid)).toBeGreaterThan(rate(0));
    expect(strukturBerat[strukturBerat.length - 1]).toBeCloseTo(100, 1);
  });

  it("bobot kosong → tetap kembalikan jendela valid (fallback share 0 = minDur)", () => {
    const w = computeTradeWindows({});
    for (const b of TRADE_BANDS) {
      expect(w[b.key].end - w[b.key].start).toBeCloseTo(b.minDur, 6);
    }
  });
});

describe("scheduleItems", () => {
  const items = [
    { name: "Pembersihan lahan", categoryName: "PEKERJAAN PERSIAPAN", amount: 50_000_000n },
    { name: "Galian tanah pondasi", categoryName: "PEKERJAAN PONDASI", amount: 100_000_000n },
    { name: "Pondasi batu kali 1:4", categoryName: "PEKERJAAN PONDASI", amount: 150_000_000n },
    { name: "Beton sloof 15/20", categoryName: "PEKERJAAN STRUKTUR", amount: 200_000_000n },
    { name: "Pasangan bata merah", categoryName: "PEKERJAAN DINDING", amount: 150_000_000n },
    { name: "Rangka atap baja ringan", categoryName: "PEKERJAAN ATAP", amount: 120_000_000n },
    { name: "Instalasi listrik", categoryName: "PEKERJAAN MEP", amount: 80_000_000n },
    { name: "Pengecatan eksterior", categoryName: "PEKERJAAN FINISHING", amount: 70_000_000n },
    { name: "Penanaman pohon peneduh", categoryName: "LANDSCAPE", amount: 30_000_000n },
    { name: "Dokumentasi & pelaporan", categoryName: "UMUM", amount: 50_000_000n },
  ];
  const curve = scheduleItems(items, 150);

  it("panjang = ceil(hari/7)", () => {
    expect(curve.length).toBe(22);
  });

  it("monotonik naik", () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
  });

  it("berakhir 100 (±0.5)", () => {
    expect(Math.abs(curve[curve.length - 1] - 100)).toBeLessThanOrEqual(0.5);
  });

  it("semua amount 0 → kurva nol", () => {
    const zero = scheduleItems([{ name: "x", categoryName: "y", amount: 0n }], 70);
    expect(zero).toEqual(new Array(10).fill(0));
  });

  it("mulai landai: kumulatif minggu-1 < porsi linear (bentuk-S, bukan garis)", () => {
    const n = curve.length; // 22
    const linearWeek1 = 100 / n; // ~4.5%
    expect(curve[0]).toBeLessThan(linearWeek1);
    expect(curve[0]).toBeGreaterThan(0); // ada progres kecil, bukan 0 mati
  });

  it("bentuk-S: laju tengah > laju awal & laju akhir", () => {
    const n = curve.length;
    const rate = (i: number) => curve[i] - (i > 0 ? curve[i - 1] : 0);
    const mid = Math.floor(n / 2);
    expect(rate(mid)).toBeGreaterThan(rate(0)); // tengah lebih curam dari awal
    expect(rate(mid)).toBeGreaterThan(rate(n - 1)); // tengah lebih curam dari akhir
  });
});

describe("curveFromCategorySchedule (jadwal per pekerjaan, distribusi LONCENG — DECISIONS 081)", () => {
  it("satu pekerjaan penuh durasi → bell: landai-curam-landai, tengah ~50, akhir 100", () => {
    const c = curveFromCategorySchedule([{ weightPct: 100, startWeek: 1, endWeek: 10 }], 10);
    expect(c).toHaveLength(10);
    expect(c[0]).toBeLessThan(10); // minggu-1 < porsi rata (landai, bukan linear)
    expect(c[4]).toBeCloseTo(50, 0); // tengah ~50 (bell simetris)
    expect(c[9]).toBeCloseTo(100, 5);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });

  it("bobot disebar LONCENG dalam jendela (bukan rata); di luar jendela nol; Σ=bobot", () => {
    const c = curveFromCategorySchedule([{ weightPct: 60, startWeek: 3, endWeek: 5 }], 6);
    expect(c[0]).toBe(0); // sebelum mulai
    expect(c[1]).toBe(0);
    const w3 = c[2] - c[1]; // increment mgg3
    const w4 = c[3] - c[2]; // increment mgg4 (puncak)
    const w5 = c[4] - c[3]; // increment mgg5
    expect(w4).toBeGreaterThan(w3); // naik ke puncak
    expect(w4).toBeGreaterThan(w5); // lalu turun → lonceng
    expect(w3).toBeCloseTo(w5, 5); // simetris
    expect(c[4]).toBeCloseTo(60, 5); // selesai = bobot penuh
    expect(c[5]).toBeCloseTo(60, 5); // setelah selesai: datar
  });

  it("beberapa pekerjaan tumpang-tindih → monotonik, akhir = Σ bobot", () => {
    const rows = [
      { weightPct: 30, startWeek: 1, endWeek: 4 },
      { weightPct: 50, startWeek: 3, endWeek: 8 },
      { weightPct: 20, startWeek: 7, endWeek: 10 },
    ];
    const c = curveFromCategorySchedule(rows, 10);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    expect(Math.abs(c[9] - 100)).toBeLessThanOrEqual(0.5);
  });

  it("jendela di luar rentang di-clamp; start > end dirapikan", () => {
    const c = curveFromCategorySchedule([{ weightPct: 100, startWeek: -3, endWeek: 99 }], 5);
    expect(c[4]).toBeCloseTo(100, 5);
    const d = curveFromCategorySchedule([{ weightPct: 100, startWeek: 4, endWeek: 2 }], 5);
    expect(d[3]).toBeCloseTo(100, 5); // jatuh di minggu 4 saja
    expect(d[2]).toBe(0);
  });

  it("bobot 0/negatif diabaikan", () => {
    const c = curveFromCategorySchedule(
      [
        { weightPct: 0, startWeek: 1, endWeek: 5 },
        { weightPct: -5, startWeek: 1, endWeek: 5 },
        { weightPct: 100, startWeek: 1, endWeek: 5 },
      ],
      5,
    );
    expect(c[4]).toBeCloseTo(100, 5);
  });
});

describe("weeklyFromSegments / segmentsFromWeekly / cumulativeFromWeeklyRows (matriks per-minggu, JEDA — DECISIONS 103)", () => {
  it("satu segmen = identik dgn lonceng jendela tunggal; Σ = bobot", () => {
    const w = weeklyFromSegments(60, [{ startWeek: 3, endWeek: 5 }], 6);
    expect(w).toHaveLength(6);
    expect(w[0]).toBe(0);
    expect(w[1]).toBe(0);
    expect(w[5]).toBe(0);
    expect(w[2] + w[3] + w[4]).toBeCloseTo(60, 5);
    expect(w[3]).toBeGreaterThan(w[2]); // lonceng: puncak di tengah
    expect(w[3]).toBeGreaterThan(w[4]);
  });

  it("DUA segmen dgn JEDA → minggu jeda = 0; Σ = bobot; porsi ∝ panjang segmen", () => {
    // Aktif mgg 1–2 (jeda 3–4) lalu 5–8. Total 6 minggu aktif dari 8.
    const w = weeklyFromSegments(100, [{ startWeek: 1, endWeek: 2 }, { startWeek: 5, endWeek: 8 }], 8);
    expect(w[2]).toBe(0); // jeda
    expect(w[3]).toBe(0); // jeda
    expect(w[0] + w[1]).toBeGreaterThan(0);
    expect(w[4] + w[5] + w[6] + w[7]).toBeGreaterThan(0);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 5);
    // segmen-2 (4 minggu) dapat porsi lebih besar dari segmen-1 (2 minggu)
    const seg1 = w[0] + w[1];
    const seg2 = w[4] + w[5] + w[6] + w[7];
    expect(seg2).toBeGreaterThan(seg1);
    expect(seg1).toBeCloseTo(100 * (2 / 6), 5);
    expect(seg2).toBeCloseTo(100 * (4 / 6), 5);
  });

  it("segmentsFromWeekly merekonstruksi run kontigu (deteksi jeda)", () => {
    const w = weeklyFromSegments(100, [{ startWeek: 1, endWeek: 2 }, { startWeek: 5, endWeek: 8 }], 8);
    const segs = segmentsFromWeekly(w);
    expect(segs).toEqual([
      { startWeek: 1, endWeek: 2 },
      { startWeek: 5, endWeek: 8 },
    ]);
  });

  it("kurva dari matriks berjeda: MENDATAR saat jeda, monoton, mulai 0, akhir 100", () => {
    const a = weeklyFromSegments(40, [{ startWeek: 1, endWeek: 4 }], 10);
    // kategori terputus: aktif 1–4, jeda 5–6, lanjut 7–10
    const b = weeklyFromSegments(60, [{ startWeek: 1, endWeek: 4 }, { startWeek: 7, endWeek: 10 }], 10);
    const c = cumulativeFromWeeklyRows([a, b], 10);
    expect(c).toHaveLength(10);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    expect(c[9]).toBeCloseTo(100, 1);
    // b tidak menambah apa pun di mgg 5–6 → kenaikan hanya dari a bila a masih aktif;
    // a juga selesai mgg 4, jadi mgg 5→6 harus DATAR (increment 0).
    expect(c[5] - c[4]).toBeCloseTo(0, 5); // mgg 6 vs 5: datar (kedua kategori jeda)
  });

  it("segmen kosong / bobot ≤ 0 → array nol", () => {
    expect(weeklyFromSegments(0, [{ startWeek: 1, endWeek: 5 }], 5).every((v) => v === 0)).toBe(true);
    expect(weeklyFromSegments(50, [], 5).every((v) => v === 0)).toBe(true);
  });
});

describe("autoCategorySchedule (presedensi kategori — DECISIONS 079)", () => {
  const cats = [
    { lineageKey: "I", name: "PEKERJAAN PERSIAPAN", amount: 100n },
    { lineageKey: "II", name: "PEKERJAAN PONDASI BANGUNAN", amount: 300n },
    { lineageKey: "III", name: "PEKERJAAN JALAN LINGKUNGAN DAN SALURAN", amount: 200n },
    { lineageKey: "IV", name: "PEKERJAAN PENERANGAN KAWASAN", amount: 250n },
    { lineageKey: "V", name: "PEKERJAAN LANDSKAPING KAWASAN", amount: 50n },
  ];
  const sched = autoCategorySchedule(cats, 20);
  const byKey = new Map(sched.map((s) => [s.lineageKey, s]));

  it("bobot = amount ÷ grand × 100, jumlah ~100", () => {
    expect(sched.reduce((s, r) => s + r.weightPct, 0)).toBeCloseTo(100, 6);
  });

  it("presedensi: persiapan AWAL, penerangan & landskap AKHIR", () => {
    const persiapan = byKey.get("I")!;
    const penerangan = byKey.get("IV")!;
    const landskap = byKey.get("V")!;
    const jalan = byKey.get("III")!;
    expect(persiapan.startWeek).toBe(1);
    // penerangan tak boleh mulai sebelum jalan mulai
    expect(penerangan.startWeek).toBeGreaterThanOrEqual(jalan.startWeek);
    // penerangan & landskap selesai di ujung proyek
    expect(penerangan.endWeek).toBe(20);
    expect(landskap.endWeek).toBe(20);
    // penerangan mulai jauh setelah persiapan selesai (bukan minggu-1)
    expect(penerangan.startWeek).toBeGreaterThan(12);
  });

  it("jendela valid (1 ≤ start ≤ end ≤ totalWeeks)", () => {
    for (const s of sched) {
      expect(s.startWeek).toBeGreaterThanOrEqual(1);
      expect(s.endWeek).toBeGreaterThanOrEqual(s.startWeek);
      expect(s.endWeek).toBeLessThanOrEqual(20);
    }
  });
});

describe("rescheduleToCurve (penyesuaian halus kurva → jadwal kategori ikut, DECISIONS 159)", () => {
  // Matriks 3 kategori × 6 minggu, dengan JEDA di kategori III.
  const rows = [
    [8, 6, 4, 0, 0, 0], // 18
    [0, 0, 12, 24, 12, 0], // 48
    [0, 0, 0, 0, 16, 18], // 34
  ];
  const bobot = rows.map((r) => r.reduce((s, v) => s + v, 0));
  const kurvaLama = (() => {
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < 6; i++) {
      acc += rows.reduce((s, r) => s + r[i], 0);
      out.push(acc);
    }
    return out;
  })();

  const cek = (out: number[][], newCum: number[]) => {
    // Marginal BARIS: bobot tiap kategori tidak berubah.
    out.forEach((r, i) => {
      expect(r.reduce((s, v) => s + v, 0), `bobot kategori ${i + 1}`).toBeCloseTo(bobot[i], 6);
    });
    // Marginal KOLOM: Σ kategori tiap minggu == increment kurva baru.
    for (let w = 0; w < newCum.length; w++) {
      const inc = newCum[w] - (w > 0 ? newCum[w - 1] : 0);
      expect(out.reduce((s, r) => s + r[w], 0), `increment minggu ${w + 1}`).toBeCloseTo(inc, 6);
    }
    // Tidak ada increment negatif.
    for (const r of out) for (const v of r) expect(v).toBeGreaterThanOrEqual(-1e-9);
  };

  it("kurva tidak berubah → matriks tidak berubah (idempotent)", () => {
    const out = rescheduleToCurve(rows, kurvaLama);
    out.forEach((r, i) => r.forEach((v, w) => expect(v).toBeCloseTo(rows[i][w], 6)));
    cek(out, kurvaLama);
  });

  it("kurva dilambatkan → pekerjaan mundur, bobot kategori tetap", () => {
    const lambat = [4, 10, 20, 40, 70, 100];
    const out = rescheduleToCurve(rows, lambat);
    cek(out, lambat);
    // Kategori I (pekerjaan awal) belum selesai secepat semula di minggu 2.
    const sdMinggu2Baru = out[0][0] + out[0][1];
    const sdMinggu2Lama = rows[0][0] + rows[0][1];
    expect(sdMinggu2Baru).toBeLessThan(sdMinggu2Lama);
  });

  it("kurva dipercepat → pekerjaan maju", () => {
    const cepat = [25, 50, 70, 85, 95, 100];
    const out = rescheduleToCurve(rows, cepat);
    cek(out, cepat);
    expect(out[2].slice(0, 4).reduce((s, v) => s + v, 0)).toBeGreaterThan(0); // kategori akhir mulai lebih awal
  });

  it("jumlah minggu berubah → jadwal ikut diregangkan (dulu malah dibuang)", () => {
    const panjang = [3, 8, 16, 28, 45, 62, 80, 100];
    const out = rescheduleToCurve(rows, panjang);
    expect(out[0]).toHaveLength(8);
    cek(out, panjang);
  });

  it("matriks kosong / nol dikembalikan apa adanya", () => {
    expect(rescheduleToCurve([], [0, 100])).toEqual([]);
    const nol = [[0, 0, 0]];
    expect(rescheduleToCurve(nol, [10, 50, 100])).toEqual(nol);
  });
});
