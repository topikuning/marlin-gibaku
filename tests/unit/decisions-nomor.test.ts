// NOMOR DI DECISIONS.md: unik, menaik, dan tidak ada yang belum diberi nomor.
//
// Kejadian 2026-08-29: dua agen bekerja bersamaan, keduanya menambah entri
// baru, dan keduanya memakai 473 + 474. Git tidak mengeluh (append di tempat
// yang sama = konflik teks biasa), dan yang tersisa adalah dua keputusan
// berbeda dengan nomor sama — sementara 21 komentar kode menunjuk "DECISIONS
// 473" tanpa cara tahu yang mana.
//
// Aturannya sekarang: penulis TIDAK memilih nomor (tulis `## (baru) · …`),
// nomor diberikan pemeriksa terakhir saat merge. Berkas uji ini yang menjaga
// keduanya: tidak ada nomor kembar, dan tidak ada `(baru)` yang lolos merge.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BERKAS = join(process.cwd(), "docs", "DECISIONS.md");
/**
 * Blok berpagar dibuang lebih dulu: kepala berkas memuat CONTOH judul
 * (`## (baru) · …`, `## DDD · …`) di dalam ```-fence. Tanpa ini penjaga
 * menghitung contohnya sebagai entri sungguhan dan merah selamanya.
 */
const isi = readFileSync(BERKAS, "utf8").replace(/^```[\s\S]*?^```/gm, "");

/**
 * Judul entri. Bentuknya berubah tiga kali sepanjang umur berkas ini, dan
 * ketiganya harus terbaca: titik-tengah dengan tanggal di depan, tanda pisah
 * panjang dengan tanggal di belakang, dan bentuk sekarang. Ada pula id
 * ber-akhiran huruf (`121b`) untuk
 * keputusan susulan yang menempel pada nomor yang sama.
 *
 * Pemisahnya ditulis lewat kode karakter, bukan huruf aslinya: berkas ini akan
 * memuat em-dash, dan penjaga `tanda-pisah-ui.test.ts` memindai seluruh repo.
 */
const PEMISAH = `[${String.fromCharCode(0x00b7, 0x2014)}-]`; // titik-tengah, tanda pisah panjang, hubung
const JUDUL = new RegExp(`^## (\\d{3,})([a-z]?) ${PEMISAH} `, "gm");
/** Penanda entri yang nomornya belum diberikan. */
const BELUM_BERNOMOR = /^## \(baru\)/gm;

function idEntri(): { nomor: number; id: string }[] {
  return [...isi.matchAll(JUDUL)].map((m) => ({
    nomor: Number.parseInt(m[1], 10),
    id: `${m[1]}${m[2]}`,
  }));
}

describe("penomoran DECISIONS.md", () => {
  it("ada entrinya, dan pola judulnya terbaca", () => {
    // Penjaga atas penjaga: kalau pola judul tidak lagi cocok, uji di bawah
    // akan hijau untuk alasan yang salah – tidak ada yang diperiksa.
    expect(idEntri().length).toBeGreaterThan(400);
  });

  it("tidak ada nomor kembar", () => {
    const id = idEntri().map((e) => e.id);
    const kembar = id.filter((n, i) => id.indexOf(n) !== i);
    expect(
      [...new Set(kembar)],
      "dua keputusan berbeda tidak boleh berbagi nomor – rujukan di kode jadi ambigu",
    ).toEqual([]);
  });

  it("nomornya menaik dari atas ke bawah", () => {
    const nomor = idEntri().map((e) => e.nomor);
    const mundur = nomor
      .map((n, i) => (i > 0 && n < nomor[i - 1] ? `${nomor[i - 1]} → ${n}` : null))
      .filter(Boolean);
    expect(mundur, "urutan entri harus mengikuti nomornya").toEqual([]);
  });

  /**
   * Cabang yang sedang diperiksa.
   *
   * Di GitHub Actions, `GITHUB_REF_NAME` berisi `dev` pada peristiwa push ke
   * dev, tapi `223/merge` pada pemeriksaan pull request — jadi ia sekaligus
   * membedakan "sudah masuk" dari "masih diusulkan". Di luar CI dipakai git.
   * Kalau keduanya gagal, dikembalikan string kosong: penjaganya memilih
   * MELEWATI, bukan menuduh.
   */
  function cabang(): string {
    const dariCi = process.env.GITHUB_REF_NAME;
    if (dariCi) return dariCi;
    try {
      return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  }

  /*
   * Penjaga ini HANYA menggigit di `dev`/`main`, dan itu memang seluruh
   * maksudnya: "tidak boleh ada `(baru)` yang LOLOS MERGE".
   *
   * Versi pertama menolaknya di mana saja. Akibatnya aturan yang baru ditulis
   * saling meniadakan dengan gerbangnya sendiri: penulis disuruh menulis
   * `## (baru)`, lalu setiap PR yang menambah keputusan otomatis merah — dan
   * merah yang wajar mengajari orang mengabaikan merah. Terbukti langsung
   * pada dua cabang pertama sesudah aturannya berlaku; yang satu menyiasati
   * dengan memilih nomor sendiri, persis yang hendak dicegah.
   */
  /**
   * PR yang menuju `main` = PR RILIS, dan di situ penjaganya harus menggigit.
   *
   * `GITHUB_REF_NAME` pada peristiwa pull request berbunyi `226/merge`, jadi
   * pemeriksaan di atas melewatinya — termasuk untuk PR `dev -> main`. Padahal
   * CI repo ini tidak berjalan pada push ke `dev` (lihat `ci.yml`: push hanya
   * `main`), sehingga tanpa baris ini satu-satunya yang menangkap `(baru)`
   * yang lolos adalah push SESUDAH rilis ter-merge — terlambat.
   *
   * Sengaja hanya `main`: PR penulis menuju `dev`, dan menggigit di sana akan
   * menghidupkan lagi persis cacat yang catatan di atas ceritakan.
   */
  const menujuRilis = process.env.GITHUB_BASE_REF === "main";

  it("tidak ada entri yang masih menunggu nomor saat sudah di dev/main", () => {
    const menunggu = [...isi.matchAll(BELUM_BERNOMOR)].length;
    const di = cabang();
    if (di !== "dev" && di !== "main" && !menujuRilis) {
      /*
       * Di cabang penulis, `(baru)` justru bentuk yang BENAR — yang diperiksa
       * BENTUKNYA. Judul yang tidak berpola menyulitkan pemeriksa terakhir
       * tepat di saat ia paling tidak punya waktu: sedang menggabungkan.
       */
      const pola = new RegExp(
        `^## \\(baru\\) ${String.fromCharCode(0x00b7)} .+ \\(\\d{4}-\\d{2}-\\d{2}\\)$`,
        "gm",
      );
      expect(
        [...isi.matchAll(pola)].length,
        "judul entri baru harus berbentuk `## (baru) \u00b7 Judul (YYYY-MM-DD)`",
      ).toBe(menunggu);
      return;
    }
    expect(
      menunggu,
      "entri `## (baru)` harus diberi nomor oleh pemeriksa terakhir SEBELUM merge",
    ).toBe(0);
  });
});
