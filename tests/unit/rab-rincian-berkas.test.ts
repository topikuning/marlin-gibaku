/*
 * BACKUP VOLUME, ANALISA, DAN BAHAN & UPAH DIBACA DARI BERKAS RAB NYATA
 * (DECISIONS baru 2026-10-06).
 *
 * Teguran user: *"dalam konteks konstruksi ada istilah back up volume, kenapa
 * kamu sama sekali tidak akomodir ini … begitu pula analisa, resume analisa dan
 * item bahan dan upah, yang sama sekali tidak disimpan di marlin"*.
 *
 * Yang dijaga di sini, pada berkas KKP sungguhan:
 *   1. volume item ditelusuri lewat RUMUS ke sheet backup volume, berikut
 *      baris-baris perhitungannya;
 *   2. analisa item ditemukan lewat rumus di baris item (kolom mana pun);
 *      kalau tidak ada rumus, hanya dicocokkan bila harganya sama persis
 *      dengan SATU baris Resume Analisa – dan caranya dicatat;
 *   3. komponen analisa terurai (upah/bahan + koefisien × harga) dan bahan &
 *      upah yang dipakai ikut terbaca;
 *   4. berkas yang angkanya diketik langsung TIDAK dicarikan pasangan;
 *   5. tidak ada yang mengubah angka hasil impor;
 *   6. ringan: berkas 3 MB / 45 sheet selesai jauh di bawah batas server.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";
import { flattenParsedRab } from "@/lib/rab/flatten";
import { bacaRincian } from "@/lib/rab/rincian/baca";

async function baca(nama: string) {
  const buf = readFileSync(`tests/fixtures/${nama}`);
  const res = await parseHpsBuffer(buf);
  const nodes = flattenParsedRab(res.parsed).filter((n) => n.kind === "item" && n.excelRow != null);
  const mulai = Date.now();
  const r = await bacaRincian(buf, {
    sheetRab: res.sheetName,
    kolom: res.kolom,
    items: nodes.map((n) => ({ kunci: n.lineageKey, excelRow: n.excelRow!, unitPrice: n.unitPrice })),
  });
  return { r, nodes, detik: (Date.now() - mulai) / 1000 };
}

describe("Karangmangu (MC-0, tautan analisa lewat kolom NILAI TKDN)", () => {
  it("volume ditelusuri ke sheet backup, lengkap dengan baris perhitungannya", async () => {
    const { r, nodes, detik } = await baca("mc0-karangmangu-blok-cco01-tkdn.xlsx");
    expect(detik).toBeLessThan(15);
    const i = nodes.findIndex((n) => n.excelRow === 104);
    const v = r.items[i]!.volume;
    expect(v.status).toBe("tertaut");
    expect(v.sumber).toEqual([{ sheet: "2. Vol Revetment", sel: "M23", tersembunyi: false, nilai: 8.7 }]);
    // Baris 23 (beton) bergantung pada panjang tipikal di baris 12 → keduanya ikut.
    const baris = v.baris.map((b) => b.baris);
    expect(baris).toContain(23);
    expect(baris).toContain(12);
    expect(r.kepala["2. Vol Revetment"]).toMatchObject({ 3: "PANJANG", 4: "LEBAR", 5: "TINGGI" });

    expect(r.ringkasan.item).toBe(583);
    expect(r.ringkasan.volumeTertaut).toBeGreaterThan(500);
    // Volume RAB tetap angka yang dibaca parser – pelacak tidak mengubahnya.
    expect(nodes[i]!.volume).toBe(8.7);
  });

  it("analisa + komponen + bahan & upah terbaca dari rumus", async () => {
    const { r, nodes } = await baca("mc0-karangmangu-blok-cco01-tkdn.xlsx");
    const i = nodes.findIndex((n) => n.excelRow === 75);
    const a = r.items[i]!.analisa!;
    expect(a.cara).toBe("rumus");
    const blok = r.blokAnalisa.get(a.kunciBlok)!;
    expect(blok.kode).toBe("2.2.2.1.2");
    expect(blok.uraian).toMatch(/Pondasi Batu Belah 1 : 2/);
    expect(blok.hargaSatuan).toBeCloseTo(nodes[i]!.unitPrice!, 2);
    expect(blok.overhead).toBeCloseTo(0.15, 6);
    expect(blok.komponen.map((k) => [k.kategori, k.nama, k.koefisien, k.satuan])).toEqual([
      ["bahan", "Batu Belah", 1.2, "m³"],
      ["bahan", "Semen", 252, "kg"],
      ["bahan", "Pasir pasang", 0.44, "m³"],
      ["upah", "Pekerja", 1.5, "org/hr"],
      ["upah", "Tukang batu", 0.5, "org/hr"],
      ["upah", "Mandor", 0.15, "org/hr"],
    ]);
    expect(blok.komponen[0]!.rujukanHarga).toEqual({ sheet: "Bahan & Upah", sel: "C15" });
    const pekerja = r.hargaDasar.find((h) => h.sel === "C336")!;
    expect(pekerja).toMatchObject({ sheet: "Bahan & Upah", nama: "Pekerja / Kenek", satuan: "org/hr", harga: 104729.07 });
  });

  it("sheet backup TERSEMBUNYI yang dirujuk rumus RAB dibaca dan disebut", async () => {
    const { r } = await baca("mc0-karangmangu-blok-cco01-tkdn.xlsx");
    expect(r.tersembunyiDibaca).toEqual(["14. Vol Genset"]);
  });
});

describe("Pasar Banggi (harga diketik, tanpa rumus ke analisa)", () => {
  it("analisa hanya dicocokkan lewat harga yang sama persis, dan caranya dicatat", async () => {
    const { r, nodes } = await baca("mc0-pasar-banggi-blok-cco01.xlsx");
    expect(r.ringkasan.analisaRumus).toBe(0);
    expect(r.ringkasan.analisaCocokHarga).toBeGreaterThan(900);
    for (const [i, it] of r.items.entries()) {
      if (!it.analisa) continue;
      expect(it.analisa.cara).toBe("cocok_harga");
      expect(r.blokAnalisa.get(it.analisa.kunciBlok)!.hargaSatuan).toBeCloseTo(nodes[i]!.unitPrice!, 2);
    }
  });
});

describe("Betah Walang (harga kontrak ≠ harga analisa)", () => {
  it("selisih harga disebut, bukan disamakan", async () => {
    const { r } = await baca("mc1-betah-walang-cco01.xlsx");
    expect(r.ringkasan.analisaRumus).toBeGreaterThan(400);
    expect(r.ringkasan.hargaBeda).toBeGreaterThan(400);
  });
});

describe("Situbondo (angka diketik langsung)", () => {
  it("tidak ada yang dicarikan pasangan", async () => {
    const { r } = await baca("rab-aktif-situbondo.xlsx");
    expect(r.ringkasan.volumeTertaut).toBe(0);
    expect(r.ringkasan.volumeAngkaLangsung).toBe(r.ringkasan.item);
    expect(r.ringkasan.analisaRumus + r.ringkasan.analisaCocokHarga).toBe(0);
    expect(r.blokAnalisa.size).toBe(0);
  });
});
