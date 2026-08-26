/**
 * Salinan CommonJS dari `src/lib/db-url.ts` (DECISIONS 446).
 *
 * Kenapa disalin, bukan di-import: berkas ini dimuat oleh `prisma.config.js`
 * lewat Prisma CLI di image runtime, yang TIDAK punya loader TypeScript (tsx
 * dan typescript adalah devDependency dan tidak ikut ke tree standalone).
 *
 * Supaya salinan ini tidak melenceng diam-diam dari yang kanonik, KEDUANYA
 * diuji terhadap tabel kasus yang sama di `tests/unit/database-url.test.ts`.
 *
 * Satu beda yang DISENGAJA: di sini URL yang tidak dikenali dikembalikan APA
 * ADANYA. Jalur CLI adalah jalur migrasi deploy — ia harus sampai ke pesan
 * galat Prisma sendiri, bukan mati lebih dulu dengan galat kami.
 */
function normalizeDatabaseUrl(raw) {
  const bersih = String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  const cocok = /^([A-Za-z][A-Za-z0-9]*)(\+[A-Za-z0-9_.-]+)?:\/\//.exec(bersih);
  if (!cocok) return bersih;
  const skema = cocok[1].toLowerCase();
  if (skema !== "postgres" && skema !== "postgresql") return bersih;
  return `postgresql://${bersih.slice(cocok[0].length)}`;
}

module.exports = { normalizeDatabaseUrl };
