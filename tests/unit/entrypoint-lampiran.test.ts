// KONTAINER MENYIAPKAN VOLUMENYA SENDIRI, LALU MELEPAS HAK ROOT.
//
// Sebab keluhan user 2026-09-03 (*"kenapa file masih hilang saat deploy ulang?
// padahal di production sudah ada volume khusus?!"*): volume Railway dipasang
// SAAT RUNTIME sebagai milik root, sedangkan prosesnya berjalan sebagai
// `marlin`. `mkdir /data/lampiran` gagal EACCES, aplikasi pindah ke `/tmp`, dan
// `/tmp` dibersihkan tiap deploy. Volumenya benar; yang salah cuma pemiliknya.
//
// Perbaikannya tidak bisa berada di Dockerfile saja (chown saat build tertimpa
// pemasangan volume) maupun di aplikasi saja (`marlin` tidak berhak mengubah
// pemilik direktori root). Ia harus di entrypoint, dijalankan root, sebelum
// turun ke `marlin`.
//
// Dua hal yang dijaga berkas ini, dan keduanya diam kalau rusak:
//   1. entrypoint-nya benar-benar dipasang & menyiapkan direktorinya;
//   2. hak root DILEPAS — kalau `exec gosu marlin` hilang, aplikasi jalan
//      sebagai root selamanya tanpa satu pun gejala yang terlihat.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");
const entrypoint = readFileSync("scripts/docker-entrypoint.sh", "utf8");

describe("Dockerfile memasang entrypoint penyiap simpanan", () => {
  it("ENTRYPOINT memanggil docker-entrypoint.sh lewat tini", () => {
    const baris = dockerfile.split("\n").find((b) => b.startsWith("ENTRYPOINT"));
    expect(baris).toBeDefined();
    expect(baris).toContain("tini");
    expect(baris).toContain("docker-entrypoint.sh");
  });

  it("skripnya disalin ke image dan bisa dieksekusi", () => {
    expect(dockerfile).toMatch(/COPY[^\n]*--chmod=755[^\n]*docker-entrypoint\.sh/);
  });

  it("gosu dipasang saat BUILD, supaya ketiadaannya bukan kejutan saat boot", () => {
    // Kalau `gosu` tidak ada di image, entrypoint gagal MELEPAS hak root pada
    // setiap boot produksi. Memasangnya lewat apt memindahkan kegagalan itu ke
    // build, tempat ia terlihat.
    expect(dockerfile).toMatch(/apt-get install[^\n]*\bgosu\b/);
  });

  it("tidak lagi mengunci USER marlin di Dockerfile", () => {
    // Penurunan haknya dipindah ke entrypoint. `USER marlin` di sini akan
    // membuat `chown` volume mustahil lagi — persis bug yang sedang ditutup.
    expect(dockerfile.split("\n").some((b) => b.trim() === "USER marlin")).toBe(false);
  });
});

describe("entrypoint menyiapkan direktori lalu turun ke pengguna aplikasi", () => {
  it("membaca LAMPIRAN_DIR dengan bawaan di dalam kontainer", () => {
    expect(entrypoint).toContain('LAMPIRAN_DIR:-/app/.data/lampiran');
  });

  it("membuat direktorinya dan menyerahkan pemiliknya ke marlin", () => {
    expect(entrypoint).toMatch(/mkdir -p "\$DIR_LAMPIRAN"/);
    expect(entrypoint).toMatch(/chown marlin:marlin "\$DIR_LAMPIRAN"/);
  });

  it("chown-nya TIDAK rekursif", () => {
    // Volume berisi ribuan berkas akan membuat setiap boot lambat, dan isinya
    // memang sudah ditulis `marlin` sendiri.
    expect(entrypoint).not.toMatch(/chown\s+-R/);
  });

  it("melepas hak root lewat exec gosu marlin", () => {
    // `exec` bukan hiasan: tanpa itu SIGTERM dari Railway berhenti di skrip ini
    // dan proses Node tidak pernah diberi tahu untuk berhenti rapi.
    expect(entrypoint).toMatch(/exec gosu marlin "\$@"/);
  });

  it("gagal menyiapkan direktori TIDAK menghentikan boot", () => {
    // Aplikasi punya cadangan dan sekarang mengumumkannya di layar. Menolak
    // boot hanya karena lampiran WA tidak bisa disimpan berarti mematikan
    // seluruh sistem pengendalian proyek demi satu fitur pinggiran.
    expect(entrypoint).toMatch(/2>\/dev\/null/);
    expect(entrypoint).toContain("Lampiran Masuk");
  });

  it("tetap jalan saat prosesnya sudah non-root", () => {
    // Platform lain (atau `docker run --user`) bisa memulai kontainer sebagai
    // pengguna sendiri. Di situ tidak ada yang bisa disiapkan — tapi juga tidak
    // ada alasan menolak jalan.
    expect(entrypoint).toMatch(/if \[ "\$\(id -u\)" = "0" \]/);
    expect(entrypoint.trimEnd().endsWith('exec "$@"')).toBe(true);
  });
});
