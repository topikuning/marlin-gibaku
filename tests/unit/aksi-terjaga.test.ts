import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SETIAP AKSI DARI LAYAR HARUS TERJAGA DARI KEGAGALAN TRANSPORT.
 *
 * Keluhan user 2026-09-04, di laporan harian, untuk kesekian kalinya: halaman
 * berhenti dengan *"An unexpected response was received from the server"* dan
 * isian yang belum sempat disimpan hilang.
 *
 * Penjaganya sudah ada sejak DECISIONS 290/295 — masalahnya ia dipasang
 * satu-satu di tempat yang kebetulan diingat. Di HALAMAN YANG SAMA,
 * `report-editor` memakainya sementara `enrichment-form` (cuaca, tenaga kerja,
 * material, alat – termasuk unggahan foto, muatan terbesar di halaman itu)
 * tidak. Kegagalan yang sama persis karena itu berakhir dua cara berbeda
 * tergantung tombol mana yang ditekan, dan yang tidak terjaga justru yang
 * paling berat muatannya.
 *
 * Uji ini menutup jalan lupa: `useActionState` telanjang tidak boleh muncul di
 * mana pun kecuali di dalam pembungkusnya sendiri. Ini memang pemeriksaan
 * SUMBER, dan di sini itu memang lapisan yang benar — yang dijaga adalah
 * "tidak ada pintu yang tidak lewat penjaga", bukan tampilan sesuatu di layar.
 */

const AKAR = "src";
const DIIZINKAN = new Set(["src/lib/aksi-klien.ts"]);

function berkasSumber(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const jalur = join(dir, nama);
    if (statSync(jalur).isDirectory()) {
      if (nama === "generated") continue;
      berkasSumber(jalur, keluar);
    } else if (/\.(ts|tsx)$/.test(nama)) {
      keluar.push(jalur);
    }
  }
  return keluar;
}

describe("aksi dari layar selalu lewat penjaga transport", () => {
  it("tidak ada useActionState telanjang di luar pembungkusnya", () => {
    const pelanggar: string[] = [];
    for (const berkas of berkasSumber(AKAR)) {
      if (DIIZINKAN.has(berkas.split("\\").join("/"))) continue;
      const isi = readFileSync(berkas, "utf8");
      // Sebutan di dalam komentar tidak dihitung: yang dilarang PEMANGGILANNYA.
      if (/\buseActionState\s*[<(]/.test(isi)) pelanggar.push(berkas);
    }
    expect(pelanggar).toEqual([]);
  });

  it("pembungkusnya sendiri memang memakai useActionState", () => {
    const isi = readFileSync("src/lib/aksi-klien.ts", "utf8");
    expect(isi).toMatch(/useActionState</);
    expect(isi).toMatch(/export function useAksi</);
  });
});
