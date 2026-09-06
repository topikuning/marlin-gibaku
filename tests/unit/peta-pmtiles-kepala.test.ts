// PETA ABU-ABU HARUS MENYEBUT SEBABNYA.
//
// Keluhan user 2026-09-06: *"berhasil didownload, tapi malah jadi abu2. apa
// masalahmu sebenarnya!"*
//
// Berkas peta bisa "berhasil diunduh" dalam tiga rupa yang tetap menghasilkan
// kanvas abu-abu, dan ketiganya diam kalau yang diperiksa cuma ukuran berkas:
// bukan PMTiles sama sekali, PMTiles berisi ubin gambar, atau PMTiles vektor
// dengan skema lapisan yang berbeda. Yang diuji di sini pembacaannya — dengan
// kepala buatan, supaya tidak perlu berkas 300 MB.
import { describe, expect, it } from "vitest";
import {
  PANJANG_KEPALA,
  bacaKepalaPmtiles,
  cuplikan,
  namaLapisanMeta,
  skemaCocok,
} from "@/lib/peta/pmtiles";

/** Kepala PMTiles v3 buatan — hanya ruas yang dibaca kode yang diisi. */
function kepalaBuatan(opsi: {
  magic?: string;
  versi?: number;
  jenisUbin?: number;
  zoomMin?: number;
  zoomMax?: number;
  metaOffset?: number;
  metaPanjang?: number;
  kompresiDalam?: number;
} = {}): Uint8Array {
  const b = Buffer.alloc(PANJANG_KEPALA);
  b.write(opsi.magic ?? "PMTiles", 0, "ascii");
  b.writeUInt8(opsi.versi ?? 3, 7);
  b.writeBigUInt64LE(BigInt(opsi.metaOffset ?? 200), 24);
  b.writeBigUInt64LE(BigInt(opsi.metaPanjang ?? 50), 32);
  b.writeUInt8(opsi.kompresiDalam ?? 2, 97); // gzip
  b.writeUInt8(opsi.jenisUbin ?? 1, 99); // vektor
  b.writeUInt8(opsi.zoomMin ?? 0, 100);
  b.writeUInt8(opsi.zoomMax ?? 12, 101);
  b.writeInt32LE(Math.round(94.9 * 1e7), 102);
  b.writeInt32LE(Math.round(-11.2 * 1e7), 106);
  b.writeInt32LE(Math.round(141.1 * 1e7), 110);
  b.writeInt32LE(Math.round(6.3 * 1e7), 114);
  return b;
}

describe("membaca kepala PMTiles", () => {
  it("kepala sah dibaca lengkap – jenis ubin, jangkauan zoom, batas wilayah", () => {
    const h = bacaKepalaPmtiles(kepalaBuatan());
    expect(h.sah).toBe(true);
    if (!h.sah) return;
    expect(h.kepala.jenisUbin).toBe("vektor");
    expect(h.kepala.zoomMin).toBe(0);
    expect(h.kepala.zoomMax).toBe(12);
    expect(h.kepala.batas[0]).toBeCloseTo(94.9, 4);
    expect(h.kepala.batas[3]).toBeCloseTo(6.3, 4);
    expect(h.kepala.metaOffset).toBe(200);
    expect(h.kepala.kompresiDalam).toBe("gzip");
  });

  it("HALAMAN HTML yang tersimpan sebagai .pmtiles ditolak – dan isinya dikutip", () => {
    // Inilah bentuk kegagalan yang paling menipu: alamat salah menjawab 200
    // berisi halaman, berkasnya punya ukuran, lalu dipuji "Terpasang".
    const html = Buffer.from("<!DOCTYPE html><html><head><title>Not Found</title>");
    const h = bacaKepalaPmtiles(html);
    expect(h.sah).toBe(false);
    if (h.sah) return;
    expect(h.sebab).toContain("bukan berkas PMTiles");
    expect(h.sebab).toContain("<!DOCTYPE html>");
  });

  it("berkas terpotong disebut terpotong, bukan 'tidak dikenal'", () => {
    const h = bacaKepalaPmtiles(kepalaBuatan().subarray(0, 40));
    expect(h.sah).toBe(false);
    if (h.sah) return;
    expect(h.sebab).toContain("terlalu pendek");
  });

  it("PMTiles versi lama ditolak dengan menyebut versinya", () => {
    const h = bacaKepalaPmtiles(kepalaBuatan({ versi: 2 }));
    expect(h.sah).toBe(false);
    if (h.sah) return;
    expect(h.sebab).toContain("versi 2");
  });

  it("arsip ubin PNG terbaca sebagai png – bukan vektor, jadi bukan peta dasar", () => {
    const h = bacaKepalaPmtiles(kepalaBuatan({ jenisUbin: 2 }));
    expect(h.sah).toBe(true);
    if (!h.sah) return;
    expect(h.kepala.jenisUbin).toBe("png");
  });

  it("cuplikan mengganti byte tak tercetak dengan titik – supaya aman ditempel di layar", () => {
    expect(cuplikan(Buffer.from([0x00, 0x41, 0x1f, 0x42]))).toBe(".A.B");
  });
});

describe("skema lapisan arsip vs gaya", () => {
  it("nama lapisan dibaca dari vector_layers metadata", () => {
    expect(namaLapisanMeta({ vector_layers: [{ id: "earth" }, { id: "water" }, {}] })).toEqual([
      "earth",
      "water",
    ]);
  });

  it("metadata tanpa vector_layers = daftar kosong, bukan lemparan", () => {
    expect(namaLapisanMeta(null)).toEqual([]);
    expect(namaLapisanMeta({ format: "pbf" })).toEqual([]);
  });

  it("arsip OpenMapTiles TIDAK cocok dengan gaya Protomaps – inilah peta abu-abu itu", () => {
    const omt = ["aeroway", "boundary", "housenumber", "landcover", "waterway"];
    const protomaps = ["earth", "water", "landuse", "roads", "places"];
    expect(skemaCocok(omt, protomaps)).toBe(false);
  });

  it("ekstrak wilayah yang kehilangan sebagian lapisan TETAP dianggap cocok", () => {
    // Ekstrak Indonesia wajar tidak punya semua lapisan planet. Yang menandakan
    // salah skema adalah irisan KOSONG, bukan irisan yang tidak penuh.
    expect(skemaCocok(["earth", "water"], ["earth", "water", "landuse", "roads"])).toBe(true);
  });

  it("arsip tanpa daftar lapisan tidak dihakimi – ia tak bisa dinilai, bukan salah", () => {
    expect(skemaCocok([], ["earth", "water"])).toBe(true);
  });
});
