import { z } from "zod";

/**
 * Validasi environment saat startup. Import module ini = validasi jalan.
 * R2 opsional (fitur upload menonaktifkan diri bila belum dikonfigurasi),
 * tapi kalau ADA harus valid + dinormalisasi.
 */

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET minimal 32 karakter"),
});

const r2Schema = z.object({
  R2_ENDPOINT: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
});

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class EnvError extends Error {}

/** Normalisasi endpoint R2: trim, tolak protokol ganda, wajib https, tolak r2.dev (bukan endpoint S3). */
export function normalizeR2Endpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (/^https?:\/\/https?:\/\//i.test(trimmed)) {
    throw new EnvError("R2_ENDPOINT mengandung protokol ganda");
  }
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new EnvError(`R2_ENDPOINT bukan URL valid: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new EnvError("R2_ENDPOINT wajib https (TLS tidak boleh dimatikan)");
  }
  if (url.hostname.endsWith(".r2.dev") || url.hostname === "r2.dev") {
    throw new EnvError(
      "R2_ENDPOINT memakai domain r2.dev — itu domain publik, bukan endpoint S3. Pakai <accountid>.r2.cloudflarestorage.com",
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new EnvError("R2_ENDPOINT tidak boleh mengandung path (bucket diatur terpisah)");
  }
  return `${url.protocol}//${url.host}`;
}

function loadEnv() {
  const parsed = baseSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new EnvError(
      `Konfigurasi environment tidak valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  const anyR2 =
    process.env.R2_ENDPOINT || process.env.R2_BUCKET || process.env.R2_ACCESS_KEY_ID || process.env.R2_SECRET_ACCESS_KEY;
  let r2: R2Config | null = null;
  if (anyR2) {
    const r2Parsed = r2Schema.safeParse(process.env);
    if (!r2Parsed.success) {
      throw new EnvError(
        `Konfigurasi R2 tidak lengkap: ${r2Parsed.error.issues.map((i) => i.path.join(".")).join(", ")} — isi semua variabel R2 atau kosongkan semuanya`,
      );
    }
    r2 = {
      endpoint: normalizeR2Endpoint(r2Parsed.data.R2_ENDPOINT),
      bucket: r2Parsed.data.R2_BUCKET.trim(),
      accessKeyId: r2Parsed.data.R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: r2Parsed.data.R2_SECRET_ACCESS_KEY.trim(),
    };
  }

  return { ...parsed.data, r2 };
}

export const env = loadEnv();
export const isProduction = env.APP_ENV === "production";
