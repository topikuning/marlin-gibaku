// PEMETAAN MANUAL: item lama yang DINOLKAN dipasangkan ke item baru di draft.
//
// Permintaan user 2026-09-02: *"mungkin lebih pas jika item yang sudah diinput
// di laporan harian lalu di draft dinolkan, bisa dimatch manual dengan item
// baru yang ada di draft, ini mungkin akan lebih fleksibel."*
//
// Keadaan nyata (tangkapan layar user): "1.a Pekerjaan Galian Tanah sampai
// dengan 1 m - 103.3 -> 0, sudah dikerjakan 60". Pekerjaannya tidak batal; ia
// dipecah/diganti nama menjadi item lain di berkas yang sama. Pencocokan
// otomatis tidak bisa menebak itu: namanya berbeda DAN nomornya berbeda.
//
// Caranya sengaja lewat PEWARISAN lineage, bukan menulis ulang laporan harian:
// realisasi dikunci pada `lineageKey`, jadi begitu item baru mewarisi kunci
// item lama, realisasinya ikut dengan sendirinya - tanpa satu baris laporan pun
// disentuh.
import { describe, expect, it } from "vitest";
import { samakanLineage, type NodeLamaCocok } from "@/lib/rab/cocok-lineage";
import type { FlatNode } from "@/lib/rab/flatten";

const lama = (o: Partial<NodeLamaCocok> & Pick<NodeLamaCocok, "lineageKey" | "code" | "name">): NodeLamaCocok => ({
  parentLineageKey: "I", kind: "item", unit: "m3", ...o,
});
const baru = (o: Partial<FlatNode> & Pick<FlatNode, "lineageKey" | "code" | "name">): FlatNode => ({
  kind: "item", volume: 0, unit: "m3", unitPrice: 0, amount: 0n,
  parentLineageKey: "I", sortOrder: 0, ...o,
});

const KONTRAK: NodeLamaCocok[] = [
  { lineageKey: "I", parentLineageKey: null, kind: "kategori", code: "I", name: "PEKERJAAN TANAH", unit: null },
  lama({ lineageKey: "I#1.a", code: "1.a", name: "Pekerjaan Galian Tanah sampai dengan 1 m" }),
  lama({ lineageKey: "I#1.b", code: "1.b", name: "Pekerjaan Urugan Kembali" }),
];

/** Berkas: 1.a DINOLKAN, dan muncul item baru 1.c yang maksudnya sama. */
const BERKAS: FlatNode[] = [
  { kind: "kategori", code: "I", name: "PEKERJAAN TANAH", volume: null, unit: null, unitPrice: null, amount: 0n, lineageKey: "I", parentLineageKey: null, sortOrder: 0 },
  baru({ lineageKey: "I#1.a", code: "1.a", name: "Pekerjaan Galian Tanah sampai dengan 1 m", volume: 0 }),
  baru({ lineageKey: "I#1.b", code: "1.b", name: "Pekerjaan Urugan Kembali", volume: 5 }),
  baru({ lineageKey: "I#1.c", code: "1.c", name: "Galian Tanah Biasa kedalaman 0-1 m", volume: 103.3 }),
];

const kunci = (h: { nodes: FlatNode[] }, code: string) =>
  h.nodes.find((n) => n.code === code)!.lineageKey;

describe("tanpa pemetaan, item baru tetap item baru", () => {
  it("1.c tidak mewarisi apa pun, dan 1.a tetap memegang kuncinya", () => {
    const h = samakanLineage(BERKAS, KONTRAK);
    expect(kunci(h, "1.a")).toBe("I#1.a");
    expect(kunci(h, "1.c")).toBe("I#1.c");
  });
});

describe("dengan pemetaan manual, realisasi ikut lewat pewarisan kunci", () => {
  it("1.c mewarisi kunci 1.a - itulah yang membuat realisasinya ikut", () => {
    const h = samakanLineage(BERKAS, KONTRAK, {
      padanan: [{ lineageBaru: "I#1.c", lineageLama: "I#1.a" }],
    });
    expect(kunci(h, "1.c")).toBe("I#1.a");
    expect(h.padananDipakai).toHaveLength(1);
    expect(h.padananDipakai[0].name).toBe("Galian Tanah Biasa kedalaman 0-1 m");
  });

  it("baris lama yang dinolkan TETAP tercantum, dengan kunci segar", () => {
    // Barisnya tidak dibuang: berkas user dipakai apa adanya (DECISIONS 203).
    // Nilainya nol, jadi tidak ada rupiah yang bergeser karenanya.
    const h = samakanLineage(BERKAS, KONTRAK, {
      padanan: [{ lineageBaru: "I#1.c", lineageLama: "I#1.a" }],
    });
    const tua = h.nodes.find((n) => n.code === "1.a")!;
    expect(tua.lineageKey).not.toBe("I#1.a");
    expect(tua.volume).toBe(0);
  });

  it("pemetaan menang atas pencocokan nama maupun nomor", () => {
    // 1.b namanya cocok persis; kalau pemetaan diproses belakangan, 1.b sudah
    // terlanjur mengklaim dan hasilnya berubah tanpa sebab yang terlihat.
    const h = samakanLineage(BERKAS, KONTRAK, {
      padanan: [{ lineageBaru: "I#1.c", lineageLama: "I#1.b" }],
    });
    expect(kunci(h, "1.c")).toBe("I#1.b");
    expect(kunci(h, "1.b")).not.toBe("I#1.b");
  });

  it("satu item kontrak tidak bisa diklaim dua pemetaan", () => {
    const h = samakanLineage(BERKAS, KONTRAK, {
      padanan: [
        { lineageBaru: "I#1.c", lineageLama: "I#1.a" },
        { lineageBaru: "I#1.b", lineageLama: "I#1.a" },
      ],
    });
    expect(h.padananDipakai).toHaveLength(1);
    expect(h.padananDitolak).toHaveLength(1);
    expect(h.padananDitolak[0].sebab).toMatch(/sudah dipakai/i);
  });
});

describe("pemetaan yang tidak sah DITOLAK dengan sebabnya, bukan didiamkan", () => {
  it("item kontrak tidak ada", () => {
    const h = samakanLineage(BERKAS, KONTRAK, {
      padanan: [{ lineageBaru: "I#1.c", lineageLama: "I#9.z" }],
    });
    expect(h.padananDipakai).toEqual([]);
    expect(h.padananDitolak[0].sebab).toMatch(/tidak ditemukan/i);
  });

  it("beda KATEGORI ditolak - kunci menentukan kategori di enam tempat lain", () => {
    const kontrakDuaKategori: NodeLamaCocok[] = [
      ...KONTRAK,
      { lineageKey: "II", parentLineageKey: null, kind: "kategori", code: "II", name: "PEKERJAAN STRUKTUR", unit: null },
      { lineageKey: "II#2.a", parentLineageKey: "II", kind: "item", code: "2.a", name: "Beton", unit: "m3" },
    ];
    const h = samakanLineage(BERKAS, kontrakDuaKategori, {
      padanan: [{ lineageBaru: "I#1.c", lineageLama: "II#2.a" }],
    });
    expect(h.padananDipakai).toEqual([]);
    expect(h.padananDitolak[0].sebab).toMatch(/kategori/i);
  });
});
