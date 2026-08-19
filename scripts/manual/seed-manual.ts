/**
 * Runner: pnpm manual:seed — DECISIONS 366. Logika di src/lib/seed/manual.ts.
 * Prasyarat: `pnpm db:seed` sudah pernah jalan di database yang sama (butuh
 * org/user/lokasi purworejo + RAB + baseline dasar).
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runManualSeed } from "../../src/lib/seed/manual";

try {
  process.loadEnvFile();
} catch {
  /* env dari shell */
}

if ((process.env.APP_ENV ?? "development") === "production") {
  console.error("TOLAK: pnpm manual:seed dilarang di production.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

runManualSeed(db)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
