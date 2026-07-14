import { defineConfig } from "prisma/config";

// Prisma CLI (v7) tidak membaca .env otomatis — muat via Node built-in.
try {
  process.loadEnvFile();
} catch {
  // .env tidak ada (mis. di CI/production, env dari platform)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
