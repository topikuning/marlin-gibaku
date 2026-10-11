/*
 * ANALISA AI URUTAN RAB → DASAR SARAN RENCANA MINGGUAN (DECISIONS 667).
 *
 * Permintaan user 2026-10-11: *"marlin langsung kirim rab ke AI, untuk
 * dianalisa secara real time dan maksimal, untuk kemudian bisa dijadikan dasar
 * saran rencana pekerjaan mingguan"*.
 *
 * Yang diuji: jawaban AI disaring sebelum dipakai (kunci karangan dibuang,
 * prasyarat melingkar diputus), lalu urutan & prasyarat AI benar-benar
 * mengubah saran – sementara volume target tetap hitungan kode.
 */
import { describe, expect, it } from "vitest";
import {
  bagiKelompok,
  ITEM_PER_BAGIAN,
  normalisasiKelompok,
  petaJadwalAi,
  promptKelompok,
  type JadwalAiItem,
  type PekerjaanRab,
} from "@/lib/plan/jadwal-ai-murni";
import { computeSuggestions } from "@/lib/plan/suggest-core";

const kerja = (lineageKey: string, name = `Pekerjaan ${lineageKey}`): PekerjaanRab => ({
  lineageKey,
  code: lineageKey.split("#").pop()!,
  name,
  unit: "m3",
  volume: 10,
  jalur: "",
});

describe("bagiKelompok – satu permintaan per bangunan", () => {
  it("pekerjaan masuk ke kategori dengan prefix TERPANJANG, bangunan tanpa pekerjaan dilewati", () => {
    const k = bagiKelompok(
      [
        { lineageKey: "II", name: "BALAI" },
        { lineageKey: "II#B", name: "BALAI – MEP" },
        { lineageKey: "III", name: "KOSONG" },
      ],
      [kerja("II#A#1"), kerja("II#B#1"), kerja("IX#1")],
    );
    expect(k.map((x) => [x.kategoriKey, x.item.map((i) => i.lineageKey)])).toEqual([
      ["II", ["II#A#1"]],
      ["II#B", ["II#B#1"]],
    ]);
  });

  it("bangunan besar dipecah per ITEM_PER_BAGIAN, tiap bagian tetap kenal seluruh bangunannya", () => {
    const item = Array.from({ length: ITEM_PER_BAGIAN + 5 }, (_, i) => kerja(`II#${i + 1}`));
    const k = bagiKelompok([{ lineageKey: "II", name: "BALAI" }], item);
    expect(k.map((x) => [x.bagian, x.item.length, x.semua.length])).toEqual([
      [1, ITEM_PER_BAGIAN, ITEM_PER_BAGIAN + 5],
      [2, 5, ITEM_PER_BAGIAN + 5],
    ]);
    const p = promptKelompok(k[1], { lokasi: "Kedung", kabupaten: "Jepara", provinsi: "Jateng", mingguKontrak: 20 }, 2);
    expect(p).toContain("bagian 2 dari 2");
    expect(p).toContain("PEKERJAAN LAIN DI BANGUNAN INI");
    expect(p).toContain("JANGAN MENGARANG");
    expect(p).toContain("BUKAN angka resmi");
  });
});

describe("normalisasiKelompok – jawaban AI disaring dulu", () => {
  const kel = bagiKelompok([{ lineageKey: "II", name: "BALAI" }], [kerja("II#1"), kerja("II#2"), kerja("II#3")])[0];
  const semua = new Set(["II#1", "II#2", "II#3", "III#9"]);

  it("kunci karangan & ganda dibuang, porsi dijepit 0..1, rentang terbalik dibalik, rentang sempit dilebarkan", () => {
    const n = normalisasiKelompok(kel, semua, {
      catatan: "  Pondasi dulu,   lalu struktur. ",
      item: [
        { kunci: "II#1", mulai: -0.2, selesai: 0.3, prasyarat: [], kritis: true, cuaca: true, alasan: "galian awal" },
        { kunci: "II#1", mulai: 0.5, selesai: 0.6, prasyarat: [], kritis: false, cuaca: false, alasan: "ganda" },
        { kunci: "II#2", mulai: 0.9, selesai: 0.4, prasyarat: ["II#1", "II#2", "X#1", "III#9"], kritis: false, cuaca: false, alasan: "" },
        { kunci: "II#3", mulai: 0.99, selesai: 0.99, prasyarat: [], kritis: false, cuaca: false, alasan: "" },
        { kunci: "KARANG#1", mulai: 0, selesai: 1, prasyarat: [], kritis: false, cuaca: false, alasan: "" },
      ],
    });
    expect(n.dibuang).toBe(2);
    expect(n.catatan).toBe("Pondasi dulu, lalu struktur.");
    expect(n.item["II#1"]).toMatchObject({ mulai: 0, selesai: 0.3, kritis: true, cuaca: true });
    // Dirinya sendiri & kunci yang tidak ada di revisi dibuang; lintas bangunan yang ADA boleh.
    expect(n.item["II#2"]).toMatchObject({ mulai: 0.4, selesai: 0.9, prasyarat: ["II#1", "III#9"] });
    expect(n.item["II#3"]).toMatchObject({ mulai: 0.95, selesai: 1 });
  });
});

describe("petaJadwalAi – prasyarat melingkar diputus", () => {
  it("A menunggu B dan B menunggu A → hanya sisi pertama yang dipakai", () => {
    const j = (prasyarat: string[]): JadwalAiItem => ({ mulai: 0, selesai: 1, prasyarat, kritis: false, cuaca: false, alasan: "" });
    const peta = petaJadwalAi([
      { catatan: "", item: { A: j(["B"]), B: j(["C"]) } },
      { catatan: "", item: { C: j(["A"]), D: j(["A"]) } },
    ]);
    expect(peta.get("A")!.prasyarat).toEqual(["B"]);
    expect(peta.get("B")!.prasyarat).toEqual(["C"]);
    expect(peta.get("C")!.prasyarat).toEqual([]); // C → A menutup lingkaran
    expect(peta.get("D")!.prasyarat).toEqual(["A"]);
  });
});

describe("computeSuggestions memakai urutan AI", () => {
  const leaf = (lineageKey: string, name: string, over: Record<string, unknown> = {}) => ({
    rabNodeId: lineageKey,
    code: lineageKey,
    name,
    unit: "m3",
    categoryKey: "II",
    categoryName: "PEKERJAAN BALAI NELAYAN",
    volume: 100,
    unitPrice: 1000,
    lineageKey,
    ...over,
  });
  const ai = (o: Partial<JadwalAiItem> = {}): JadwalAiItem => ({
    mulai: 0,
    selesai: 1,
    prasyarat: [],
    kritis: false,
    cuaca: false,
    alasan: "",
    ...o,
  });
  const jendela = (): [number, number] => [0, 1];

  it("tanpa analisa AI → aturan bawaan, ditandai 'aturan'", () => {
    const res = computeSuggestions([leaf("II#1", "Pekerjaan pondasi")], new Map(), 5, 20, 20, jendela);
    expect(res[0]).toMatchObject({ sumberUrutan: "aturan", alasanAi: null, kritis: false, pekaCuaca: false });
  });

  it("porsi waktu dari AI menentukan kapan pekerjaan mulai disarankan", () => {
    // Aturan bawaan menganggap "Pekerjaan pondasi" sudah jalan di minggu 5 dari 20.
    const it1 = leaf("II#1", "Pekerjaan pondasi");
    expect(computeSuggestions([it1], new Map(), 5, 20, 20, jendela)).toHaveLength(1);
    // AI menaruhnya di paruh akhir jendela bangunan → minggu 5 belum waktunya.
    const peta = new Map([["II#1", ai({ mulai: 0.5, selesai: 0.8, alasan: "menunggu lahan" })]]);
    expect(computeSuggestions([it1], new Map(), 5, 20, 20, jendela, peta)).toHaveLength(0);
    const m12 = computeSuggestions([it1], new Map(), 12, 20, 20, jendela, peta);
    expect(m12[0]).toMatchObject({ sumberUrutan: "ai", alasanAi: "menunggu lahan" });
    // Volume target tetap hitungan kode, tidak pernah dari AI.
    expect(m12[0].targetVolume).toBeGreaterThan(0);
    expect(m12[0].targetVolume).toBeLessThanOrEqual(100);
  });

  it("prasyarat dari AI menahan pekerjaan sampai prasyaratnya ≥ 80%", () => {
    const cor = leaf("II#2", "Pengecoran plat lantai");
    const besi = leaf("II#1", "Pembesian plat lantai");
    const peta = new Map([
      ["II#1", ai({ mulai: 0, selesai: 0.5 })],
      ["II#2", ai({ mulai: 0, selesai: 0.6, prasyarat: ["II#1"] })],
    ]);
    const nama = (r: ReturnType<typeof computeSuggestions>) => r.map((s) => s.rabNodeId);
    expect(nama(computeSuggestions([besi, cor], new Map([["II#1", 50]]), 8, 20, 20, jendela, peta))).toEqual(["II#1"]);
    expect(nama(computeSuggestions([besi, cor], new Map([["II#1", 85]]), 8, 20, 20, jendela, peta))).toContain("II#2");
  });

  it("pekerjaan kritis menurut AI didahulukan walau nilainya lebih kecil", () => {
    const kecil = leaf("II#1", "Pekerjaan A", { unitPrice: 900 });
    const besar = leaf("II#2", "Pekerjaan B", { unitPrice: 1000 });
    const peta = new Map([
      ["II#1", ai({ kritis: true, cuaca: true })],
      ["II#2", ai()],
    ]);
    const res = computeSuggestions([kecil, besar], new Map(), 5, 20, 20, jendela, peta);
    expect(res.map((s) => s.rabNodeId)).toEqual(["II#1", "II#2"]);
    expect(res[0]).toMatchObject({ kritis: true, pekaCuaca: true, priority: 1 });
  });
});
