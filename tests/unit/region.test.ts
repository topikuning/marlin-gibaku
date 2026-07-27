import { describe, expect, it } from "vitest";
import { REGION_ORDER, REGION_OTHER, regionOf } from "@/lib/region";

describe("regionOf (provinsi teks bebas → wilayah)", () => {
  it("nama resmi provinsi masuk wilayahnya", () => {
    expect(regionOf("Jawa Tengah")).toBe("Jawa");
    expect(regionOf("Daerah Istimewa Yogyakarta")).toBe("Jawa");
    expect(regionOf("Nusa Tenggara Barat")).toBe("Bali & Nusa");
    expect(regionOf("Bali")).toBe("Bali & Nusa");
    expect(regionOf("Kepulauan Riau")).toBe("Sumatera");
    expect(regionOf("Kalimantan Utara")).toBe("Kalimantan");
    expect(regionOf("Sulawesi Tenggara")).toBe("Sulawesi");
    expect(regionOf("Papua Barat Daya")).toBe("Maluku & Papua");
    expect(regionOf("Maluku Utara")).toBe("Maluku & Papua");
  });

  it("variasi penulisan lapangan (kapital, prefiks, singkatan) tetap masuk", () => {
    // Provinsi diketik manual di form & ikut apa adanya dari kolom Excel impor.
    expect(regionOf("NUSA TENGGARA BARAT")).toBe("Bali & Nusa");
    expect(regionOf("Prov. Bali")).toBe("Bali & Nusa");
    expect(regionOf("NTB")).toBe("Bali & Nusa");
    expect(regionOf("ntt")).toBe("Bali & Nusa");
    expect(regionOf("Provinsi Jawa Timur")).toBe("Jawa");
    expect(regionOf("DKI Jakarta")).toBe("Jawa");
    expect(regionOf("D.I. Yogyakarta")).toBe("Jawa");
    expect(regionOf("JATIM")).toBe("Jawa");
    expect(regionOf("  jawa   tengah ")).toBe("Jawa");
  });

  it("Sulawesi tidak tertukar ke Jawa (pencocokan per kata, bukan substring)", () => {
    expect(regionOf("Sulawesi Selatan")).toBe("Sulawesi");
    expect(regionOf("SULAWESI BARAT")).toBe("Sulawesi");
  });

  it("provinsi tak dikenal / kosong jatuh ke Lainnya (tetap terhitung, tidak hilang)", () => {
    expect(regionOf("")).toBe(REGION_OTHER);
    expect(regionOf("Antah Berantah")).toBe(REGION_OTHER);
    expect(REGION_ORDER).not.toContain(REGION_OTHER);
  });
});
