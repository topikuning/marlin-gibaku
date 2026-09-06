// WORKER MAPLIBRE DISAJIKAN SENDIRI — sebab peta abu-abu yang sebenarnya.
//
// Keluhan user 2026-09-06: *"berhasil didownload, tapi malah jadi abu2. apa
// masalahmu sebenarnya!"* — dengan berkas .pmtiles yang, setelah diperiksa,
// SEHAT: PMTiles v3, ubin vektor, z0–12, batas Indonesia, skema Protomaps.
//
// Sebabnya ada di rantai build, bukan di data. MapLibre 6 menggambar ubin di
// dalam Web Worker, dan workernya modul ES yang mengimpor tetangganya:
//
//     import { … } from "./maplibre-gl-shared.mjs";
//
// Next menyalin worker itu ke `/_next/static/media/…<hash>.mjs` APA ADANYA —
// impor relatifnya tidak ditulis ulang, sedangkan tetangganya ikut di-hash jadi
// nama lain. Worker menunjuk berkas yang tidak ada, gagal dimuat, dan `new
// Worker()` yang skripnya 404 TIDAK melempar apa pun. Yang terlihat: gaya
// termuat, kepala .pmtiles terbaca SATU kali, lalu berhenti — nol permintaan
// ubin, nol pesan galat, tersisa latar Protomaps `#cccccc`. Abu-abu.
//
// Diverifikasi dengan menjalankan aplikasi hasil `pnpm build` di peramban
// headless: sebelum perbaikan hanya ada satu `RES 206 /api/peta/basemap`
// (kepala) dan tidak satu pun permintaan ubin.
//
// Tiga hal dijaga di sini, dan ketiganya gagal DIAM-DIAM kalau hilang.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const akar = path.resolve(new URL("../..", import.meta.url).pathname);
const baca = (p: string) => readFileSync(path.join(akar, p), "utf8");

describe("worker maplibre disalin ke public/", () => {
  it("skrip salin menaruh worker DAN berkas yang diimpornya berdampingan", () => {
    // Dijalankan sungguhan: kalau susunan dist maplibre berubah, skripnya
    // melempar — dan itu harus ketahuan di sini, bukan di produksi sebagai
    // peta abu-abu.
    execFileSync("node", ["scripts/salin-worker-peta.mjs"], { cwd: akar, stdio: "pipe" });
    const dir = path.join(akar, "public", "maplibre");
    expect(existsSync(path.join(dir, "maplibre-gl-worker.mjs"))).toBe(true);
    expect(existsSync(path.join(dir, "maplibre-gl-shared.mjs"))).toBe(true);
    // Impor relatif worker harus menemukan tetangganya di direktori yang sama.
    const worker = readFileSync(path.join(dir, "maplibre-gl-worker.mjs"), "utf8");
    expect(worker).toContain('"./maplibre-gl-shared.mjs"');
  });

  it("build DAN dev menjalankan skrip itu – lupa satu = peta mati di lingkungan itu", () => {
    const pkg = JSON.parse(baca("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toContain("salin-worker-peta.mjs");
    expect(pkg.scripts.dev).toContain("salin-worker-peta.mjs");
  });

  it("Dockerfile ikut menjalankannya – ia memanggil `next build` LANGSUNG", () => {
    // Jebakan yang hampir lolos: menempelkan skrip ke `pnpm build` tidak ada
    // gunanya untuk produksi, sebab image dibangun dengan `pnpm next build`
    // yang melewati skrip npm sama sekali.
    expect(baca("Dockerfile")).toContain("salin-worker-peta.mjs");
  });

  it("middleware TIDAK mencegat .mjs – worker yang dialihkan ke /masuk memuat HTML", () => {
    // Jebakan kedua di rantai yang sama: middleware membungkus semua rute dan
    // daftar kecualiannya menyebut `js`, bukan `mjs`. Worker yang dijawab
    // pengalihan ke halaman masuk gagal dimuat — sekali lagi tanpa pesan.
    const mw = baca("src/middleware.ts");
    const matcher = /matcher: \[(.+?)\]/s.exec(mw)?.[1] ?? "";
    expect(matcher).toContain("mjs");
  });

  it("klien mengumumkan alamat worker itu SEBELUM peta dibuat", () => {
    const klien = baca("src/lib/peta/klien.ts");
    expect(klien).toContain('setWorkerUrl(JALUR_WORKER)');
    expect(klien).toContain('"/maplibre/maplibre-gl-worker.mjs"');
    // Urutannya penting: alamat worker ditetapkan sebelum protokol & peta.
    expect(klien.indexOf("setWorkerUrl")).toBeLessThan(klien.indexOf("addProtocol"));
  });

  it("kedua peta lewat siapkanPeta(), tidak memasang protokolnya sendiri", () => {
    for (const berkas of [
      "src/app/(app)/peta/peta-map.tsx",
      "src/app/(app)/master/lokasi/peta-titik.tsx",
    ]) {
      const isi = baca(berkas);
      expect(isi, berkas).toContain("siapkanPeta()");
      // Memasang protokol sendiri berarti melewati setWorkerUrl — dan peta di
      // layar itu kembali abu-abu tanpa pesan.
      expect(isi, berkas).not.toContain("addProtocol");
    }
  });
});
