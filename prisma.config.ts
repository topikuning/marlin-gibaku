// Konfigurasi Prisma CLI (v7).
// SENGAJA tanpa `import { defineConfig } from "prisma/config"`: file ini juga dimuat
// oleh prisma CLI global di container Railway (pre-deploy `prisma migrate deploy`),
// dan paket `prisma` tidak ada di node_modules runtime standalone — import itu
// membuat pre-deploy gagal ("Cannot find module 'prisma/config'").

// Prisma CLI v7 tidak membaca .env otomatis — muat via Node built-in (dev lokal).
try {
  process.loadEnvFile();
} catch {
  // .env tidak ada (CI/production — env dari platform)
}

export default {
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
};
