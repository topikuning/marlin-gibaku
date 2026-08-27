import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Deployment MARLIN tidak boleh membutuhkan operator menjalankan migrasi.
 * Railway harus memigrasikan DB dari image yang sama sebelum server baru hidup.
 */
describe("deploy Railway otomatis", () => {
  const root = process.cwd();
  const railway = JSON.parse(readFileSync(join(root, "railway.json"), "utf8")) as {
    build?: { builder?: string; dockerfilePath?: string };
    deploy?: { preDeployCommand?: string };
  };
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

  it("memakai Dockerfile dan menjalankan pemulih migrasi sebelum deploy", () => {
    expect(railway.build).toMatchObject({ builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
    expect(railway.deploy?.preDeployCommand).toBe("node scripts/migrate-deploy.mjs");
  });

  it("image runtime membawa CLI, schema, seluruh migrasi, dan skrip pre-deploy", () => {
    expect(dockerfile).toContain("npm install -g prisma@7.8.0");
    expect(dockerfile).toContain("/app/prisma ./prisma");
    expect(dockerfile).toContain("/app/scripts/migrate-deploy.mjs ./scripts/migrate-deploy.mjs");
  });
});
