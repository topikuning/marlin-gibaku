import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MEMORI PRODUKSI DIHEMAT (DECISIONS 767).
 *
 * Tagihan Railway sebulan (2026-11-15): MARLIN memakai rata-rata ±1,8 GB RAM,
 * $18 dari $25. Diukur di beban foto ala MARLIN (240 foto HP 12 MP, 4 paralel):
 * memori sesudah diam 704 MB → 373 MB dengan `MALLOC_ARENA_MAX=2` + cache sharp
 * dimatikan, kecepatan sama (64 → 67 detik). Tanpanya memori itu tidak pernah
 * dikembalikan – glibc menimbun arena per thread libvips.
 *
 * Dua-duanya ada di kode, bukan variabel Railway, supaya ikut setiap deploy dan
 * tidak hilang diam-diam waktu service dibuat ulang.
 */
describe("pengaturan hemat memori produksi", () => {
  it("image produksi memasang MALLOC_ARENA_MAX=2 di tahap runner", () => {
    const docker = readFileSync("Dockerfile", "utf8");
    const runner = docker.slice(docker.indexOf("AS runner"));
    expect(runner).toMatch(/^ENV MALLOC_ARENA_MAX=2$/m);
  });

  it("cache sharp dimatikan sekali saat server mulai", () => {
    const src = readFileSync("src/instrumentation-node.ts", "utf8");
    expect(src).toMatch(/sharp[\w.]*\.cache\(false\)/);
  });
});
