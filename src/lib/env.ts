import { z } from "zod";
import { DatabaseUrlError, normalizeDatabaseUrl } from "@/lib/db-url";

/**
 * Validasi environment saat startup. Import module ini = validasi jalan.
 * R2 opsional (fitur upload menonaktifkan diri bila belum dikonfigurasi),
 * tapi kalau ADA harus valid + dinormalisasi.
 */

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET minimal 32 karakter"),
  /**
   * Username super admin UTAMA (akar), dipisah koma. Opsional — kosong berarti
   * tidak ada akar, dan proteksi akun berperilaku seperti sebelumnya (sesama
   * super admin tidak bisa saling menyentuh). Lihat `lib/akar.ts`.
   */
  SUPER_ADMIN_UTAMA: z.string().optional(),
  /*
   * PETA (user 2026-09-06). Peta dasar vektor disimpan sendiri di R2 sebagai
   * satu berkas `.pmtiles`; kuncinya bisa diganti bila nanti ada beberapa
   * wilayah. Citra satelit datang dari penyedia ubin luar — templat DAN
   * atribusinya sengaja dijadikan variabel, karena atribusi adalah SYARAT
   * pemakaian: kalau sumbernya diganti tanpa menggantinya, kita memakai citra
   * orang tanpa menyebut siapa pemiliknya.
   */
  /*
   * ARSIP DINGIN BERKAS ASLI (2026-09-09). Empat variabel, dan itu SUDAH
   * seluruhnya — rancangan awalnya minta empat belas.
   *
   * Yang tidak ada di sini, beserta alasannya: sakelar hidup/mati ada di layar
   * Sistem supaya bisa diganti tanpa deploy ulang; batas waktu, ukuran satuan
   * kirim, dan masa tenggang jadi konstanta seperti antrean Drive; zona waktu
   * karena seluruh aplikasi ini memang Asia/Jakarta; jendela jam karena yang
   * menentukan KAPAN berjalan adalah jadwal cron, bukan aplikasi; dan seluruh
   * ambang disk karena tidak ada disk perantara sama sekali.
   */
  /** Alamat penyimpan arsip dingin. Kosong = fitur mati, tanpa galat. */
  ORIGINAL_ARCHIVE_URL: z.string().optional(),
  ORIGINAL_ARCHIVE_TOKEN: z.string().optional(),
  /** Sepasang token layanan Cloudflare Access. Kosongkan bila tidak di baliknya. */
  ORIGINAL_ARCHIVE_CF_CLIENT_ID: z.string().optional(),
  ORIGINAL_ARCHIVE_CF_CLIENT_SECRET: z.string().optional(),
  /** Direktori peta dasar di VOLUME (sejajar LAMPIRAN_DIR). */
  PETA_DIR: z.string().optional(),
  /**
   * Dari mana berkas peta dasar diunduh saat tombol di /sistem ditekan. Satu
   * berkas melayani SEMUA lingkungan — dev dan produksi punya volume
   * masing-masing, jadi tidak ada kunci yang perlu disamakan.
   */
  PETA_SUMBER_URL: z.string().optional(),
  /**
   * Matikan peta SEPENUHNYA. Hanya diisi job E2E di CI ("1"); tidak pernah
   * diisi di lingkungan mana pun yang dipakai orang, termasuk dev — lihat
   * catatan panjang di `lib/peta/sumber.ts`.
   */
  PETA_MATI: z.string().optional(),
  PETA_SATELIT_URL: z.string().optional(),
  PETA_SATELIT_ATRIBUSI: z.string().optional(),
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
      "R2_ENDPOINT memakai domain r2.dev – itu domain publik, bukan endpoint S3. Pakai <accountid>.r2.cloudflarestorage.com",
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

  // Bentuk `postgresql+asyncpg://` (SQLAlchemy) dirapikan, bukan ditolak —
  // lihat `lib/db-url.ts`. Skema non-PostgreSQL tetap ditolak.
  let databaseUrl: string;
  try {
    databaseUrl = normalizeDatabaseUrl(parsed.data.DATABASE_URL);
  } catch (e) {
    throw e instanceof DatabaseUrlError ? new EnvError(e.message) : e;
  }

  const anyR2 =
    process.env.R2_ENDPOINT || process.env.R2_BUCKET || process.env.R2_ACCESS_KEY_ID || process.env.R2_SECRET_ACCESS_KEY;
  let r2: R2Config | null = null;
  if (anyR2) {
    const r2Parsed = r2Schema.safeParse(process.env);
    if (!r2Parsed.success) {
      throw new EnvError(
        `Konfigurasi R2 tidak lengkap: ${r2Parsed.error.issues.map((i) => i.path.join(".")).join(", ")} – isi semua variabel R2 atau kosongkan semuanya`,
      );
    }
    r2 = {
      endpoint: normalizeR2Endpoint(r2Parsed.data.R2_ENDPOINT),
      bucket: r2Parsed.data.R2_BUCKET.trim(),
      accessKeyId: r2Parsed.data.R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: r2Parsed.data.R2_SECRET_ACCESS_KEY.trim(),
    };
  }

  return { ...parsed.data, DATABASE_URL: databaseUrl, r2 };
}

export const env = loadEnv();
export const isProduction = env.APP_ENV === "production";
