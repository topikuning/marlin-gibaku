import { describe, expect, it } from "vitest";
import { apportion, flattenParsedRab, grandTotal, type FlatNode } from "@/lib/rab/flatten";
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

describe("apportion (largest remainder)", () => {
  it("Σ hasil == target (pembulatan sekali di induk, bukan per baris)", () => {
    const exacts = [1642035.39, 114803.1, 31447561.5, 1413817.39, 81058.67];
    const target = BigInt(Math.round(exacts.reduce((a, b) => a + b, 0)));
    const alloc = apportion(exacts, target);
    expect(alloc.reduce((a, b) => a + b, 0n)).toBe(target);
    // tiap alokasi ∈ [floor, ceil] eksaknya
    alloc.forEach((a, i) => {
      expect(a).toBeGreaterThanOrEqual(BigInt(Math.floor(exacts[i])));
      expect(a).toBeLessThanOrEqual(BigInt(Math.ceil(exacts[i])));
    });
  });

  it("+1 rupiah jatuh ke pecahan desimal terbesar", () => {
    // Σ = 3.0 → target 3; floor = [0,0,0]; 3 rupiah dibagi ke SEMUA (semua .x)
    expect(apportion([0.9, 0.7, 0.4], 2n)).toEqual([1n, 1n, 0n]);
    expect(apportion([10.9, 20.1, 30.5], 62n)).toEqual([11n, 20n, 31n]);
  });

  it("target integer & list kosong aman", () => {
    expect(apportion([100, 200, 300], 600n)).toEqual([100n, 200n, 300n]);
    expect(apportion([], 0n)).toEqual([]);
  });

  it("deterministik: pecahan sama → +1 ke indeks awal (sort stabil)", () => {
    // floor [1,2,3]=6, target 8 → +1 ke 2 pertama (semua rem .5, urutan asli)
    expect(apportion([1.5, 2.5, 3.5], 8n)).toEqual([2n, 3n, 3n]);
  });
});

describe("flattenParsedRab (nilai desimal — cocok Excel)", () => {
  const decFixture: ParsedRab = {
    meta: fixture.meta,
    project: "DEC",
    year: 2026,
    total: 0,
    categories: [
      {
        roman: "I",
        name: "PEKERJAAN A",
        total_value: 0,
        subcategories: [],
        direct_items: [
          item({ code: "1", name: "x", volume: 1, unit: "ls", unit_price: 850.38, total_price: 850.38 }),
          item({ code: "2", name: "y", volume: 1, unit: "ls", unit_price: 561.5, total_price: 561.5 }),
          item({ code: "3", name: "z", volume: 1, unit: "ls", unit_price: 100.39, total_price: 100.39 }),
        ],
      },
    ],
  };
  const nodes = flattenParsedRab(decFixture);
  const byKey = new Map(nodes.map((n) => [n.lineageKey, n]));

  it("grandTotal = round(Σ eksak), bukan Σ round(baris)", () => {
    // Σ eksak = 1512.27 → 1512. Σ round(baris) = 850+562+100 = 1512 (kebetulan sama di sini),
    // yang penting anak menjumlah tepat ke kategori.
    const exact = 850.38 + 561.5 + 100.39;
    expect(grandTotal(nodes)).toBe(BigInt(Math.round(exact)));
  });

  it("anak menjumlah tepat ke kategori (tak ada selisih menggelembung)", () => {
    const kids = ["I#1", "I#2", "I#3"].map((k) => byKey.get(k)!.amount);
    expect(kids.reduce((a, b) => a + b, 0n)).toBe(byKey.get("I")!.amount);
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
