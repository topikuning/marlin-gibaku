/**
 * Menggolongkan kegagalan `pnpm audit --prod --audit-level high`.
 *
 * CI 2026-09-04 memerahkan PR dengan pesan *"Security audit menemukan
 * kerentanan high-severity"* padahal yang terjadi adalah endpoint advisories
 * npm TIDAK MENJAWAB (`[23] The operation was aborted due to timeout`).
 * Penjaga lama hanya mengenali satu bentuk kegagalan endpoint
 * (`ERR_PNPM_AUDIT_BAD_RESPONSE`); bentuk lain jatuh ke cabang "ada
 * kerentanan" — tuduhan yang salah, dan lebih buruk daripada tidak ada
 * penjaga: sekali orang tahu pesan itu bisa bohong, temuan yang ASLI ikut
 * tidak dipercaya.
 *
 * Logikanya ditaruh di berkas tersendiri, bukan di YAML, supaya bisa DIUJI —
 * alasan yang sama dengan `ci-perlu.mjs` (DECISIONS 515).
 *
 * Golongan:
 * - `aman`    — keluar 0, tidak ada apa-apa.
 * - `temuan`  — audit benar-benar menemukan kerentanan. CI WAJIB merah.
 * - `endpoint`— registry/jaringan yang gagal, bukan kerentanan. Boleh diulang.
 *
 * Yang tidak dikenali digolongkan `temuan`. Bawaan yang aman: lebih baik
 * berhenti untuk sesuatu yang ternyata bukan kerentanan daripada meloloskan
 * kerentanan yang pesannya tidak kita kenali.
 */

/** Bekas temuan sungguhan pada keluaran pnpm audit. */
const POLA_TEMUAN = [
  /\bvulnerabilit(?:y|ies)\s+found\b/i,
  /^\s*│?\s*(?:high|critical)\s*│/im,
  /\bseverity\s*:\s*\d+/i,
  /\b\d+\s+(?:high|critical)\b/i,
];

/** Bekas endpoint/jaringan yang tidak menjawab — bukan kerentanan. */
const POLA_ENDPOINT = [
  /ERR_PNPM_AUDIT_BAD_RESPONSE/i,
  /ERR_PNPM_FETCH_(?:4\d\d|5\d\d)/i,
  /aborted due to timeout/i,
  /TimeoutError/i,
  /network timeout/i,
  /socket hang up/i,
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i,
  /request to https?:\/\/\S*registry\S* failed/i,
  /registry\.npmjs\.org\S*\s+error/i,
];

/**
 * @param {string} keluaran gabungan stdout+stderr `pnpm audit`
 * @param {number} kode exit code
 * @returns {"aman" | "temuan" | "endpoint"}
 */
export function klasifikasiAudit(keluaran, kode) {
  if (kode === 0) return "aman";
  const teks = String(keluaran ?? "");
  // Temuan diperiksa LEBIH DULU: balasan yang memuat kerentanan sekaligus
  // keluhan jaringan (mis. satu registry gagal, satu berhasil) tetap harus
  // merah.
  if (POLA_TEMUAN.some((p) => p.test(teks))) return "temuan";
  if (POLA_ENDPOINT.some((p) => p.test(teks))) return "endpoint";
  return "temuan";
}

// CLI: teks audit lewat stdin, exit code sebagai argumen. Mencetak golongannya.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const kode = Number(process.argv[2] ?? 1);
  let masuk = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (masuk += c));
  process.stdin.on("end", () => {
    process.stdout.write(klasifikasiAudit(masuk, kode));
  });
}
