// Reset database HANYA untuk development/test. Guard ganda: APP_ENV + nama DB.
import { execSync } from "node:child_process";

try {
  process.loadEnvFile();
} catch {
  /* env dari shell */
}

const appEnv = process.env.APP_ENV ?? "development";
const dbUrl = process.env.DATABASE_URL ?? "";

if (appEnv === "production") {
  console.error("TOLAK: db:reset dilarang saat APP_ENV=production.");
  process.exit(1);
}
if (!/marlin_(dev|test)/.test(dbUrl) && !process.env.RESET_DB_I_KNOW) {
  console.error(
    "TOLAK: DATABASE_URL tidak terlihat seperti database dev/test (marlin_dev / marlin_test).\n" +
      "Kalau memang yakin, set RESET_DB_I_KNOW=1.",
  );
  process.exit(1);
}

execSync("pnpm prisma migrate reset --force", { stdio: "inherit" });
