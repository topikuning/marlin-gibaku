// CI MENJALANKAN YANG PERLU SAJA — DAN "PERLU" ITU DIUJI, BUKAN DIPELOTOTI.
//
// Teguran user 2026-09-03, dua kali: *"kenapa harus cek panjang x lebar kalau
// cuma soal penomoran?!"* lalu *"kamu seharusnya bisa membedakan mana yang
// perlu tes apa, jangan konyol seperti ini, malah memperlama proses dan
// buang-buang waktu sesuatu yang sangat mahal selain token."*
//
// Keputusan "boleh dilewati" adalah keputusan tentang JARING PENGAMAN: salah
// sedikit, sebuah bug lolos dengan CI hijau. Karena itu logikanya keluar dari
// YAML ke `scripts/ci-perlu.mjs`, dan berkas inilah yang menagihnya.
//
// Dua arah kegagalan, keduanya senyap:
//   - terlalu longgar → perubahan KODE lolos tanpa E2E, CI tetap hijau;
//   - terlalu ketat  → kembali membuang 20 menit untuk satu baris markdown.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { golongan, pekerjaanDibutuhkan } from "../../scripts/ci-perlu.mjs";

const SEMUA = { e2e: true, integrasi: true, docker: true };
const TIDAK_ADA = { e2e: false, integrasi: false, docker: false };

describe("penggolongan berkas", () => {
  it("markdown di mana pun adalah dokumen", () => {
    expect(golongan("docs/DECISIONS.md")).toBe("dokumen");
    expect(golongan("README.md")).toBe("dokumen");
    expect(golongan(".claude/skills/steward/SKILL.md")).toBe("dokumen");
  });

  it("tiap suite uji dikenali terpisah", () => {
    expect(golongan("tests/e2e/lokasi.spec.ts")).toBe("uji-e2e");
    expect(golongan("tests/integration/rab.test.ts")).toBe("uji-integrasi");
    expect(golongan("tests/unit/photo-limits.test.ts")).toBe("uji-unit");
  });

  it("SISANYA aplikasi – termasuk yang mudah dikira aman", () => {
    // Daftar ini bukan hiasan: tiap satu di antaranya pernah terlihat seperti
    // "cuma konfigurasi" pada suatu waktu.
    for (const b of [
      "src/lib/photos.ts",
      "prisma/schema.prisma",
      "package.json",
      "pnpm-lock.yaml",
      "Dockerfile",
      ".github/workflows/ci.yml",
      "scripts/ci-perlu.mjs",
      "next.config.ts",
      "public/manifest.json",
      "seed-data/ahsp/x.ndjson",
      "tests/stubs/server-only.ts", // penolong lintas-suite: tak bisa dipastikan miliknya siapa
    ]) {
      expect(golongan(b), b).toBe("aplikasi");
    }
  });
});

describe("pekerjaan yang dibutuhkan", () => {
  it("penomoran DECISIONS: tidak satu pun job berat", () => {
    // Inilah PR #261 yang dikeluhkan. Penjaganya tetap jalan — `decisions-nomor`
    // ada di job `checks`, yang tidak pernah digerbang.
    expect(pekerjaanDibutuhkan(["docs/DECISIONS.md"])).toEqual(TIDAK_ADA);
  });

  it("beberapa markdown sekaligus tetap nol", () => {
    expect(pekerjaanDibutuhkan(["README.md", "docs/a.md", "PROJECT.md"])).toEqual(TIDAK_ADA);
  });

  it("SATU berkas kode di antara dokumen → semua job jalan", () => {
    // Yang dijaga: penghematan tidak boleh menular ke PR campuran.
    expect(pekerjaanDibutuhkan(["docs/a.md", "src/lib/photos.ts"])).toEqual(SEMUA);
  });

  it("hanya uji E2E yang berubah → E2E saja", () => {
    // Integrasi tidak menyentuhnya, dan `tests` ada di .dockerignore sehingga
    // image-nya tidak berubah satu bit pun.
    expect(pekerjaanDibutuhkan(["tests/e2e/paket.spec.ts"])).toEqual({
      e2e: true,
      integrasi: false,
      docker: false,
    });
  });

  it("hanya uji integrasi yang berubah → integrasi saja", () => {
    expect(pekerjaanDibutuhkan(["tests/integration/rab.test.ts"])).toEqual({
      e2e: false,
      integrasi: true,
      docker: false,
    });
  });

  it("hanya uji unit → tidak satu pun; ia sudah dijalankan job `checks`", () => {
    expect(pekerjaanDibutuhkan(["tests/unit/photo-limits.test.ts"])).toEqual(TIDAK_ADA);
  });

  it("campuran uji e2e + integrasi → dua-duanya, tetap tanpa Docker", () => {
    expect(
      pekerjaanDibutuhkan(["tests/e2e/a.spec.ts", "tests/integration/b.test.ts", "docs/c.md"]),
    ).toEqual({ e2e: true, integrasi: true, docker: false });
  });

  it("DOCKER hanya dilewati bila tak ada berkas aplikasi sama sekali", () => {
    // Satu-satunya yang boleh melewatinya: dokumen & uji. Dockerfile sendiri
    // jelas aplikasi.
    expect(pekerjaanDibutuhkan(["Dockerfile"]).docker).toBe(true);
    expect(pekerjaanDibutuhkan(["src/app/page.tsx"]).docker).toBe(true);
    expect(pekerjaanDibutuhkan(["tests/e2e/a.spec.ts"]).docker).toBe(false);
  });

  it("ragu = JALANKAN: daftar kosong, spasi, baris kosong", () => {
    // Diff kosong biasanya berarti perbandingannya yang salah, bukan
    // perubahannya yang nihil. Salah menjalankan cuma membuang waktu; salah
    // melewati membuang jaring pengaman.
    expect(pekerjaanDibutuhkan([])).toEqual(SEMUA);
    expect(pekerjaanDibutuhkan(["", "  ", "\t"])).toEqual(SEMUA);
  });
});

describe("alur kerja memakai skrip ini, dan `checks` tidak pernah digerbang", () => {
  const alur = readFileSync(".github/workflows/ci.yml", "utf8");

  it("keputusan diambil skrip, bukan ditulis ulang di YAML", () => {
    expect(alur).toContain("node scripts/ci-perlu.mjs");
  });

  it("tiap job berat memakai keluarannya masing-masing", () => {
    expect(alur).toContain("if: needs.perubahan.outputs.e2e == 'true'");
    expect(alur).toContain("if: needs.perubahan.outputs.integrasi == 'true'");
    expect(alur).toContain("if: needs.perubahan.outputs.docker == 'true'");
  });

  it("`checks` SELALU jalan – di sanalah penjaga dokumen tinggal", () => {
    const mulai = alur.indexOf("\n  checks:\n");
    const berikut = alur.slice(mulai + 1).search(/\n {2}[a-z][a-z-]*:\n/);
    const j = alur.slice(mulai, mulai + 1 + berikut);
    expect(j).not.toContain("needs: perubahan");
    expect(j).not.toContain("if:");
  });

  it("push ke main tetap menjalankan semuanya", () => {
    expect(alur).toContain('!= "pull_request"');
  });

  /*
   * 2026-11-01: job E2E tertahan 30+ menit di "Install Playwright Chromium"
   * (biasanya 20 detik) – sebelum satu uji pun jalan. Tanpa batas waktu, job
   * GitHub baru dihentikan sesudah 360 menit, dan PR menunggu selama itu.
   */
  it("job E2E berbatas waktu; pemasangan Chromium yang macet diulang, tidak ditunggu", () => {
    const mulai = alur.indexOf("\n  e2e:\n");
    expect(mulai).toBeGreaterThan(-1);
    const job = alur.slice(mulai);
    expect(job).toMatch(/\n {4}timeout-minutes: \d+\n/);
    const pasang = job.slice(job.indexOf("- name: Install Playwright Chromium"), job.indexOf("- name: Build"));
    expect(pasang).toMatch(/timeout-minutes: \d+/);
    expect(pasang).toMatch(/timeout \d+ pnpm exec playwright install/);
    expect(job.slice(0, job.indexOf("- name: Install Playwright Chromium"))).toContain("~/.cache/ms-playwright");
  });
});

/*
 * CI PARALEL (DECISIONS 729, pilihan user 2026-11-01 "lanjut A + B").
 *
 * E2E adalah jalur kritis di 16 run berturut-turut (16–20 menit), dan ±60%-nya
 * satu berkas: sapuan overflow ponsel di dua lebar (8,7–9,8 menit). Integrasi
 * ±12 menit. Keduanya kini dipecah menjadi job paralel yang masing-masing
 * punya Postgres sendiri.
 *
 * Kegagalan yang dijaga di sini senyap: lebar sapuan baru yang tidak punya
 * job sendiri TIDAK JALAN DI MANA PUN (bagian "lainnya" membuang semua
 * @sapuan), dan shard yang angkanya tidak cocok dengan matriks melewatkan
 * sebagian berkas integrasi – CI hijau dengan uji yang tidak pernah jalan.
 */
describe("CI paralel: tidak ada uji yang jatuh di antara bagian", () => {
  const alur = readFileSync(".github/workflows/ci.yml", "utf8");
  const spec = readFileSync("tests/e2e/mobile-overflow.spec.ts", "utf8");
  const ruteMobile = readFileSync("tests/e2e/rute-mobile.ts", "utf8");
  const lebar = (ruteMobile.match(/export const LEBAR_SAPUAN = \[([^\]]+)\]/)?.[1] ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);

  it("tiap lebar sapuan punya bagian E2E sendiri; bagian lainnya membuang semua sapuan", () => {
    expect(lebar.length).toBeGreaterThan(0);
    for (const w of lebar) expect(alur).toContain(`--project=mobile --grep @sapuan-${w}`);
    expect(alur).toContain("--grep-invert @sapuan");
    expect(alur).toContain("pnpm test:e2e ${{ matrix.bagian.args }}");
  });

  it("uji sapuan bertanda @sapuan dan @sapuan-<lebar> – tanda itulah yang dipilih matriks", () => {
    expect(spec).toContain('tag: ["@sapuan", `@sapuan-${LEBAR}`]');
  });

  it("shard integrasi sama dengan isi matriksnya", () => {
    const isi = alur.match(/\n {8}shard: \[([^\]]+)\]/)?.[1].split(",").map((s) => s.trim()) ?? [];
    expect(isi.length).toBeGreaterThan(1);
    expect(isi).toEqual(isi.map((_, i) => String(i + 1)));
    expect(alur).toContain(`pnpm vitest run tests/integration --shard=\${{ matrix.shard }}/${isi.length}`);
  });

  it("nama cek lama tetap ada sebagai penagih hasil semua bagian", () => {
    for (const [kunci, nama, perlu] of [
      ["e2e-hasil", "E2E (Playwright)", "e2e"],
      ["integration-hasil", "Integration tests (Postgres)", "integration"],
    ]) {
      const mulai = alur.indexOf(`\n  ${kunci}:\n`);
      expect(mulai, kunci).toBeGreaterThan(-1);
      const job = alur.slice(mulai, mulai + 900);
      expect(job).toContain(`name: ${nama}`);
      expect(job).toContain(`needs.${perlu}.result`);
      expect(job).toContain("always()");
    }
  });

  it("artefak kegagalan tiap bagian tidak saling menimpa", () => {
    expect(alur).toContain("name: playwright-hasil-${{ strategy.job-index }}");
  });
});
