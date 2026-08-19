// BAGIAN halaman Progress lokasi (DECISIONS 363).
//
// Modulnya tipis karena aturannya dipusatkan di `@/lib/ui/sub-tab`. Yang diuji
// di sini adalah keputusan yang KHUSUS halaman ini: daftar bagiannya, dan
// default-nya yang sengaja "ringkasan" — memantau jauh lebih sering daripada
// mengatur, jadi mendaratkan orang di editor adalah pilihan yang salah.
import { describe, expect, it } from "vitest";
import {
  BAGIAN_PROGRESS,
  bacaBagianProgress,
  hrefBagianProgress,
} from "@/lib/progress-bagian";
import { bacaSubTab, hrefSubTab } from "@/lib/ui/sub-tab";

describe("bacaBagianProgress", () => {
  it("setiap bagian sah dikenali apa adanya", () => {
    for (const b of BAGIAN_PROGRESS) expect(bacaBagianProgress(b)).toBe(b);
  });

  it("default MEMANTAU, bukan mengatur", () => {
    // Kalau default-nya jatuh ke "baseline" atau "jadwal", setiap orang yang
    // membuka tab Progress mendarat di editor — kebalikan dari yang ia cari.
    for (const kosong of [undefined, null, ""]) {
      expect(bacaBagianProgress(kosong), String(kosong)).toBe("ringkasan");
    }
    expect(bacaBagianProgress("Ringkasan")).toBe("ringkasan");
    expect(bacaBagianProgress("../../etc")).toBe("ringkasan");
  });
});

describe("hrefBagianProgress", () => {
  it("menunjuk halaman progress lokasi yang diminta, dengan bagiannya", () => {
    const url = new URL(hrefBagianProgress("batah-timur", "jadwal"), "https://x");
    expect(url.pathname).toBe("/lokasi/batah-timur/progress");
    expect(url.searchParams.get("bagian")).toBe("jadwal");
  });

  it("bagian SELALU ditulis, termasuk yang kebetulan default", () => {
    for (const b of BAGIAN_PROGRESS) {
      expect(hrefBagianProgress("s", b)).toContain(`bagian=${b}`);
    }
  });
});

describe("sub-tab generik", () => {
  it("nilai kosong DAN nilai ngawur sama-sama jatuh ke bawaan", () => {
    const daftar = ["a", "b"] as const;
    for (const v of [undefined, null, "", "c", "A", "__proto__"]) {
      expect(bacaSubTab(daftar, v, "a"), String(v)).toBe("a");
    }
  });

  it("parameter bawaan yang kosong DIBUANG, bukan ditulis kosong", () => {
    // `?minggu=` kosong lolos ke parseInt sebagai NaN dan menutupi nilai
    // default yang seharusnya dipakai.
    const url = new URL(hrefSubTab("/x", "a", { minggu: "", pic: null, q: undefined }), "https://x");
    expect([...url.searchParams.keys()]).toEqual(["bagian"]);
  });

  it("parameter bawaan di-ENCODE, bukan ditempel mentah", () => {
    const url = new URL(hrefSubTab("/x", "a", { q: "1&bagian=b" }), "https://x");
    // Kalau ditempel mentah, `bagian` jadi "b" dan tabnya melompat sendiri.
    expect(url.searchParams.get("bagian")).toBe("a");
    expect(url.searchParams.get("q")).toBe("1&bagian=b");
  });
});
