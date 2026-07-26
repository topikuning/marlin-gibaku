import { describe, expect, it } from "vitest";
import {
  truncateText,
  toNarrativeSourceRefs,
  narrativeEntryCount,
  buildNarrativePayload,
  type NarrativeBundle,
} from "@/lib/ai-hub/narrative-format";

/**
 * Narasi lapangan (laporan harian + kegiatan) sebagai konteks AI — DECISIONS 136.
 * Fungsi murni: truncateText, buildNarrativePayload, toNarrativeSourceRefs.
 */

function bundle(over: Partial<NarrativeBundle["locations"][number]> = {}): NarrativeBundle {
  return {
    locations: [
      {
        locationId: "loc-1",
        locationName: "Tengket",
        slug: "tengket",
        reports: [
          {
            id: "r1",
            date: "2026-07-20",
            status: "final",
            weather: "hujan_ringan",
            notes: "Pengecoran lantai selesai, tim lanjut ke area B.",
            photoCount: 3,
            items: [{ itemName: "Pengecoran lantai", unit: "m3", volumeDone: 12, notes: "sesuai target" }],
          },
        ],
        activities: [
          {
            id: "a1",
            date: "2026-07-21",
            kindLabel: "Rapat PCM",
            title: "Rapat koordinasi mingguan",
            notes: "Membahas progres minggu ini dan rencana minggu depan.",
            kendala: "Material urug belum datang.",
            solusi: "Cari supplier alternatif.",
            status: "final",
            photoCount: 5,
          },
        ],
        ...over,
      },
    ],
  };
}

describe("ai-hub/narrative — truncateText", () => {
  it("null/kosong -> null", () => {
    expect(truncateText(null)).toBeNull();
    expect(truncateText("   ")).toBeNull();
    expect(truncateText(undefined)).toBeNull();
  });
  it("teks pendek tidak dipotong", () => {
    expect(truncateText("catatan singkat")).toBe("catatan singkat");
  });
  it("teks panjang dipotong + elipsis, batas dihormati", () => {
    const long = "a".repeat(500);
    const out = truncateText(long, 100)!;
    expect(out.length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("ai-hub/narrative — toNarrativeSourceRefs", () => {
  it("bangun satu ref granular per laporan & per kegiatan dgn href drill-down", () => {
    const refs = toNarrativeSourceRefs(bundle());
    expect(refs).toHaveLength(2);
    const lap = refs.find((r) => r.id === "tengket:laporan:2026-07-20")!;
    expect(lap.href).toBe("/lokasi/tengket/harian/2026-07-20");
    expect(lap.value).toContain("Pengecoran lantai selesai");
    const keg = refs.find((r) => r.id === "tengket:kegiatan:a1")!;
    expect(keg.href).toBe("/lokasi/tengket/kegiatan");
    expect(keg.entityType).toBe("field_activity");
  });

  it("lokasi tanpa entri tidak menghasilkan ref", () => {
    const empty: NarrativeBundle = { locations: [{ locationId: "x", locationName: "X", slug: "x", reports: [], activities: [] }] };
    expect(toNarrativeSourceRefs(empty)).toHaveLength(0);
  });
});

describe("ai-hub/narrative — narrativeEntryCount", () => {
  it("menjumlahkan laporan + kegiatan lintas lokasi", () => {
    expect(narrativeEntryCount(bundle())).toBe(2);
  });
});

describe("ai-hub/prompt — buildNarrativePayload", () => {
  it("kosong -> pesan eksplisit tanpa entri", () => {
    const empty: NarrativeBundle = { locations: [{ locationId: "x", locationName: "X", slug: "x", reports: [], activities: [] }] };
    const text = buildNarrativePayload(empty);
    expect(text).toContain("tidak ada catatan");
  });

  it("memuat catatan, kendala/solusi, jumlah foto, dan penanda sumber granular", () => {
    const text = buildNarrativePayload(bundle());
    expect(text).toContain("Pengecoran lantai selesai");
    expect(text).toContain("Kendala: Material urug belum datang.");
    expect(text).toContain("Solusi: Cari supplier alternatif.");
    expect(text).toContain("3 foto");
    expect(text).toContain("5 foto");
    expect(text).toContain("(sumber: tengket:laporan:2026-07-20)");
    expect(text).toContain("(sumber: tengket:kegiatan:a1)");
  });

  it("dipotong pada batas maxChars dgn penanda truncation", () => {
    const many: NarrativeBundle = {
      locations: [
        {
          locationId: "loc-1",
          locationName: "Tengket",
          slug: "tengket",
          reports: [],
          activities: Array.from({ length: 50 }, (_, i) => ({
            id: `a${i}`,
            date: "2026-07-01",
            kindLabel: "Mobilisasi",
            title: `Kegiatan ${i}`,
            notes: "x".repeat(300),
            kendala: null,
            solusi: null,
            status: "final",
            photoCount: 0,
          })),
        },
      ],
    };
    const text = buildNarrativePayload(many, { maxChars: 2000 });
    expect(text.length).toBeLessThanOrEqual(2000 + 120);
    expect(text).toContain("terpotong karena batas ukuran");
  });

  it("tidak mengandung angka progres resmi — hanya narasi/foto count", () => {
    const text = buildNarrativePayload(bundle());
    expect(text).not.toMatch(/deviasi|readiness/i);
  });
});
