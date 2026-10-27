/*
 * BATAS WAKTU TRANSAKSI (DECISIONS 712).
 *
 * Impor draft adendum Songbanyu 2026-10-27 dibatalkan Prisma: "A commit cannot
 * be executed on an expired transaction ... 5000 ms". Bawaan transaksi
 * interaktif Prisma 5 detik, dan hanya 6 dari 101 transaksi menyetel batasnya
 * sendiri. Waktu habis tidak bisa diuji dengan andal, jadi yang dikunci di
 * sini SETELANNYA: batas bawaan klien, dan batas eksplisit dua transaksi draft
 * yang bebannya sebanding dengan ukuran RAB.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/generated/prisma/client");
  vi.doUnmock("@prisma/adapter-pg");
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/lib/db");
});

describe("klien Prisma", () => {
  it("batas waktu transaksi bawaan ≥ 30 detik, bukan 5 detik bawaan Prisma", async () => {
    let opsi: { transactionOptions?: { timeout?: number; maxWait?: number } } | undefined;
    vi.doMock("@/generated/prisma/client", () => ({
      PrismaClient: class {
        constructor(o: typeof opsi) {
          opsi = o;
        }
      },
    }));
    vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
    vi.doMock("@/lib/env", () => ({ env: { DATABASE_URL: "postgresql://u:p@localhost:5432/x", APP_ENV: "test" } }));
    (globalThis as { prisma?: unknown }).prisma = undefined;
    await import("@/lib/db");
    expect(opsi?.transactionOptions?.timeout).toBeGreaterThanOrEqual(30_000);
    expect(opsi?.transactionOptions?.maxWait).toBeGreaterThanOrEqual(5_000);
  });
});

describe("transaksi draft adendum yang bebannya sebesar RAB", () => {
  const tangkap = () => {
    const opsi: ({ timeout?: number } | undefined)[] = [];
    vi.doMock("@/lib/db", () => ({
      db: {
        $transaction: async (_fn: unknown, o?: { timeout?: number }) => {
          opsi.push(o);
          return undefined;
        },
      },
    }));
    return opsi;
  };

  it("mengganti draft lama (impor draft) ≥ 60 detik", async () => {
    const opsi = tangkap();
    const { gantiDraftLama } = await import("@/lib/rab/import");
    await gantiDraftLama("lama", "baru", "user");
    expect(opsi[0]?.timeout).toBeGreaterThanOrEqual(60_000);
  });

  it("membuat draft sebagai salinan penuh revisi aktif ≥ 60 detik", async () => {
    const opsi = tangkap();
    const { createAdendumDraft } = await import("@/lib/rab/adendum");
    await createAdendumDraft("lokasi", "user");
    expect(opsi[0]?.timeout).toBeGreaterThanOrEqual(60_000);
  });
});
