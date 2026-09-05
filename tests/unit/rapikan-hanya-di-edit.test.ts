import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PERAPIAN BAHASA HANYA ADA DI FORM EDIT.
 *
 * Ketetapan user 2026-09-05: *"yang dulu aku maksud untuk fitur ini ada bukan
 * saat difinalkan, itu bukan di sini, tapi di menu edit atau ketika inputan
 * sudah jadi laporan kegiatan, bukan sebelum disimpan seperti ini!"*
 *
 * Jadi ada TIGA tempat yang pernah memuatnya dan dua di antaranya salah:
 *   - form BUAT (sebelum kegiatan tersimpan) — salah, dibuang;
 *   - panel FINALISASI (DECISIONS 179) — salah, dibuang;
 *   - form EDIT kegiatan tersimpan — benar, satu-satunya yang tinggal.
 *
 * Uji ini membaca berkasnya karena yang dijaga memang LETAK, bukan perilaku
 * fungsi: satu baris `<RapikanTeksPanel />` yang ditempel balik ke form buat
 * tidak akan menggagalkan uji perilaku mana pun.
 */

/** Buang komentar: yang dijaga isi layarnya, bukan keterangan kenapa dibuang. */
function tanpaKomentar(sumber: string): string {
  return sumber.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const DIR = "src/app/(app)/lokasi/[slug]/kegiatan";
const forms = readFileSync(`${DIR}/kegiatan-forms.tsx`, "utf8");
const finalisasi = tanpaKomentar(readFileSync(`${DIR}/finalize-panel.tsx`, "utf8"));
const aksi = readFileSync("src/lib/field-activity/actions.ts", "utf8");

/** Potong badan satu fungsi tingkat atas: dari deklarasinya sampai `\n}` pertama. */
function badanFungsi(sumber: string, nama: string): string {
  const mulai = sumber.indexOf(`function ${nama}(`);
  expect(mulai, `fungsi ${nama} tidak ditemukan`).toBeGreaterThan(-1);
  const akhir = sumber.indexOf("\n}\n", mulai);
  return sumber.slice(mulai, akhir === -1 ? undefined : akhir);
}

describe("letak tombol perapian bahasa", () => {
  it("form EDIT memuatnya – di situlah tempatnya", () => {
    expect(badanFungsi(forms, "EditActivityForm")).toContain("<RapikanTeksPanel");
  });

  it("form BUAT tidak memuatnya – belum jadi laporan kegiatan", () => {
    expect(badanFungsi(forms, "CreateActivityForm")).not.toContain("<RapikanTeksPanel");
  });

  it("panel FINALISASI tidak memuatnya – menutup kegiatan bukan pekerjaan mengetik", () => {
    expect(finalisasi).not.toContain("RapikanTeksPanel");
    expect(finalisasi).not.toContain("rewrite");
    expect(finalisasi).not.toMatch(/Rapikan bahasa|Bahasa teknis/);
  });
});

describe("jalur server yang ikut dibuang", () => {
  it("tidak ada lagi server action merapikan-lalu-memfinalkan", () => {
    // Menghapusnya dari layar saja tidak cukup: server action yang masih
    // diekspor tetap punya endpoint sendiri dan bisa dipanggil dari luar.
    // Dicocokkan pada DEKLARASI ekspornya, bukan sekadar namanya: nama itu
    // masih disebut di komentar yang menerangkan kenapa jalurnya dibuang.
    expect(aksi).not.toMatch(/export\s+async\s+function\s+finalizeActivityWithTextAction/);
    expect(aksi).not.toMatch(/export\s+async\s+function\s+suggestActivityRewriteAction/);
  });

  it("jalur dari FORM tetap ada – itu yang dipakai form edit", () => {
    expect(aksi).toContain("export async function suggestTextRewriteAction");
  });
});
