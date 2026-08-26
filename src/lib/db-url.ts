/**
 * Normalisasi `DATABASE_URL` (DECISIONS 446).
 *
 * ### Kenapa ini ada
 *
 * Panel database (Railway, Supabase, Neon) memajang beberapa bentuk URL untuk
 * satu database yang sama, sebagian ditujukan untuk pustaka bahasa lain:
 *
 *   postgresql://…              ← yang dimengerti Prisma / node-postgres
 *   postgresql+asyncpg://…      ← bentuk SQLAlchemy (Python)
 *   postgresql+psycopg2://…     ← idem
 *
 * Akhiran `+asyncpg` itu BUKAN bagian dari protokol PostgreSQL; itu penanda
 * driver milik SQLAlchemy. Prisma dan `pg` menolaknya mentah-mentah, dan
 * pesannya ("the URL must start with the protocol `postgresql://`") tidak
 * menyebut bahwa yang salah cuma satu potongan kata — jadi terbaca seperti
 * "URL saya salah total" padahal host, sandi, dan nama database sudah benar.
 * Menyalin bentuk yang keliru itu sekali saja sudah membuat seluruh deploy
 * gagal di preDeploy.
 *
 * Karena satu-satunya beda yang nyata adalah nama driver, sistem yang
 * menyesuaikan — bukan orangnya yang harus hafal bentuk mana milik siapa.
 *
 * ### Yang SENGAJA tidak dilakukan
 *
 * Hanya SKEMA yang disentuh. Host, port, kredensial, nama database, dan query
 * string dibiarkan apa adanya — menebak salah satu dari itu berarti menyambung
 * ke database yang tidak diminta. Skema yang bukan PostgreSQL (mysql, mongodb,
 * dan sejenisnya) DITOLAK dengan menyebut skemanya, bukan dipaksa jadi
 * postgres.
 */

/** Skema yang memang PostgreSQL, sebelum akhiran driver dipotong. */
const SKEMA_POSTGRES = new Set(["postgres", "postgresql"]);

export class DatabaseUrlError extends Error {}

/**
 * `postgresql+asyncpg://…` → `postgresql://…`; sisanya tak tersentuh.
 *
 * Melempar {@link DatabaseUrlError} bila kosong atau bukan PostgreSQL —
 * gagal di sini jauh lebih murah daripada gagal saat koneksi pertama.
 */
export function normalizeDatabaseUrl(raw: string): string {
  // Tanda kutip ikut tersalin cukup sering saat orang menyalin dari panel
  // atau dari berkas .env; itu bukan bagian dari URL.
  const bersih = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!bersih) throw new DatabaseUrlError("DATABASE_URL kosong");

  const cocok = /^([A-Za-z][A-Za-z0-9]*)(\+[A-Za-z0-9_.-]+)?:\/\//.exec(bersih);
  if (!cocok) {
    throw new DatabaseUrlError(
      "DATABASE_URL tidak menyebut protokol – seharusnya diawali postgresql://",
    );
  }

  const skema = cocok[1].toLowerCase();
  if (!SKEMA_POSTGRES.has(skema)) {
    throw new DatabaseUrlError(
      `DATABASE_URL memakai protokol ${skema}:// – MARLIN hanya berjalan di PostgreSQL`,
    );
  }

  return `postgresql://${bersih.slice(cocok[0].length)}`;
}
