import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DatabaseUrlError, normalizeDatabaseUrl } from "@/lib/db-url";

/**
 * `DATABASE_URL` bentuk SQLAlchemy (DECISIONS 446).
 *
 * Panel database memajang beberapa bentuk URL untuk SATU database yang sama;
 * yang berakhiran `+asyncpg` ditujukan untuk pustaka Python dan ditolak Prisma
 * dengan pesan yang terdengar seperti "URL Anda salah total". Yang dijaga di
 * sini: nama driver dibuang, dan TIDAK ADA bagian lain dari URL yang berubah.
 */

const require_ = createRequire(import.meta.url);
const { normalizeDatabaseUrl: normalizeCjs } = require_("../../prisma/db-url.cjs") as {
  normalizeDatabaseUrl: (raw: string) => string;
};

/** Tabel bersama: dipakai untuk menguji versi TS DAN salinan CJS-nya. */
const KASUS: Array<[string, string]> = [
  // Yang benar-benar terjadi: URL Railway disalin dalam bentuk SQLAlchemy.
  [
    "postgresql+asyncpg://postgres:password@postgres-wkb.railway.internal:5432/railway",
    "postgresql://postgres:password@postgres-wkb.railway.internal:5432/railway",
  ],
  ["postgres+psycopg2://u:p@h:5432/db", "postgresql://u:p@h:5432/db"],
  ["POSTGRESQL+ASYNCPG://u:p@h:5432/db", "postgresql://u:p@h:5432/db"],
  // Bentuk yang sudah benar tidak boleh berubah sedikit pun.
  [
    "postgresql://u:p@h:5432/db?sslmode=require&connection_limit=5",
    "postgresql://u:p@h:5432/db?sslmode=require&connection_limit=5",
  ],
  ["postgres://u:p@h/db", "postgresql://u:p@h/db"],
  // Kutip & spasi ikut tersalin dari panel/.env — itu bukan bagian dari URL.
  ['  "postgresql+asyncpg://u:p@h/db"  ', "postgresql://u:p@h/db"],
  // Sandi boleh memuat '+' dan '@'; hanya SKEMA yang disentuh.
  ["postgresql+asyncpg://u:pa+ss@h/db", "postgresql://u:pa+ss@h/db"],
  ["postgresql://u:p%40ss@h/db", "postgresql://u:p%40ss@h/db"],
];

describe("normalizeDatabaseUrl", () => {
  it.each(KASUS)("%s", (masuk, keluar) => {
    expect(normalizeDatabaseUrl(masuk)).toBe(keluar);
  });

  it("menolak protokol yang bukan PostgreSQL dengan menyebut protokolnya", () => {
    expect(() => normalizeDatabaseUrl("mysql://u:p@h/db")).toThrow(DatabaseUrlError);
    expect(() => normalizeDatabaseUrl("mysql://u:p@h/db")).toThrow(/mysql:\/\//);
  });

  it("menolak yang kosong atau tanpa protokol – bukan menebak", () => {
    expect(() => normalizeDatabaseUrl("   ")).toThrow(DatabaseUrlError);
    expect(() => normalizeDatabaseUrl("postgres-wkb.railway.internal:5432/railway")).toThrow(
      DatabaseUrlError,
    );
  });
});

describe("salinan CJS untuk Prisma CLI tidak melenceng", () => {
  // prisma.config.js memuat salinan ini; runtime standalone tidak punya loader
  // TypeScript, jadi modul kanoniknya tak bisa dipakai di sana.
  it.each(KASUS)("%s", (masuk, keluar) => {
    expect(normalizeCjs(masuk)).toBe(keluar);
  });

  it("URL tak dikenali dikembalikan apa adanya – biar Prisma yang melapor", () => {
    expect(normalizeCjs("mysql://u:p@h/db")).toBe("mysql://u:p@h/db");
    expect(normalizeCjs("")).toBe("");
  });
});

describe("prisma.config.js memakai hasil normalisasi", () => {
  it("datasource.url ikut dirapikan dari DATABASE_URL", () => {
    const sebelum = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql+asyncpg://u:p@h:5432/db";
    try {
      delete require_.cache[require_.resolve("../../prisma.config.js")];
      const cfg = require_("../../prisma.config.js") as { datasource: { url: string } };
      expect(cfg.datasource.url).toBe("postgresql://u:p@h:5432/db");
    } finally {
      if (sebelum === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = sebelum;
    }
  });
});
