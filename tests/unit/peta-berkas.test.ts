// PETA DASAR DI VOLUME — bukan di penyimpanan objek.
//
// Teguran user 2026-09-06: *"R2 antara dev dan production berbeda, lalu apa
// yang kamu harapkan. kenapa tidak kamu simpan langsung saja di lokal,
// production punya volume dedicated"*.
//
// Dua hal dijaga di sini, dan keduanya diam saat rusak:
//
//   1. **Berkas separuh tidak boleh terbaca sebagai peta yang siap.** Unduhan
//      300 MB yang putus di tengah akan meninggalkan berkas berukuran 0 atau
//      berkas `.bagian`; kalau salah satunya dianggap ada, layar akan berkata
//      "Terpasang" sementara petanya rusak.
//   2. **Tidak ada lagi jalur R2 di kode peta.** Kalau ia kembali, peta akan
//      hidup di satu lingkungan dan mati di lingkungan lain — persis kegagalan
//      yang ditegur.
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "marlin-peta-"));
  process.env.PETA_DIR = dir;
  process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
  process.env.DATABASE_URL ??= "postgresql://x/y";
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.PETA_DIR;
});

describe("keberadaan peta dasar", () => {
  it("tidak ada berkas = tidak ada peta dasar", async () => {
    const { periksaBasemap } = await import("@/lib/peta/berkas");
    expect((await periksaBasemap()).ada).toBe(false);
  });

  it("berkas KOSONG dianggap TIDAK ADA – itu unduhan yang mati di tengah", async () => {
    const { jalurBasemap, periksaBasemap } = await import("@/lib/peta/berkas");
    await writeFile(jalurBasemap, "");
    const p = await periksaBasemap();
    expect(p.ada).toBe(false);
    expect(p.ukuran).toBe(0);
  });

  it("berkas berisi = ada, dengan ukuran dan waktunya", async () => {
    const { jalurBasemap, periksaBasemap } = await import("@/lib/peta/berkas");
    await writeFile(jalurBasemap, "PMTiles palsu untuk uji");
    const p = await periksaBasemap();
    expect(p.ada).toBe(true);
    expect(p.ukuran).toBeGreaterThan(0);
    expect(p.diperbarui).toBeInstanceOf(Date);
  });

  it("berkas `.bagian` (unduhan berjalan) TIDAK dianggap peta", async () => {
    const { jalurBasemap, periksaBasemap } = await import("@/lib/peta/berkas");
    await writeFile(`${jalurBasemap}.bagian`, "baru separuh");
    expect((await periksaBasemap()).ada).toBe(false);
  });

  it("direktorinya mengikuti PETA_DIR – tiap lingkungan punya volumenya sendiri", async () => {
    const { DIR_PETA } = await import("@/lib/peta/berkas");
    expect(DIR_PETA).toBe(dir);
  });
});

describe("letak direktori peta", () => {
  /*
   * Kegagalan 2026-09-06: volume produksi ter-mount di `/data`, sedangkan nilai
   * bawaan saya `/app/.data/peta`. Berkas peta akan tertulis DI LUAR volume dan
   * lenyap tiap deploy — persis kegagalan lampiran 2026-09-03, terulang karena
   * titik pasangnya ditebak alih-alih diikuti.
   */
  it("mengikuti LAMPIRAN_DIR bila ada – lampiran sudah terbukti di volume", async () => {
    delete process.env.PETA_DIR;
    process.env.LAMPIRAN_DIR = "/data/lampiran";
    vi.resetModules();
    const { DIR_PETA } = await import("@/lib/peta/berkas");
    expect(DIR_PETA).toBe("/data/peta");
    delete process.env.LAMPIRAN_DIR;
  });

  it("PETA_DIR menang atas segalanya – pengelola yang paling tahu", async () => {
    process.env.PETA_DIR = "/mnt/khusus/peta";
    process.env.LAMPIRAN_DIR = "/data/lampiran";
    vi.resetModules();
    const { DIR_PETA } = await import("@/lib/peta/berkas");
    expect(DIR_PETA).toBe("/mnt/khusus/peta");
    delete process.env.LAMPIRAN_DIR;
  });
});

/**
 * ISI berkas, bukan cuma keberadaannya.
 *
 * Keluhan user 2026-09-06: *"berhasil didownload, tapi malah jadi abu2."*
 * Berkas yang ada dan berukuran wajar masih bisa berisi halaman HTML, ubin
 * gambar, atau skema lapisan yang lain — dan ketiganya menghasilkan kanvas
 * abu-abu tanpa satu pun pesan kalau yang diperiksa hanya ukurannya.
 */
describe("isi berkas peta dasar", () => {
  function pmtilesBuatan(lapisan: string[], jenisUbin = 1): Buffer {
    const meta = gzipSync(Buffer.from(JSON.stringify({ vector_layers: lapisan.map((id) => ({ id })) })));
    const kepala = Buffer.alloc(127);
    kepala.write("PMTiles", 0, "ascii");
    kepala.writeUInt8(3, 7);
    kepala.writeBigUInt64LE(127n, 24); // metadata tepat di belakang kepala
    kepala.writeBigUInt64LE(BigInt(meta.length), 32);
    kepala.writeUInt8(2, 97); // gzip
    kepala.writeUInt8(jenisUbin, 99);
    kepala.writeUInt8(0, 100);
    kepala.writeUInt8(12, 101);
    return Buffer.concat([kepala, meta]);
  }

  it("membaca jenis ubin, jangkauan zoom, dan daftar lapisan dari berkas di volume", async () => {
    const { jalurBasemap, periksaIsiBasemap } = await import("@/lib/peta/berkas");
    await writeFile(jalurBasemap, pmtilesBuatan(["earth", "water", "roads"]));
    const isi = await periksaIsiBasemap();
    expect(isi.sah).toBe(true);
    if (!isi.sah) return;
    expect(isi.kepala.jenisUbin).toBe("vektor");
    expect(isi.kepala.zoomMax).toBe(12);
    expect(isi.lapisan).toEqual(["earth", "water", "roads"]);
  });

  it("berkas yang ADA tapi bukan PMTiles disebut apa adanya", async () => {
    const { jalurBasemap, periksaIsiBasemap } = await import("@/lib/peta/berkas");
    await writeFile(jalurBasemap, "<!DOCTYPE html><title>Sign in</title>");
    const isi = await periksaIsiBasemap();
    expect(isi.sah).toBe(false);
    if (isi.sah) return;
    expect(isi.sebab).toContain("bukan berkas PMTiles");
  });
});

describe("unduhan menolak yang tidak bisa digambar", () => {
  /*
   * Ini gerbang yang dulu tidak ada. Versi pertama menyatakan "Terpasang"
   * begitu servernya menjawab 200 dan berkasnya tidak nol byte — dan itulah
   * yang membuat user melihat peta abu-abu setelah unduhan yang katanya
   * berhasil. Berkas yang tidak lolos DIBUANG, bukan disimpan diam-diam.
   */
  function jawab(isi: Buffer) {
    return vi.fn(async () =>
      new Response(new Uint8Array(isi), { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
  }

  it("halaman HTML yang menyamar sebagai .pmtiles ditolak dan tidak tertinggal di volume", async () => {
    const { jalurBasemap, periksaBasemap, unduhBasemap } = await import("@/lib/peta/berkas");
    vi.stubGlobal("fetch", jawab(Buffer.from("<!DOCTYPE html><h1>404</h1>")));
    await expect(unduhBasemap("https://contoh/berkas.pmtiles")).rejects.toThrow(/bukan berkas PMTiles/);
    expect((await periksaBasemap()).ada).toBe(false);
    await expect(stat(jalurBasemap)).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it("arsip PMTiles berisi ubin GAMBAR ditolak – gaya peta dasar menggambar vektor", async () => {
    const { periksaBasemap, unduhBasemap } = await import("@/lib/peta/berkas");
    const kepala = Buffer.alloc(127);
    kepala.write("PMTiles", 0, "ascii");
    kepala.writeUInt8(3, 7);
    kepala.writeUInt8(2, 99); // png
    vi.stubGlobal("fetch", jawab(kepala));
    await expect(unduhBasemap("https://contoh/raster.pmtiles")).rejects.toThrow(/ubin png, bukan vektor/);
    expect((await periksaBasemap()).ada).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("tidak ada lagi jalur R2 di kode peta", () => {
  it("sumber peta tidak menyentuh penyimpanan objek", () => {
    const isi = readFileSync(new URL("../../src/lib/peta/sumber.ts", import.meta.url), "utf8");
    // Boleh disebut di komentar (sejarah keputusannya penting), tidak boleh
    // dipanggil.
    expect(isi).not.toContain('from "@/lib/r2"');
    expect(isi).not.toContain("r2PresignGet");
  });
});
