import { describe, expect, it } from "vitest";
import {
  kunciBaris,
  rencanaGabung,
  statusPadanan,
  usulkanPadanan,
  type CatatanPadan,
  type KandidatDraft,
  type PilihanPadan,
} from "@/lib/luar-rab/padanan";

/**
 * PEKERJAAN DI LUAR RAB (DECISIONS 738): saran padanan ke item draft adendum
 * HATI-HATI – item dipilih otomatis hanya bila jelas unggul, satuannya sama,
 * dan namanya tidak kembar. Status pilihan menahan yang melebihi sisa draft,
 * yang bertabrakan dengan baris isian langsung, dan satuan beda yang belum
 * diterima orangnya.
 */

const k = (id: string, nama: string, satuan: string | null, over: Partial<KandidatDraft> = {}): KandidatDraft => ({
  id,
  lineageKey: `L-${id}`,
  kode: id,
  nama,
  jalur: [],
  satuan,
  volumeDraft: 100,
  sisa: 100,
  baru: true,
  ...over,
});

const c = (id: string, uraian: string, satuan: string, volume: number, reportId = "R1"): CatatanPadan => ({
  id,
  reportId,
  tanggal: "2026-11-03",
  uraian,
  satuan,
  volume,
});

const KANDIDAT = [
  k("A", "Pasangan Batu Kali Pondasi Talud", "m3"),
  k("B", "Plesteran Dinding 1:4", "m2"),
  k("C", "Pengecatan Tembok Baru", "m2"),
];

describe("usulkanPadanan", () => {
  it("memilih item yang jelas unggul dengan satuan sama", () => {
    const u = usulkanPadanan({ uraian: "Pasangan batu kali pondasi talud", satuan: "m³" }, KANDIDAT);
    expect(u.kandidatId).toBe("A");
    expect(u.alasanKosong).toBeNull();
    expect(u.saran[0]?.id).toBe("A");
  });

  it("satuan item termirip berbeda: tidak dipilih, tapi tetap ada di saran", () => {
    const u = usulkanPadanan({ uraian: "Pasangan batu kali pondasi talud", satuan: "m2" }, KANDIDAT);
    expect(u.kandidatId).toBeNull();
    expect(u.alasanKosong).toMatch(/Satuan/);
    expect(u.saran.map((s) => s.id)).toContain("A");
  });

  it("nama kembar di draft: tidak dipilih otomatis walaupun persis sama", () => {
    const kembar = [k("G1", "Galian Tanah", "m3", { jalur: ["Shelter"] }), k("G2", "Galian Tanah", "m3", { jalur: ["Gudang Beku"] })];
    const u = usulkanPadanan({ uraian: "Galian tanah", satuan: "m3" }, kembar);
    expect(u.kandidatId).toBeNull();
    expect(u.alasanKosong).toMatch(/beberapa item bernama/i);
    expect(u.saran).toHaveLength(2);
  });

  it("dua kandidat sama miripnya: tidak dipilih", () => {
    const mirip = [k("P1", "Plesteran Dinding Kamar Mandi", "m2"), k("P2", "Plesteran Dinding Kamar Tidur", "m2")];
    const u = usulkanPadanan({ uraian: "Plesteran dinding kamar", satuan: "m2" }, mirip);
    expect(u.kandidatId).toBeNull();
    expect(u.alasanKosong).toMatch(/sama miripnya/);
  });

  it("tidak ada yang mirip: kosong dengan alasannya", () => {
    const u = usulkanPadanan({ uraian: "Pemasangan pagar kawat duri", satuan: "m'" }, KANDIDAT);
    expect(u.kandidatId).toBeNull();
    expect(u.saran).toEqual([]);
    expect(u.alasanKosong).toMatch(/Tidak ada item draft yang mirip/);
  });
});

describe("statusPadanan + rencanaGabung", () => {
  const pilih = (catatanId: string, kandidatId: string | null, terimaSatuanBeda = false): PilihanPadan => ({
    catatanId,
    kandidatId,
    terimaSatuanBeda,
  });

  it("catatan yang menunjuk item sama dijumlahkan sebelum diadu dengan sisa draft", () => {
    const kand = [k("A", "Pasangan Batu Kali", "m3", { sisa: 10 })];
    const cat = [c("1", "pasangan batu", "m3", 6), c("2", "pasangan batu", "m3", 5, "R2")];
    const st = statusPadanan(cat, [pilih("1", "A"), pilih("2", "A")], kand, new Map());
    expect(st.get("1")?.status).toBe("melebihi");
    expect(st.get("2")?.status).toBe("melebihi");
    expect(st.get("1")?.pesan).toMatch(/11 m3 > sisa 10 m3/);
    // Satu saja yang dipilih: muat.
    const st2 = statusPadanan(cat, [pilih("1", "A"), pilih("2", null)], kand, new Map());
    expect(st2.get("1")?.status).toBe("siap");
    expect(st2.get("2")?.status).toBe("pilih_item");
  });

  it("tepat sama dengan sisa: boleh", () => {
    const kand = [k("A", "Pasangan Batu Kali", "m3", { sisa: 10 })];
    const st = statusPadanan([c("1", "x", "m3", 10)], [pilih("1", "A")], kand, new Map());
    expect(st.get("1")?.status).toBe("siap");
  });

  it("baris isian langsung di tanggal yang sama: ditahan, tidak dijumlahkan diam-diam", () => {
    const kand = [k("A", "Pasangan Batu Kali", "m3")];
    const ada = new Map([[kunciBaris("R1", "L-A"), { volume: 3, dariCatatan: false }]]);
    const st = statusPadanan([c("1", "x", "m3", 2)], [pilih("1", "A")], kand, ada);
    expect(st.get("1")?.status).toBe("bentrok");
    expect(st.get("1")?.pesan).toMatch(/diisi langsung/);
    // Baris yang isinya dari catatan juga: boleh menumpang.
    const ada2 = new Map([[kunciBaris("R1", "L-A"), { volume: 3, dariCatatan: true }]]);
    expect(statusPadanan([c("1", "x", "m3", 2)], [pilih("1", "A")], kand, ada2).get("1")?.status).toBe("siap");
    // Baris di laporan LAIN tidak bentrok.
    expect(statusPadanan([c("1", "x", "m3", 2, "R9")], [pilih("1", "A")], kand, ada).get("1")?.status).toBe("siap");
  });

  it("satuan beda ditahan sampai orangnya menerima", () => {
    const kand = [k("A", "Pasangan Batu Kali", "m3")];
    expect(statusPadanan([c("1", "x", "m2", 2)], [pilih("1", "A")], kand, new Map()).get("1")?.status).toBe("satuan_beda");
    expect(statusPadanan([c("1", "x", "m2", 2)], [pilih("1", "A", true)], kand, new Map()).get("1")?.status).toBe("siap");
    // Penulisan satuan yang berbeda tapi sama artinya bukan "beda".
    expect(statusPadanan([c("1", "x", "M³", 2)], [pilih("1", "A")], kand, new Map()).get("1")?.status).toBe("siap");
  });

  it("rencana: satu baris per (laporan, item), volumenya jumlah catatan yang siap", () => {
    const kand = [k("A", "Pasangan Batu Kali", "m3"), k("B", "Plesteran", "m2")];
    const cat = [
      c("1", "x", "m3", 1.25),
      c("2", "x", "m3", 2.5),
      c("3", "x", "m3", 4, "R2"),
      c("4", "x", "m2", 7),
      c("5", "x", "m2", 9),
    ];
    const p = [pilih("1", "A"), pilih("2", "A"), pilih("3", "A"), pilih("4", "B"), pilih("5", null)];
    const st = statusPadanan(cat, p, kand, new Map());
    const r = rencanaGabung(cat, p, kand, st);
    expect(r).toEqual([
      { reportId: "R1", kandidatId: "A", lineageKey: "L-A", catatanIds: ["1", "2"], volume: 3.75 },
      { reportId: "R2", kandidatId: "A", lineageKey: "L-A", catatanIds: ["3"], volume: 4 },
      { reportId: "R1", kandidatId: "B", lineageKey: "L-B", catatanIds: ["4"], volume: 7 },
    ]);
  });

  it("yang tidak siap tidak masuk rencana", () => {
    const kand = [k("A", "Pasangan Batu Kali", "m3", { sisa: 1 })];
    const cat = [c("1", "x", "m3", 2)];
    const p = [pilih("1", "A")];
    expect(rencanaGabung(cat, p, kand, statusPadanan(cat, p, kand, new Map()))).toEqual([]);
  });
});
