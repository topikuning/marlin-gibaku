import { describe, expect, it } from "vitest";
import {
  betaCdf,
  classifyTrade,
  computeTradeWindows,
  constructionScurveWeekly,
  curveFromCategorySchedule,
  DEFAULT_CONTRACT_DAYS,
  generateScurve,
  scheduleItems,
  smoothstep,
  TRADE_BANDS,
  TYPICAL_TRADE_MIX,
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

describe("curveFromCategorySchedule (jadwal per pekerjaan, distribusi rata)", () => {
  it("satu pekerjaan penuh durasi → linear, akhir 100", () => {
    const c = curveFromCategorySchedule([{ weightPct: 100, startWeek: 1, endWeek: 10 }], 10);
    expect(c).toHaveLength(10);
    expect(c[0]).toBeCloseTo(10, 5);
    expect(c[4]).toBeCloseTo(50, 5);
    expect(c[9]).toBeCloseTo(100, 5);
  });

  it("bobot dibagi rata dalam jendela; di luar jendela nol", () => {
    const c = curveFromCategorySchedule([{ weightPct: 60, startWeek: 3, endWeek: 5 }], 6);
    expect(c[0]).toBe(0); // sebelum mulai
    expect(c[1]).toBe(0);
    expect(c[2]).toBeCloseTo(20, 5); // 60/3 per minggu
    expect(c[3]).toBeCloseTo(40, 5);
    expect(c[4]).toBeCloseTo(60, 5);
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

describe("betaCdf (CDF Beta ter-regularisasi)", () => {
  it("nilai batas & titik yang diketahui", () => {
    expect(betaCdf(0, 2, 2)).toBe(0);
    expect(betaCdf(1, 2, 2)).toBe(1);
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 4);
    // Beta(2,2) = smoothstep: 10/50/90 pada 0.2/0.5/0.8
    expect(betaCdf(0.2, 2, 2)).toBeCloseTo(0.104, 3);
    expect(betaCdf(0.8, 2, 2)).toBeCloseTo(0.896, 3);
    // Beta(1,1) = uniform: I_x = x
    expect(betaCdf(0.3, 1, 1)).toBeCloseTo(0.3, 4);
    expect(betaCdf(0.7, 1, 1)).toBeCloseTo(0.7, 4);
  });
  it("monoton naik", () => {
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = betaCdf(Math.min(1, x), 2.1, 1.9);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("constructionScurveWeekly (kurva-S proyek)", () => {
  const c = constructionScurveWeekly(0.5, 20);

  it("mulai ~0, akhir 100, monoton", () => {
    expect(c[0]).toBeLessThan(5);
    expect(c[19]).toBeCloseTo(100, 1);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });

  it("BERBENTUK S: tengah lebih curam daripada ujung (bukan diagonal)", () => {
    const d = c.map((v, i) => v - (i > 0 ? c[i - 1] : 0)); // laju mingguan
    const awal = d[1]; // laju minggu awal
    const tengah = d[10]; // laju sekitar puncak
    const akhir = d[18]; // laju menjelang selesai
    expect(tengah).toBeGreaterThan(awal * 1.8); // puncak jauh lebih curam dari awal
    expect(tengah).toBeGreaterThan(akhir * 1.8); // dan dari akhir → lonceng, bukan datar
  });

  it("simetris pada μ=0.5 ≈ 10/50/90 (patokan konstruksi)", () => {
    expect(c[3]).toBeLessThan(15); // ~20% waktu → ~10%
    expect(c[9]).toBeGreaterThan(45);
    expect(c[9]).toBeLessThan(55); // ~50% waktu → ~50%
    expect(c[15]).toBeGreaterThan(85); // ~80% waktu → ~90%
  });

  it("μ menggeser puncak: berat depan (μ<0.5) lebih cepat di paruh awal", () => {
    const depan = constructionScurveWeekly(0.43, 20);
    const belakang = constructionScurveWeekly(0.57, 20);
    expect(depan[9]).toBeGreaterThan(belakang[9]); // di tengah, front-heavy unggul
  });

  it("clamp μ ekstrem tetap ber-S (α,β>1)", () => {
    const ekstrem = constructionScurveWeekly(0.1, 20); // di-clamp ke 0.42
    for (let i = 1; i < ekstrem.length; i++)
      expect(ekstrem[i]).toBeGreaterThanOrEqual(ekstrem[i - 1]);
    expect(ekstrem[0]).toBeLessThan(5);
    expect(ekstrem[19]).toBeCloseTo(100, 1);
  });
});
