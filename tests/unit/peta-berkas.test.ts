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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
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

describe("tidak ada lagi jalur R2 di kode peta", () => {
  it("sumber peta tidak menyentuh penyimpanan objek", () => {
    const isi = readFileSync(new URL("../../src/lib/peta/sumber.ts", import.meta.url), "utf8");
    // Boleh disebut di komentar (sejarah keputusannya penting), tidak boleh
    // dipanggil.
    expect(isi).not.toContain('from "@/lib/r2"');
    expect(isi).not.toContain("r2PresignGet");
  });
});
