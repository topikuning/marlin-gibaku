import { describe, expect, it } from "vitest";
import { flattenParsedRab, grandTotal, type FlatNode } from "@/lib/rab/flatten";
import type { ParsedRab, ParsedRabItem } from "@/lib/rab/parsed";
import kedungmutihJson from "../../seed-data/kedungmutih.json";

const item = (over: Partial<ParsedRabItem> & { code: string; name: string }): ParsedRabItem => ({
  volume: null,
  unit: null,
  unit_price: null,
  total_price: null,
  tkdn_ratio: null,
  parent_code: null,
  children: [],
  ...over,
});

/** Fixture kecil: 2 kategori, 1 sub, item bersarang. */
const fixture: ParsedRab = {
  meta: {
    slug: "uji",
    village: null,
    regency: null,
    province: null,
    gps_lat: null,
    gps_lng: null,
    contract_number: null,
    contractor: null,
    start_date: null,
    end_date: null,
  },
  project: "UJI",
  year: 2026,
  total: 0,
  categories: [
    {
      roman: "I",
      name: "PEKERJAAN PERSIAPAN",
      total_value: 0,
      subcategories: [],
      direct_items: [
        item({ code: "1", name: "Papan Nama", volume: 1, unit: "bh", unit_price: 1000, total_price: 1000 }),
        item({
          code: "6",
          name: "SMK3K",
          children: [
            item({ code: "6.1", name: "RK3K" }), // deskripsi, nilai null
            item({ code: "6.a", name: "APD", volume: 2, unit: "set", unit_price: 250, total_price: 500 }),
          ],
        }),
      ],
    },
    {
      roman: "II",
      name: "PEKERJAAN GEDUNG",
      total_value: 0,
      subcategories: [
        {
          code: "II.1",
          name: "Pekerjaan Pondasi",
          total_value: 0,
          items: [
            item({ code: "1", name: "Galian", volume: 10, unit: "m3", unit_price: 100, total_price: 1000 }),
            // leaf tanpa total_price → fallback volume × unit_price
            item({ code: "2", name: "Urugan", volume: 4, unit: "m3", unit_price: 125 }),
          ],
        },
      ],
      direct_items: [],
    },
  ],
};

describe("flattenParsedRab (fixture kecil)", () => {
  const nodes = flattenParsedRab(fixture);
  const byKey = new Map(nodes.map((n) => [n.lineageKey, n]));

  it("lineageKey mengikuti path kode digabung #", () => {
    expect(byKey.has("I")).toBe(true);
    expect(byKey.has("I#1")).toBe(true);
    expect(byKey.has("I#6")).toBe(true);
    expect(byKey.has("I#6#6.1")).toBe(true);
    expect(byKey.has("I#6#6.a")).toBe(true);
    expect(byKey.has("II#II.1")).toBe(true);
    expect(byKey.has("II#II.1#1")).toBe(true);
  });

  it("parentLineageKey benar", () => {
    expect(byKey.get("I")!.parentLineageKey).toBeNull();
    expect(byKey.get("I#6#6.a")!.parentLineageKey).toBe("I#6");
    expect(byKey.get("II#II.1#1")!.parentLineageKey).toBe("II#II.1");
    expect(byKey.get("II#II.1")!.parentLineageKey).toBe("II");
  });

  it("kind: grup untuk node dengan anak, item untuk leaf", () => {
    expect(byKey.get("I")!.kind).toBe("kategori");
    expect(byKey.get("II#II.1")!.kind).toBe("sub");
    expect(byKey.get("I#6")!.kind).toBe("grup");
    expect(byKey.get("I#1")!.kind).toBe("item");
  });

  it("amount rollup: grup = Σ anak, kategori = Σ isi", () => {
    expect(byKey.get("I#6")!.amount).toBe(500n); // anak: 0 + 500
    expect(byKey.get("I")!.amount).toBe(1500n); // 1000 + 500
    expect(byKey.get("II#II.1#2")!.amount).toBe(500n); // 4 × 125 fallback
    expect(byKey.get("II#II.1")!.amount).toBe(1500n);
    expect(byKey.get("II")!.amount).toBe(1500n);
  });

  it("grandTotal = Σ amount kategori", () => {
    expect(grandTotal(nodes)).toBe(3000n);
  });

  it("sortOrder global menaik sesuai urutan dokumen", () => {
    const orders = nodes.map((n) => n.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(nodes.length);
    // kategori I duluan, lalu isinya, baru kategori II
    expect(byKey.get("I")!.sortOrder).toBeLessThan(byKey.get("I#1")!.sortOrder);
    expect(byKey.get("I#6#6.a")!.sortOrder).toBeLessThan(byKey.get("II")!.sortOrder);
  });
});

describe("flattenParsedRab (seed-data/kedungmutih.json)", () => {
  const parsed = kedungmutihJson as unknown as ParsedRab;
  const nodes: FlatNode[] = flattenParsedRab(parsed);

  it("grandTotal > 0", () => {
    expect(grandTotal(nodes) > 0n).toBe(true);
  });

  it("jumlah node kategori = categories.length", () => {
    const cats = nodes.filter((n) => n.kind === "kategori");
    expect(cats.length).toBe(parsed.categories.length);
  });

  it("semua lineageKey unik", () => {
    const keys = new Set(nodes.map((n) => n.lineageKey));
    expect(keys.size).toBe(nodes.length);
  });
});
