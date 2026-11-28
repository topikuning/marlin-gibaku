// MESIN TEMPLAT RAPL (DECISIONS 801).
//
// Ditulis ulang dari prototipe referensi user 2026-11-28 (`rapl-referensi`).
// Pembanding emasnya keluaran prototipe itu sendiri: lembar "Rincian" dari
// `contoh-keluaran-RAPL-6-lokasi.xlsx` – 376 uraian unik dari enam RAB MC0
// Bolaang Mongondow Timur, 1.818 komponen (nama, satuan, kategori, koefisien
// per satuan item, harga acuan). Uraian di berkas itu sudah dirapikan (tanpa
// "Pekerjaan" di depan), jadi tiap uraian dicoba juga dengan awalan aslinya.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  besiMenurutUraian,
  pvcMenurutUraian,
  semuaSumberDaya,
  uraiItem,
} from "@/lib/rapl-templat/urai";
import TEMPLAT from "@/lib/rapl-templat/templat.json";

type KomponenEmas = { nama: string; satuan: string; kategori: string; koefisien: number | null; harga: number | null };
type ItemEmas = { uraian: string; satuan: string; volume: number; komponen: KomponenEmas[] };

const emas = JSON.parse(
  readFileSync(new URL("../fixtures/rapl-templat-emas.json", import.meta.url), "utf8"),
) as ItemEmas[];

/** Dua uraian yang di berkas aslinya bergantung pada judul kelompok di atasnya. */
const INDUK: Record<string, string> = {
  "Pengadaan Barang": "Tiang menara toren tangki air 2000 liter, t = 4 m",
  Pengiriman: "Tiang menara toren tangki air 2000 liter, t = 4 m",
};

// En-dash dan em-dash (kode 2013/2014) disamakan dengan tanda hubung: prototipe menggantinya.
const rapi = (s: string) => s.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();

function cocokDenganEmas(e: ItemEmas): boolean {
  for (const uraian of [e.uraian, `Pekerjaan ${e.uraian}`]) {
    const h = uraiItem({ uraian, satuan: e.satuan, induk: INDUK[e.uraian] });
    if (h.komponen.length !== e.komponen.length) continue;
    const semua = h.komponen.every((k) => {
      const g = e.komponen.find((x) => rapi(x.nama) === rapi(k.nama) && x.kategori === k.kategori);
      if (!g || g.satuan !== k.satuan || g.koefisien == null) return false;
      // Koefisien emas = jumlah / volume, dengan jumlah dibulatkan 4 desimal.
      const koefOk =
        Math.abs(g.koefisien - k.koefisien) <= Math.max(1e-3, k.koefisien * 2e-3) ||
        Math.abs(g.koefisien * e.volume - Math.round(k.koefisien * e.volume * 1e4) / 1e4) < 1e-3;
      const hargaOk = k.hargaAcuan == null || g.harga == null || Math.abs(g.harga - k.hargaAcuan) < 1;
      return koefOk && hargaOk;
    });
    if (semua) return true;
  }
  return false;
}

describe("templat RAPL vs keluaran prototipe referensi", () => {
  it("ke-376 uraian terurai sama persis: komponen, satuan, kategori, koefisien, harga acuan", () => {
    const beda = emas.filter((e) => !cocokDenganEmas(e)).map((e) => `${e.uraian} (${e.satuan})`);
    expect(emas).toHaveLength(376);
    expect(beda).toEqual([]);
  });
});

describe("katalog dan templat", () => {
  it("setiap sumber daya di templat ada di katalog (kecuali penanda pilih-ukuran)", () => {
    const kunci = new Set(semuaSumberDaya().map((s) => s.kunci));
    const hilang = Object.entries(TEMPLAT as unknown as Record<string, [string, number][]>)
      .flatMap(([id, baris]) => baris.map(([k]) => [id, k] as const))
      .filter(([, k]) => !k.startsWith("@") && !kunci.has(k));
    expect(hilang).toEqual([]);
  });

  it("kategori katalog hanya lima kategori RAPL", () => {
    const kat = new Set(semuaSumberDaya().map((s) => s.kategori));
    expect([...kat].sort()).toEqual(["Alat dan Angkutan", "Bahan", "Upah"]);
  });
});

describe("pilih ukuran dari uraian", () => {
  it("besi beton mengikuti diameter; tanpa angka = D10", () => {
    expect(besiMenurutUraian("Pembesian dengan besi Ø8 mm")).toBe("d8");
    expect(besiMenurutUraian("Pembesian D13")).toBe("d13");
    expect(besiMenurutUraian("Pembesian D19")).toBe("d25");
    expect(besiMenurutUraian("Pembesian kolom")).toBe("d10");
  });

  it('pipa PVC mengikuti ukuran; tanpa ukuran = 2"', () => {
    expect(pvcMenurutUraian('Pipa PVC AW 1 ½"')).toBe("pvc15");
    expect(pvcMenurutUraian("Pipa PVC ¾ inch")).toBe("pvc075");
    expect(pvcMenurutUraian('Pipa PVC AW 3"')).toBe("pvc3");
    expect(pvcMenurutUraian("Pipa PVC")).toBe("pvc2");
  });
});

describe("komponen khusus: harga rujukan, bukan harga dipakai", () => {
  it("barang jadi tak dikenal: satu baris pengadaan, perkiraan 82% harga satuan RAB", () => {
    const h = uraiItem({ uraian: "Mesin pembuat es balok 5 ton", satuan: "unit" });
    expect(h.templat).toBe("GEN");
    expect(h.komponen).toEqual([
      expect.objectContaining({ kunci: null, kategori: "Bahan", nama: "Mesin pembuat es balok 5 ton", koefisien: 1, faktorHargaRab: 0.82, hargaAcuan: null }),
    ]);
  });

  it("biaya resmi tetap satu baris berharga RAB; sewa alat jadi mobilisasi", () => {
    expect(uraiItem({ uraian: "BPJS Ketenagakerjaan", satuan: "ls" }).komponen[0]).toMatchObject({
      kategori: "Jasa, Subkon dan Biaya Resmi",
      faktorHargaRab: 1,
    });
    expect(uraiItem({ uraian: "Excavator", satuan: "ls" }).komponen[0]).toMatchObject({
      kategori: "Alat dan Angkutan",
      nama: "Mobilisasi dan demobilisasi excavator",
    });
  });

  it("perlengkapan K3 memakai harga acuan bila dikenal", () => {
    expect(uraiItem({ uraian: "Sepatu keselamatan", satuan: "psg" }).komponen[0]).toMatchObject({
      hargaAcuan: 180000,
      faktorHargaRab: null,
    });
  });
});
