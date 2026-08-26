// Prisma CLI config (v7) — plain JavaScript so the globally-installed prisma
// CLI in the standalone runtime can load it without a TypeScript loader
// (tsx/typescript are devDependencies and are absent from the Next.js
// standalone node_modules used at runtime).

// Prisma CLI v7 does not read .env automatically — load via Node built-in (local dev).
try {
  process.loadEnvFile();
} catch {
  // .env absent (CI/production — env provided by the platform)
}

// `postgresql+asyncpg://` (bentuk SQLAlchemy) dirapikan jadi `postgresql://`
// sebelum sampai ke Prisma — DECISIONS 446, lihat prisma/db-url.cjs.
const { normalizeDatabaseUrl } = require("./prisma/db-url.cjs");

module.exports = {
  schema: "prisma/schema.prisma",
  datasource: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL ?? ""),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
};
