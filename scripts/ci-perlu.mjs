#!/usr/bin/env node
/**
 * PEKERJAAN CI MANA YANG BENAR-BENAR DIBUTUHKAN OLEH SATU PERUBAHAN.
 *
 * Teguran user 2026-09-03, dua kali: *"kenapa harus cek panjang x lebar kalau
 * cuma soal penomoran?!"* lalu *"kamu seharusnya bisa membedakan mana yang
 * perlu tes apa, jangan konyol seperti ini, malah memperlama proses dan
 * buang-buang waktu sesuatu yang sangat mahal selain token."*
 *
 * Sebelumnya `ci.yml` dipicu `on: pull_request` tanpa filter apa pun: satu
 * baris markdown menjalankan Playwright, Postgres, dan `docker build
 * --no-cache`. ±20 menit untuk nol bukti — dan CI yang lambat pada perubahan
 * sepele mengajari orang menumpuk perubahan jadi PR besar, yang justru lebih
 * sulit diperiksa.
 *
 * ### Kenapa LOGIKANYA DI SINI, bukan di dalam YAML
 *
 * Keputusan "boleh dilewati" adalah keputusan tentang jaring pengaman: salah
 * sedikit, dan sebuah bug lolos dengan CI hijau. Ditulis sebagai skrip, ia bisa
 * diuji dengan daftar berkas sungguhan (`tests/unit/ci-perlu.test.ts`);
 * ditulis sebagai enam baris bash di dalam `run:`, ia hanya bisa dipelototi.
 *
 * ### Aturannya
 *
 * Tiap berkas digolongkan, lalu keputusannya diturunkan dari GOLONGAN yang
 * muncul — bukan dari daftar pengecualian yang panjang:
 *
 *   dokumen        `*.md` di mana pun
 *   uji-e2e        `tests/e2e/**`
 *   uji-integrasi  `tests/integration/**`
 *   uji-unit       `tests/unit/**` dan penolong uji lain
 *   aplikasi       SISANYA — src, prisma, package.json, Dockerfile, ci.yml, …
 *
 * Ada satu saja berkas **aplikasi** → semua job jalan. Titik. Yang bisa
 * dilewati hanyalah perubahan yang seluruhnya dokumen dan/atau uji:
 *
 *   - `docker` tidak pernah dibutuhkan oleh perubahan dokumen/uji: `tests`
 *     dan `*.md` ada di `.dockerignore`, jadi image-nya tidak berubah satu bit
 *     pun;
 *   - `e2e` hanya dibutuhkan bila `tests/e2e/**` yang berubah;
 *   - `integration` hanya bila `tests/integration/**` yang berubah.
 *
 * Uji unit TIDAK pernah membutuhkan ketiganya — ia dijalankan job `checks`,
 * yang SELALU jalan. Di sanalah penjaga dokumen tinggal (`decisions-nomor`,
 * `tanda-pisah-ui`, matriks izin), jadi perubahan dokumen tetap diperiksa.
 *
 * Arah keraguan condong ke MENJALANKAN: daftar kosong, berkas yang tidak
 * dikenali, atau peristiwa selain `pull_request` semuanya menghasilkan "jalan
 * semua". Salah menjalankan cuma membuang waktu; salah melewati membuang
 * jaring pengaman.
 */

/** @typedef {{ e2e: boolean, integrasi: boolean, docker: boolean }} Pekerjaan */

const SEMUA = { e2e: true, integrasi: true, docker: true };

/** Golongan satu berkas. */
export function golongan(berkas) {
  if (berkas.endsWith(".md")) return "dokumen";
  if (berkas.startsWith("tests/e2e/")) return "uji-e2e";
  if (berkas.startsWith("tests/integration/")) return "uji-integrasi";
  if (berkas.startsWith("tests/unit/")) return "uji-unit";
  // `tests/` selebihnya (stub, fixture, penolong) dipakai bersama beberapa
  // suite: tidak bisa dipastikan miliknya siapa, jadi diperlakukan aplikasi.
  return "aplikasi";
}

/**
 * @param {string[]} berkas daftar berkas yang berubah
 * @returns {Pekerjaan}
 */
export function pekerjaanDibutuhkan(berkas) {
  const bersih = berkas.map((b) => b.trim()).filter(Boolean);
  // Tidak tahu apa-apa → jalankan semua. Diff kosong biasanya berarti
  // perbandingannya yang salah, bukan perubahannya yang nihil.
  if (bersih.length === 0) return { ...SEMUA };

  const gol = new Set(bersih.map(golongan));
  if (gol.has("aplikasi")) return { ...SEMUA };

  return {
    e2e: gol.has("uji-e2e"),
    integrasi: gol.has("uji-integrasi"),
    // `tests` & `*.md` ada di .dockerignore — image-nya identik.
    docker: false,
  };
}

/* ── CLI: baca daftar berkas dari stdin, tulis ke $GITHUB_OUTPUT ─────────── */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const masuk = await new Promise((res) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => res(buf));
  });
  const berkas = masuk.split("\n");
  const p = pekerjaanDibutuhkan(berkas);
  console.log("Berkas berubah:");
  for (const b of berkas.filter(Boolean)) console.log(`  ${golongan(b).padEnd(13)} ${b}`);
  console.log(`\nDibutuhkan → e2e=${p.e2e} integrasi=${p.integrasi} docker=${p.docker}`);
  const keluaran = `e2e=${p.e2e}\nintegrasi=${p.integrasi}\ndocker=${p.docker}\n`;
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, keluaran);
  }
}
