// PEMBACA HDF5 JARAK JAUH (DECISIONS baru 2026-10-07).
//
// Berkas awan Himawari NOAA ±360 MB; MARLIN hanya membaca kepala berkas, indeks
// potongan, dan potongan yang memuat lokasi. Fixture `himawari-mini.h5` dibuat
// dengan h5py (libver "earliest" = superblock 0, sama seperti berkas NOAA):
// 20 dataset pengisi (grup akar butuh beberapa node tabel simbol), CloudMask
// int8 shuffle+gzip 40×40 potongan 2×2 (400 potongan → B-tree bertingkat) dengan
// 30 atribut (object header bersambung), Latitude float32 shuffle+gzip,
// LatBE big-endian, dan TanpaFilter. `himawari-mini-gaya-baru.h5` berisi data
// yang sama tetapi dengan susunan berkas NOAA yang sesungguhnya: object header
// versi 2 dan tautan grup padat di fractal heap (h5py `track_order=True`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bukaHdf5, Hdf5Error, type BacaBita } from "@/lib/weather/hdf5-jarak";

const FIXTURE = ["himawari-mini.h5", "himawari-mini-gaya-baru.h5"] as const;

describe.each(FIXTURE)("bukaHdf5 – %s", (namaBerkas) => {
  const berkas = readFileSync(
    new URL(`../fixtures/cuaca/${namaBerkas}`, import.meta.url),
  );

  function pembaca(catat?: { n: number; bita: number }): BacaBita {
    return async (offset, panjang) => {
      if (catat) {
        catat.n++;
        catat.bita += panjang;
      }
      return new Uint8Array(
        berkas.subarray(offset, Math.min(offset + panjang, berkas.length)),
      );
    };
  }

  const cm = (b: number, k: number) =>
    b === 0 && k === 0 ? -128 : (b * 7 + k * 3) % 4;
  const lat = (b: number, k: number) => Math.fround((b * 40 + k) / 10 - 7);

  it("menemukan semua dataset di grup akar", async () => {
    const h = await bukaHdf5(pembaca());
    const nama = await h.daftar();
    expect(nama).toHaveLength(24);
    expect(nama).toEqual(
      expect.arrayContaining([
        "CloudMask",
        "Latitude",
        "LatBE",
        "TanpaFilter",
        "Isi00",
        "Isi19",
      ]),
    );
  });

  it("membaca bentuk, potongan, tipe, dan filter", async () => {
    const h = await bukaHdf5(pembaca());
    const info = await h.info("CloudMask");
    expect(info.bentuk).toEqual([40, 40]);
    expect(info.potongan).toEqual([2, 2]);
    expect(info.tipe).toMatchObject({
      kelas: "int",
      ukuran: 1,
      bertanda: true,
    });
    expect(info.filter.map((f) => f.id)).toEqual([2, 1]);
  });

  it("jendela int8 (shuffle+gzip, B-tree bertingkat) sama dengan isi aslinya", async () => {
    const h = await bukaHdf5(pembaca());
    const w = await h.jendela("CloudMask", 11, 25, 5, 5);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) expect(w[i][j]).toBe(cm(11 + i, 25 + j));
    expect((await h.jendela("CloudMask", 0, 0, 1, 1))[0][0]).toBe(-128);
    expect((await h.jendela("CloudMask", 39, 39, 1, 1))[0][0]).toBe(cm(39, 39));
  });

  it("float32 little-endian, big-endian, dan tanpa filter terbaca benar – termasuk potongan tepi", async () => {
    const h = await bukaHdf5(pembaca());
    for (const nama of ["Latitude", "LatBE", "TanpaFilter"]) {
      const w = await h.jendela(nama, 37, 36, 3, 4);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 4; j++) expect(w[i][j]).toBe(lat(37 + i, 36 + j));
    }
  });

  it("hanya membaca sebagian kecil berkas", async () => {
    const catat = { n: 0, bita: 0 };
    const h = await bukaHdf5(pembaca(catat));
    await h.jendela("CloudMask", 13, 27, 1, 1);
    expect(catat.n).toBeLessThan(10);
  });

  it("menolak yang bukan HDF5 dan dataset yang tidak ada, dengan galat yang menyebut sebabnya", async () => {
    await expect(bukaHdf5(async () => new Uint8Array(96))).rejects.toThrow(
      Hdf5Error,
    );
    const h = await bukaHdf5(pembaca());
    await expect(h.jendela("TidakAda", 0, 0, 1, 1)).rejects.toThrow(/TidakAda/);
    await expect(h.jendela("CloudMask", 38, 38, 5, 5)).rejects.toThrow(
      /luar batas/,
    );
  });
});
