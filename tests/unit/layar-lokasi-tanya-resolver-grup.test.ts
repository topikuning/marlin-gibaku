/*
 * LAYAR LOKASI TIDAK BOLEH MENJAWAB SENDIRI "LOKASI INI PUNYA GRUP WA?".
 *
 * **Laporan user 2026-09-24**, di tab Laporan sebuah lokasi:
 *
 *   *"laporan yang final disajikan, atas lokasi itu group wa kabupatennya
 *   sudah ditentukan, tapi kirim laporan by wa tidak aktif tombolnya, memang
 *   group paket tidak di isi, tapi group wa kabupaten sudah"*
 *
 * Persis kegagalan yang diramalkan DECISIONS 596 saat `grupUntukLokasi`
 * dibuat: *"selama hanya ada satu jawaban, menyalinnya tidak terasa salah.
 * Begitu grup kabupaten ada, tiap salinan jadi satu tempat yang bisa
 * ketinggalan."* Aksi kirimnya SUDAH memakai resolver dan akan berhasil — yang
 * tertinggal justru pagar tombolnya, yang masih membaca `package.waGroupId`.
 * Jadi lokasi yang sudah dipasang ke grup kabupaten melihat tombol MATI untuk
 * sesuatu yang sebenarnya bisa dikirim.
 *
 * Pagar ini menjaga aturannya, bukan satu berkasnya: layar di bawah
 * `app/(app)/lokasi/` menanyakan tujuan lewat `grupUntukLokasi`, dan tidak
 * pernah menyentuh `waGroupId` sendiri. Halaman PAKET tetap boleh — di situlah
 * kolom itu memang disunting.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const AKAR = new URL("../../src/app/(app)/lokasi/", import.meta.url).pathname;

function berkasTsx(dir: string): string[] {
  const out: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) out.push(...berkasTsx(p));
    else if (/\.tsx?$/.test(nama)) out.push(p);
  }
  return out;
}

describe("layar lokasi bertanya ke resolver grup, bukan ke kolom paket", () => {
  it("tidak ada berkas di app/(app)/lokasi yang menyentuh waGroupId", () => {
    const tersangka = berkasTsx(AKAR).filter((p) => /waGroupId/.test(readFileSync(p, "utf8")));
    expect(
      tersangka.map((p) => p.slice(AKAR.length)),
      "layar lokasi membaca waGroupId sendiri – pakai grupUntukLokasi(), " +
        "kalau tidak lokasi ber-grup KABUPATEN akan melihat tombol WA mati",
    ).toEqual([]);
  });

  it("dan pagarnya memang menjaga sesuatu – berkasnya ada dan terbaca", () => {
    // Tanpa ini, direktori yang salah eja membuat uji di atas hijau selamanya
    // karena tidak memeriksa apa pun.
    expect(berkasTsx(AKAR).length).toBeGreaterThan(20);
  });
});
