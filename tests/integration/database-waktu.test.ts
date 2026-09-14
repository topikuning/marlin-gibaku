import { afterAll, expect, it, vi } from "vitest";
vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>();
  const url = new URL(real.env.DATABASE_URL);
  // Paksa zona non-UTC juga di CI yang servernya memakai UTC secara default.
  url.searchParams.set("options", "-c timezone=Asia/Jakarta");
  return { ...real, env: { ...real.env, DATABASE_URL: url.toString() } };
});
import { db } from "@/lib/db";

afterAll(async () => { await db.$disconnect(); });

it("adapter memakai UTC walaupun server PostgreSQL memakai zona lokal", async () => {
  const [row] = await db.$queryRaw<{ zone: string; instant: Date; epoch: number }[]>`
    SELECT current_setting('TimeZone') AS zone, now() AS instant,
           extract(epoch FROM now())::double precision AS epoch
  `;
  expect(row.zone).toBe("UTC");
  expect(row.instant.getTime()).toBeCloseTo(row.epoch * 1000, -1);
});

it("timestamp bertanda zona tetap menunjuk instant yang sama saat dibaca adapter", async () => {
  const [row] = await db.$queryRaw<{ instant: Date; epoch: number }[]>`
    SELECT '2026-09-14 07:00:00+07'::timestamptz AS instant,
           extract(epoch FROM '2026-09-14 07:00:00+07'::timestamptz)::double precision AS epoch
  `;
  expect(row.instant.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  expect(row.instant.getTime()).toBe(row.epoch * 1000);
});
