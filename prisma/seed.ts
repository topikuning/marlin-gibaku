/**
 * Runner seed dev: pnpm db:seed. Logika ada di src/lib/seed/demo.ts (dipakai juga
 * oleh bootstrap BOOTSTRAP_DEMO_DATA=true saat deploy uji coba).
 * Guard: CLI ini menolak APP_ENV=production — di production pakai env bootstrap
 * yang eksplisit (lihat docs/DEPLOY_RAILWAY.md §5).
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runDemoSeed } from "../src/lib/seed/demo";

try {
  process.loadEnvFile();
} catch {
  /* env dari shell */
}

if ((process.env.APP_ENV ?? "development") === "production") {
  console.error("TOLAK: pnpm db:seed dilarang di production. Pakai BOOTSTRAP_DEMO_DATA=true (sadar & eksplisit).");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

runDemoSeed(db)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
