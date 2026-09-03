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
});
