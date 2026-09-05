// PEMETAAN TIDAK MENAMBAH VOLUME.
//
// Pertanyaan user 2026-09-03: *"apa maksudmu, padahal penambahan item baru di
// kategori III cuma 32,15 bagaimana laporan harian yang sudah diinput menyikapi
// ini"*.
//
// Kalimatku sebelumnya - "realisasi 45,7 m3 akan ikut" - benar tapi tidak
// lengkap, dan karena itu menyesatkan. Yang berpindah cuma IDENTITAS item.
// Laporan hariannya tidak disentuh sama sekali: volumeDone tetap 45,7. Yang
// berubah adalah dasar kontraknya, dan baris pengganti itu cuma 32,15.
//
// Jadi 13,55 m3 pekerjaan yang sudah dilaporkan kehilangan dasar bayarnya.
// Sistem HARUS mengatakannya, dan uji ini yang mengunci itu.
import { describe, expect, it } from "vitest";
import { bandingkanTerhadapAktif, type NodeAktif } from "@/lib/rab/diff-parsed";
import { samakanLineage, type NodeLamaCocok } from "@/lib/rab/cocok-lineage";
import type { FlatNode } from "@/lib/rab/flatten";

const KAT = "III";
const SUB = "III#III.1";
const LAMA = "III#III.1#1#1.a";
const BARU = "III#III.1#3#3.a";

const nl = (lineageKey: string, parent: string | null, kind: NodeLamaCocok["kind"], code: string, name: string): NodeLamaCocok => ({
  lineageKey, parentLineageKey: parent, kind, code, name, unit: "m3",
});

const kontrak: NodeLamaCocok[] = [
  nl(KAT, null, "kategori", "III", "PEKERJAAN DINDING PENAHAN TANAH"),
  nl(SUB, KAT, "sub", "III.1", "Pekerjaan Turap Beton"),
  nl(`${SUB}#1`, SUB, "grup", "1", "Pekerjaan Tapak Beton Menerus 30 x 140 cm"),
  nl(LAMA, `${SUB}#1`, "item", "1.a", "Pekerjaan Galian Tanah sampai dengan 1 m"),
];

const nb = (
  lineageKey: string, parent: string | null, kind: FlatNode["kind"], code: string, name: string, volume: number | null,
): FlatNode => ({
  kind, code, name, volume, unit: "m3", unitPrice: 88_734.87,
  amount: BigInt(Math.round((volume ?? 0) * 88_734.87)),
  lineageKey, parentLineageKey: parent, sortOrder: 0,
});

const berkas: FlatNode[] = [
  nb(KAT, null, "kategori", "III", "PEKERJAAN DINDING PENAHAN TANAH", null),
  nb(SUB, KAT, "sub", "III.1", "Pekerjaan Turap Beton", null),
  nb(`${SUB}#1`, SUB, "grup", "1", "Pekerjaan Tapak Beton Menerus 30 x 140 cm", null),
  nb(LAMA, `${SUB}#1`, "item", "1.a", "Pekerjaan Galian Tanah sampai dengan 1 m", 0),
  nb(`${SUB}#3`, SUB, "grup", "3", "Pekerjaan Pondasi Batu Belah", null),
  nb(BARU, `${SUB}#3`, "item", "3.a", "Pekerjaan Galian Tanah keras s.d 1 m", 32.1493),
];

const aktif: NodeAktif[] = [
  { lineageKey: KAT, parentLineageKey: null, kind: "kategori", code: "III", name: "PEKERJAAN DINDING PENAHAN TANAH", volume: null, unitPrice: null, amount: 4_055_183n },
  { lineageKey: LAMA, parentLineageKey: KAT, kind: "item", code: "1.a", name: "Pekerjaan Galian Tanah sampai dengan 1 m", volume: 45.7, unitPrice: 88_734.87, amount: 4_055_183n },
];

/** Laporan harian: 45,7 m3 sudah dikerjakan atas item lama. */
const realisasi = new Map<string, number>([[LAMA, 45.7]]);

describe("realisasi yang melampaui baris penggantinya DIKATAKAN, tidak didiamkan", () => {
  const h = samakanLineage(berkas, kontrak, {
    padanan: [{ lineageBaru: BARU, lineageLama: LAMA }],
  });

  it("item baru memang mewarisi kunci item lama", () => {
    expect(h.nodes.find((n) => n.code === "3.a")!.lineageKey).toBe(LAMA);
  });

  it("dan hasilnya volume DI BAWAH realisasi – itu yang harus terlihat", () => {
    const beda = bandingkanTerhadapAktif(aktif, h.nodes, realisasi);
    const baris = beda.volumeBerubah.find((v) => v.lineageKey === LAMA)!;
    expect(baris.dari).toBe(45.7);
    expect(baris.ke).toBeCloseTo(32.1493, 4);
    expect(baris.realisasi).toBe(45.7);
    expect(baris.dibawahRealisasi).toBe(true);
    // 13,55 m3 pekerjaan yang sudah dilaporkan tanpa dasar bayar.
    expect(baris.realisasi - (baris.ke ?? 0)).toBeCloseTo(13.5507, 4);
  });

  it("pemetaan ke baris yang CUKUP besar tidak menyalakan peringatan itu", () => {
    const berkasCukup = berkas.map((n) => (n.lineageKey === BARU ? { ...n, volume: 50 } : n));
    const h2 = samakanLineage(berkasCukup, kontrak, {
      padanan: [{ lineageBaru: BARU, lineageLama: LAMA }],
    });
    const beda = bandingkanTerhadapAktif(aktif, h2.nodes, realisasi);
    expect(beda.volumeBerubah.find((v) => v.lineageKey === LAMA)?.dibawahRealisasi).toBe(false);
  });
});
