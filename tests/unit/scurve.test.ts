import { describe, expect, it } from "vitest";
import {
  classifyTrade,
  DEFAULT_CONTRACT_DAYS,
  generateScurve,
  scheduleItems,
  smoothstep,
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
