import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Tes integrasi berbagi SATU database dan tiap file membersihkannya dengan
    // TRUNCATE global di afterAll. Jalankan file secara serial supaya cleanup
    // satu file tidak menghapus data file lain yang sedang berjalan.
    fileParallelism: false,
  },
});
