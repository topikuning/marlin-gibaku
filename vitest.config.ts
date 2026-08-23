import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` melempar di luar bundler Next; di unit test ia no-op supaya
      // modul server (mis. export xlsx) tetap bisa diuji tanpa melemahkan proteksi.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    // .tsx ikut: blanko KKP adalah komponen React, dan penjaga formatnya
    // (FMT-01) hanya berarti kalau diuji dari hasil render, bukan dari sumber.
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Tes integrasi berbagi SATU database dan tiap file membersihkannya dengan
    // TRUNCATE global di afterAll. Jalankan file secara serial supaya cleanup
    // satu file tidak menghapus data file lain yang sedang berjalan.
    fileParallelism: false,
    /*
     * `afterAll` tes integrasi menjalankan TRUNCATE ... CASCADE lintas puluhan
     * tabel. Batas bawaan 10 detik cukup di mesin pengembang tapi TIDAK di
     * runner CI yang jauh lebih lambat: run 2026-08-23 gagal dengan "Hook timed
     * out in 10000ms" pada dua berkas WAHA — padahal SELURUH 840 uji lulus.
     * Yang gagal pembersihannya, bukan yang diuji. Menaikkan batasnya tidak
     * menutupi apa pun: uji yang benar-benar menggantung tetap gagal, hanya
     * lebih lambat.
     */
    hookTimeout: 60_000,
  },
});
