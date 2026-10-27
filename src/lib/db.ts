import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // adapter-pg menormalisasi timestamp seolah sesi PostgreSQL selalu UTC.
  // Pin zona pada setiap koneksi; pilihan URL lain tetap dipertahankan.
  const url = new URL(env.DATABASE_URL);
  const options = url.searchParams.get("options") ?? "";
  url.searchParams.set("options", `${options} -c timezone=UTC`.trim());
  const adapter = new PrismaPg({ connectionString: url.toString() });
  /*
   * BATAS WAKTU TRANSAKSI BAWAAN 30 detik (DECISIONS 712), bukan 5 detik bawaan
   * Prisma. Dari 101 transaksi interaktif hanya 6 yang menyetel batasnya
   * sendiri; sisanya gagal begitu datanya cukup besar – impor draft adendum
   * Songbanyu 2026-10-27 dibatalkan di 5.026 ms saat mengganti draft lama.
   * Transaksi yang memang berat tetap menyetel batasnya sendiri (60–120 detik).
   */
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
}

export const db = globalForPrisma.prisma ?? createClient();

if (env.APP_ENV !== "production") globalForPrisma.prisma = db;
