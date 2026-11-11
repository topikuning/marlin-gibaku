// TANDA TANGAN & STEMPEL LAPORAN HARIAN HANYA UNTUK YANG DISETUJUI / FINAL
// (DECISIONS 760, menutup TTD-01).
//
// Keputusan user 2026-11-11: *"hanya untuk disetujui dan final"*. Laporan
// mingguan/bulanan, jadwal, dan rencana tetap selalu bertanda tangan (pilihan
// user pada hari yang sama).
//
// Yang dikunci:
//  1. aturannya: hanya status `disetujui` dan `final`;
//  2. pintunya: `ttdHarian` tidak memuat gambar sama sekali untuk status lain;
//  3. pagarnya: setiap pemuatan tanda tangan dokumen "harian" di kode lewat
//     pintu itu – jalur baru yang lupa akan merah di sini, bukan di kertas.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ttdHarianBoleh } from "@/lib/lifecycle";
import { ttdHarian } from "@/lib/export/ttd-harian";

describe("aturan", () => {
  it("hanya disetujui dan final", () => {
    expect(["draft", "dikirim", "perlu_koreksi", "disetujui", "final", null, undefined].map(ttdHarianBoleh)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("pintu ttdHarian", () => {
  it("status belum disetujui: gambar TIDAK dimuat, hasilnya kosong", async () => {
    const muat = vi.fn(async () => "ADA");
    expect(await ttdHarian("dikirim", muat, "KOSONG")).toBe("KOSONG");
    expect(muat).not.toHaveBeenCalled();
  });
  it("disetujui / final: gambar dimuat", async () => {
    const muat = vi.fn(async () => "ADA");
    expect(await ttdHarian("disetujui", muat, "KOSONG")).toBe("ADA");
    expect(await ttdHarian("final", muat, "KOSONG")).toBe("ADA");
    expect(muat).toHaveBeenCalledTimes(2);
  });
});

describe("pagar: setiap tanda tangan harian lewat pintu yang sama", () => {
  const berkas: string[] = [];
  const telusur = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) {
        if (n !== "generated") telusur(p);
      } else if (/\.(ts|tsx)$/.test(n)) berkas.push(p);
    }
  };
  telusur(join(process.cwd(), "src"));
  // Komentar tidak dihitung – yang dijaga adalah pemanggilan sungguhan.
  const kode = (p: string) =>
    readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("tidak ada pemuatan tanda tangan \"harian\" tanpa ttdHarian / ttdHarianBoleh", () => {
    const pelanggar: string[] = [];
    for (const p of berkas) {
      const s = kode(p);
      if (!/muatTtd(?:Pdf|Laporan)\([^)]*"harian"/.test(s)) continue;
      if (!/\bttdHarian(?:Boleh)?\(/.test(s)) pelanggar.push(p.replace(process.cwd() + "/", ""));
    }
    expect(pelanggar).toEqual([]);
  });

  it("setiap penyaji laporan harian yang menerima tanda tangan ada di daftar pagar", () => {
    // Bila daftar ini berubah, periksa penyaji barunya ikut memakai ttdHarian.
    const ada = berkas
      .filter((p) => /muatTtd(?:Pdf|Laporan)\([^)]*"harian"/.test(kode(p)))
      .map((p) => p.replace(process.cwd() + "/", ""))
      .sort();
    expect(ada).toEqual([
      "src/app/cetak/harian/[slug]/[date]/page.tsx",
      "src/lib/pdf/harian-kkp.ts",
      "src/lib/pdf/mingguan-kkp.ts",
      "src/lib/waha/actions.ts",
    ]);
  });
});
