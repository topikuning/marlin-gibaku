/*
 * MEMBUKA BERKAS YANG SUDAH PINDAH KE ARSIP LENOVO (DECISIONS 645).
 *
 * Laporan user 2026-10-08: dokumen di produksi
 * (https://marlin.gibaku.com/api/documents/…) dialihkan ke
 * `https://0.0.0.0:8080/api/berkas/…` – "berkas tidak bisa dibuka".
 *
 * Alamat berkas pindahan RELATIF (`/api/berkas/<token>`). Route handler
 * menyusunnya dengan `new URL(url, req.url)`, dan di belakang proxy Railway
 * `req.url` adalah alamat DALAM server (0.0.0.0:8080), bukan domain yang
 * diminta peramban. Berkas yang masih di R2 lolos karena alamatnya mutlak.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alihkanKeBerkas } from "@/lib/penyimpanan/alihkan";

describe("alihkanKeBerkas", () => {
  it("alamat relatif dikirim apa adanya – peramban menyusunnya terhadap domain yang ia buka", () => {
    const r = alihkanKeBerkas("/api/berkas/abc.123?nama=Siteplan.pdf");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/api/berkas/abc.123?nama=Siteplan.pdf");
  });

  it("alamat R2 (mutlak) tetap seperti sebelumnya", () => {
    const url = "https://akun.r2.cloudflarestorage.com/marlin/documents/x.pdf?X-Amz-Signature=abc";
    expect(alihkanKeBerkas(url).headers.get("location")).toBe(url);
  });
});

const API = join(__dirname, "../../src/app/api");

function semuaRoute(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return semuaRoute(p);
    return n === "route.ts" ? [p] : [];
  });
}

describe("tidak ada pengalihan yang disusun dari URL permintaan", () => {
  it("route API tidak memakai `new URL(…, req.url)` untuk redirect", () => {
    const pelanggar = semuaRoute(API)
      .filter((p) => /redirect\(\s*new URL\([^;]*\breq(uest)?\.url\b/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(API.length + 1).replaceAll("\\", "/"));
    expect(pelanggar).toEqual([]);
  });
});
