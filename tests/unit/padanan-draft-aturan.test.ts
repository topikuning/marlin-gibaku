/*
 * PEMETAAN ITEM TERLAPOR KE ITEM DRAFT ADENDUM – aturan murni (DECISIONS 754).
 *
 * Permintaan user 2026-11-10: *"intinya sebelum aktif item yang sudah
 * terlaporkan, harus bisa dipetakan dengan pekerjaan yang ada di draft
 * adendum"*. Sebelumnya pemetaan hanya bisa di layar pratinjau impor.
 *
 * Aturannya SAMA dengan pemetaan di pratinjau impor (`samakanLineage`): satu
 * lawan satu, jenis baris sama, kategori sama. Ditambah satu: satuan harus
 * sama – volume terlapor dipindah apa adanya, jadi m³ yang dibaca sebagai m²
 * adalah angka yang salah tanpa tanda.
 */
import { describe, expect, it } from "vitest";
import { periksaPadananDraft, satuanSetara, type NodePadanan } from "@/lib/rab/padanan-draft-aturan";

const lama = (o: Partial<NodePadanan> = {}): NodePadanan => ({
  lineageKey: "I#1",
  kind: "item",
  name: "Tapak beton menerus",
  unit: "m3",
  punyaAnak: false,
  lineageSemula: null,
  ...o,
});
const baru = (o: Partial<NodePadanan> = {}): NodePadanan => ({
  lineageKey: "I#3",
  kind: "item",
  name: "Pondasi batu belah",
  unit: "m3",
  punyaAnak: false,
  lineageSemula: null,
  ...o,
});
const konteks = {
  lineageAktif: new Set(["I", "I#1", "I#2", "II", "II#1"]),
  lineageDraft: new Set(["I", "I#2", "I#3", "II", "II#1"]),
};

describe("item kontrak yang VOLUMENYA 0 di draft (DECISIONS 756)", () => {
  /*
   * Keluhan user 2026-11-10: *"bisa jadi item yang jadi 0 dan sudah dikerjakan
   * juga perlu dipetakan, kenapa di konsep baru pencocokan tadi ini tidak ada"*.
   * Pratinjau impor menawarkannya; panel draft menolaknya sebagai "masih ada
   * di draft" – padahal saat aktivasi laporannya diturunkan jadi 0.
   */
  it("masih ada di draft tapi volumenya 0 → boleh dipasangkan ke item baru", () => {
    expect(
      periksaPadananDraft(lama({ lineageKey: "I#2", name: "Urugan pasir" }), baru(), {
        ...konteks,
        lineageDraftNol: new Set(["I#2"]),
      }),
    ).toBeNull();
  });

  it("masih ada di draft dengan volume → tetap ditolak", () => {
    expect(
      periksaPadananDraft(lama({ lineageKey: "I#2", name: "Urugan pasir" }), baru(), {
        ...konteks,
        lineageDraftNol: new Set(["II#1"]),
      }),
    ).toMatch(/masih ada di draft/);
  });

  it("volumeNol: kosong dan 0 dihitung nol, sisa pembulatan juga", async () => {
    const { volumeNol } = await import("@/lib/rab/padanan-draft-aturan");
    expect([null, 0, 0.0000001, 0.001, 5].map(volumeNol)).toEqual([true, true, true, false, false]);
  });
});

describe("periksaPadananDraft", () => {
  it("item kontrak yang hilang dari draft → item baru draft di kategori yang sama: boleh", () => {
    expect(periksaPadananDraft(lama(), baru(), konteks)).toBeNull();
  });

  it("item lama yang MASIH ada di draft tidak perlu dipasangkan", () => {
    expect(periksaPadananDraft(lama({ lineageKey: "I#2" }), baru(), konteks)).toMatch(/masih ada di draft/);
  });

  it("sasaran harus item BARU draft – item kontrak lama sudah punya realisasinya sendiri", () => {
    expect(periksaPadananDraft(lama(), baru({ lineageKey: "I#2", name: "Urugan pasir" }), konteks)).toMatch(
      /item kontrak lama/,
    );
  });

  it("sasaran yang sudah dipasangkan ke item lain ditolak – satu lawan satu", () => {
    expect(
      periksaPadananDraft(lama(), baru({ lineageKey: "I#9", lineageSemula: "I#3" }), {
        ...konteks,
        lineageDraft: new Set([...konteks.lineageDraft, "I#9"]),
      }),
    ).toMatch(/sudah dipasangkan/);
  });

  it("beda kategori ditolak – realisasinya akan pindah kategori di blanko KKP", () => {
    expect(
      periksaPadananDraft(lama(), baru({ lineageKey: "II#9" }), {
        ...konteks,
        lineageDraft: new Set([...konteks.lineageDraft, "II#9"]),
      }),
    ).toMatch(/Beda kategori/);
  });

  it("beda satuan ditolak, beda tulisan satuan yang sama tidak", () => {
    expect(periksaPadananDraft(lama(), baru({ unit: "m2" }), konteks)).toMatch(/satuan/);
    expect(periksaPadananDraft(lama({ unit: "M³" }), baru({ unit: "m3" }), konteks)).toBeNull();
    // Satuan kosong di salah satu sisi tidak bisa dibandingkan – tidak ditolak.
    expect(periksaPadananDraft(lama({ unit: null }), baru(), konteks)).toBeNull();
  });

  it("hanya baris pekerjaan tanpa rincian di bawahnya", () => {
    expect(periksaPadananDraft(lama(), baru({ kind: "kategori" }), konteks)).toMatch(/item pekerjaan/);
    expect(periksaPadananDraft(lama(), baru({ punyaAnak: true }), konteks)).toMatch(/rincian/);
  });
});

describe("satuanSetara", () => {
  it.each([
    ["m3", "M3"],
    ["m³", "m3"],
    ["m2", "m²"],
    [" Ls ", "ls"],
    ["m'", "m’"],
    ["Bh.", "bh"],
  ])("%s ≡ %s", (a, b) => {
    expect(satuanSetara(a, b)).toBe(true);
  });

  it("satuan berbeda tetap berbeda", () => {
    expect(satuanSetara("m3", "m2")).toBe(false);
    expect(satuanSetara("kg", "ton")).toBe(false);
  });
});
