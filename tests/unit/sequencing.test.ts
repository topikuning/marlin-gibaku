import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyStage,
  detectWorkType,
  HARD_EDGES,
  placeItems,
  scheduleBySequence,
  STAGE_TEMPLATES,
  stageOrder,
  type SeqItem,
  type StageKey,
  type WorkType,
} from "@/lib/scurve/sequencing";

const EPS = 1e-9;

function win(workType: WorkType, key: StageKey) {
  return STAGE_TEMPLATES[workType].find((s) => s.key === key)!;
}

describe("template presedensi: edge KERAS tidak boleh tumpang tindih", () => {
  it("akhir(pred) ≤ mulai(succ) untuk semua hard-edge tiap tipe", () => {
    for (const [workType, edges] of Object.entries(HARD_EDGES) as [WorkType, [StageKey, StageKey][]][]) {
      for (const [pred, succ] of edges) {
        const p = win(workType, pred);
        const s = win(workType, succ);
        expect(
          p.end <= s.start + EPS,
          `${workType}: ${pred}(end ${p.end}) harus ≤ ${succ}(start ${s.start})`,
        ).toBe(true);
      }
    }
  });

  it("jendela tiap tahap valid (0 ≤ start < end ≤ 1)", () => {
    for (const defs of Object.values(STAGE_TEMPLATES)) {
      for (const d of defs) {
        expect(d.start).toBeGreaterThanOrEqual(0);
        expect(d.end).toBeLessThanOrEqual(1);
        expect(d.start).toBeLessThan(d.end);
      }
    }
  });
});

describe("klasifikasi MEP: pisah tanam vs fixture (contoh user)", () => {
  it("kabel/konduit/panel = rough-in (dini); lampu/armatur = finish (akhir)", () => {
    expect(classifyStage("gedung", "PEKERJAAN INSTALASI KABEL NYM 3x2.5")).toBe("mep_roughin");
    expect(classifyStage("gedung", "PEKERJAAN BOX PANEL LISTRIK (MCB) 4 GROUP")).toBe("mep_roughin");
    expect(classifyStage("gedung", "PEKERJAAN INSTALASI TITIK LAMPU")).toBe("mep_roughin");
    expect(classifyStage("gedung", "PEKERJAAN PASANG LAMPU DOWNLIGHT LED")).toBe("mep_finish");
    expect(classifyStage("gedung", "PEKERJAAN ARMATUR LAMPU TL")).toBe("mep_finish");
    expect(classifyStage("gedung", "PEKERJAAN SAKLAR GANDA")).toBe("mep_finish");
  });

  it("lampu (fixture) dijadwalkan SETELAH kabel (rough-in)", () => {
    const roughin = win("gedung", "mep_roughin");
    const finish = win("gedung", "mep_finish");
    expect(finish.start).toBeGreaterThanOrEqual(roughin.start);
    // fixture juga setelah cat (finishing)
    expect(finish.start).toBeGreaterThanOrEqual(win("gedung", "finishing").end - EPS);
  });

  it("sanitair (kloset/wastafel) = fixture akhir; pipa = rough-in", () => {
    expect(classifyStage("gedung", "PEKERJAAN KLOSET DUDUK MONOBLOK")).toBe("sanitair");
    expect(classifyStage("gedung", "PEKERJAAN INSTALASI AIR BERSIH PIPA PVC Ø ½ INCH")).toBe("mep_roughin");
  });
});

describe("kasus rumah genset: pondasi sebelum dinding (di dalam unit)", () => {
  it("dinding bata → tahap dinding; pondasi → tahap pondasi", () => {
    expect(classifyStage("gedung", "PEKERJAAN PASANGAN DINDING BATA MERAH 1 : 5")).toBe("dinding");
    expect(classifyStage("gedung", "PEKERJAAN PONDASI FOOTPLAT BETON")).toBe("pondasi");
  });

  it("jendela pondasi berakhir sebelum jendela dinding mulai", () => {
    const items: SeqItem[] = [
      { name: "PEKERJAAN PONDASI FOOTPLAT", categoryName: "PEKERJAAN BANGUNAN GENSET", amount: 100n },
      { name: "PEKERJAAN PASANGAN DINDING BATA MERAH", categoryName: "PEKERJAAN BANGUNAN GENSET", amount: 100n },
    ];
    const placed = placeItems(items);
    const pond = placed.find((p) => p.stage === "pondasi")!;
    const din = placed.find((p) => p.stage === "dinding")!;
    expect(pond.end).toBeLessThanOrEqual(din.start + EPS);
  });

  it("unit genset kecil TIDAK terpengaruh unit lain yang besar (no cross-leak)", () => {
    const items: SeqItem[] = [
      { name: "PONDASI FOOTPLAT", categoryName: "PEKERJAAN BANGUNAN GENSET", amount: 10n },
      { name: "PASANGAN DINDING BATA", categoryName: "PEKERJAAN BANGUNAN GENSET", amount: 10n },
      // unit dermaga raksasa dgn pondasi/pancang besar:
      { name: "TIANG PANCANG BETON", categoryName: "PEKERJAAN TAMBATAN PERAHU", amount: 100000n },
      { name: "PASANGAN BATU ARMOUR", categoryName: "PEKERJAAN REVETMENT", amount: 100000n },
    ];
    const placed = placeItems(items);
    const pond = placed.find((p) => p.categoryName.includes("GENSET") && p.stage === "pondasi")!;
    const din = placed.find((p) => p.categoryName.includes("GENSET") && p.stage === "dinding")!;
    expect(pond.end).toBeLessThanOrEqual(din.start + EPS); // tetap benar
  });
});

describe("deteksi tipe unit dari kategori (korpus KNMP)", () => {
  it("kategori bangunan → gedung; jalan → jalan; revetment/tambatan → marine", () => {
    expect(detectWorkType("PEKERJAAN BANGUNAN KIOS PERBEKALAN")).toBe("gedung");
    expect(detectWorkType("PEKERJAAN BANGUNAN GENSET")).toBe("gedung"); // rumah genset = bangunan (sipil + MEP)
    expect(detectWorkType("PEKERJAAN JALAN LINGKUNGAN DAN SALURAN")).toBe("jalan");
    expect(detectWorkType("PEKERJAAN REVETMENT")).toBe("marine");
    expect(detectWorkType("PEKERJAAN TAMBATAN PERAHU")).toBe("marine");
    expect(detectWorkType("PEKERJAAN PLUMBING DISTRIBUSI AIR BERSIH DAN SUMUR BOR")).toBe("utilitas");
    expect(detectWorkType("PEKERJAAN LANDSKAPING KAWASAN")).toBe("lansekap");
    expect(detectWorkType("PEKERJAAN PERSIAPAN")).toBe("umum");
  });
});

describe("jalan: marka & perkerasan urutannya benar", () => {
  it("aspal → perkerasan; agregat → lapis pondasi; marka → marka", () => {
    expect(classifyStage("jalan", "PEKERJAAN LAPIS AC-WC (ASPAL)")).toBe("perkerasan");
    expect(classifyStage("jalan", "PEKERJAAN AGREGAT KELAS A")).toBe("lapis_pondasi");
    expect(classifyStage("jalan", "PEKERJAAN MARKA JALAN THERMOPLASTIC")).toBe("marka");
  });
});

describe("kurva dari penjadwalan berurut", () => {
  const items: SeqItem[] = [
    { name: "PERSIAPAN K3", categoryName: "PEKERJAAN PERSIAPAN", amount: 50n },
    { name: "PONDASI FOOTPLAT", categoryName: "PEKERJAAN BANGUNAN KIOS", amount: 200n },
    { name: "KOLOM BETON K-250", categoryName: "PEKERJAAN BANGUNAN KIOS", amount: 300n },
    { name: "PASANGAN DINDING BATA", categoryName: "PEKERJAAN BANGUNAN KIOS", amount: 150n },
    { name: "PENGECATAN DINDING", categoryName: "PEKERJAAN BANGUNAN KIOS", amount: 80n },
    { name: "PASANG LAMPU DOWNLIGHT", categoryName: "PEKERJAAN BANGUNAN KIOS", amount: 20n },
  ];
  const curve = scheduleBySequence(items, 140); // 20 minggu

  it("mulai ~0, akhir 100, monoton naik", () => {
    expect(curve[0]).toBeLessThan(10);
    expect(Math.abs(curve[curve.length - 1] - 100)).toBeLessThanOrEqual(0.5);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });

  it("stageOrder mengembalikan urutan tahap tipe", () => {
    expect(stageOrder("gedung")[0]).toBe("persiapan");
    expect(stageOrder("jalan").at(-1)).toBe("marka");
  });
});

// ── PROOF: terhadap 547 item RAB KNMP nyata (15 file) ────────────────────────
describe("korpus RAB nyata: cakupan klasifikasi & tanpa error", () => {
  type CorpusItem = { count: number; value: number; cat: string };
  const corpus = JSON.parse(readFileSync("docs/rab-analysis/corpus.json", "utf8")) as {
    files: string[];
    items: Record<string, CorpusItem>;
  };
  const entries = Object.entries(corpus.items);

  it("15 file, 500+ item terbaca", () => {
    expect(corpus.files.length).toBe(15);
    expect(entries.length).toBeGreaterThan(500);
  });

  it("semua item terklasifikasi tanpa throw; cakupan tinggi (by value)", () => {
    let classifiedValue = 0;
    let totalValue = 0;
    let classifiedCount = 0;
    const stageHits = new Set<StageKey>();
    for (const [name, info] of entries) {
      const workType = detectWorkType(info.cat, [name]);
      const stage = classifyStage(workType, name, info.cat);
      stageHits.add(stage);
      const v = Math.max(0, info.value || 0);
      totalValue += v;
      if (stage !== "lainnya") {
        classifiedValue += v;
        classifiedCount++;
      }
    }
    const covByCount = classifiedCount / entries.length;
    const covByValue = totalValue > 0 ? classifiedValue / totalValue : 0;
    // Cetak untuk kalibrasi (muncul saat -v/vitest reporter).
    console.log(
      `[korpus] cakupan by-count=${(covByCount * 100).toFixed(1)}% by-value=${(covByValue * 100).toFixed(1)}% tahap-terpakai=${stageHits.size}`,
    );
    // Sisa ~1% adalah baris artefak (subtotal "JUMLAH…", label daftar bangunan),
    // bukan pekerjaan terjadwal — parser RAB app mengecualikannya.
    expect(covByCount).toBeGreaterThan(0.95);
    expect(covByValue).toBeGreaterThan(0.95);
  });

  it("tahap kunci gedung benar-benar terpakai pada data nyata", () => {
    const gedungStages = new Set<StageKey>();
    for (const [name, info] of entries) {
      if (detectWorkType(info.cat, [name]) === "gedung") {
        gedungStages.add(classifyStage("gedung", name, info.cat));
      }
    }
    for (const key of ["pondasi", "struktur", "dinding", "finishing"] as StageKey[]) {
      expect(gedungStages.has(key), `tahap ${key} harus muncul di data gedung nyata`).toBe(true);
    }
  });

  it("invarian per-unit: pada tiap kategori, akhir tahap-pred ≤ mulai tahap-succ", () => {
    // Bangun 'lokasi' sintetik dari korpus (item→kategori), tempatkan, cek hard-edge.
    const items: SeqItem[] = entries.map(([name, info]) => ({
      name,
      categoryName: info.cat || "(kosong)",
      amount: BigInt(Math.max(1, Math.round(info.value || 1))),
    }));
    const placed = placeItems(items);
    const byCat = new Map<string, typeof placed>();
    for (const p of placed) {
      const arr = byCat.get(p.categoryName) ?? [];
      arr.push(p);
      byCat.set(p.categoryName, arr);
    }
    for (const [cat, ps] of byCat) {
      const workType = ps[0].workType;
      const startOf = new Map<StageKey, number>();
      const endOf = new Map<StageKey, number>();
      for (const p of ps) {
        startOf.set(p.stage, Math.min(startOf.get(p.stage) ?? 1, p.start));
        endOf.set(p.stage, Math.max(endOf.get(p.stage) ?? 0, p.end));
      }
      for (const [pred, succ] of HARD_EDGES[workType]) {
        if (endOf.has(pred) && startOf.has(succ)) {
          expect(
            endOf.get(pred)! <= startOf.get(succ)! + EPS,
            `${cat} (${workType}): ${pred} harus selesai sebelum ${succ}`,
          ).toBe(true);
        }
      }
    }
  });
});
