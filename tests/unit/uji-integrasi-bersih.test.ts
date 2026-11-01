import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * UJI INTEGRASI WAJIB MEMBERSIHKAN DATANYA SUNGGUHAN.
 *
 * Gerbang PR #380 (2026-11-01) merah di `gdrive-antrean-otomatis`: pemindai
 * menemukan 2 laporan FINAL, ujinya mengharapkan 1. Laporan kedua tertinggal
 * dari `foto-susulan`, yang membersihkan dengan
 * `DELETE FROM "organizations" WHERE … .catch(() => null)`. DELETE itu SELALU
 * ditolak – `users.org_id` tidak ikut terhapus berantai – dan `.catch` menelan
 * galatnya. Selama berkas itu kebetulan jalan sesudah berkas Drive, CI hijau;
 * begitu urutannya berubah, berkas lain yang merah.
 *
 * Pola bakunya `TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE`
 * (lihat `vitest.config.ts`: berkas integrasi jalan serial, tiap berkas
 * membersihkan DB-nya sendiri).
 */
describe("pembersihan uji integrasi", () => {
  const dir = "tests/integration";
  const berkas = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));

  it('tidak ada `DELETE FROM "organizations"` – ia selalu ditolak FK users dan galatnya tertelan', () => {
    const pelanggar = berkas.filter((f) => /DELETE FROM \\?"organizations\\?"/.test(readFileSync(`${dir}/${f}`, "utf8")));
    expect(pelanggar).toEqual([]);
  });
});
