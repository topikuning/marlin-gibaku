/**
 * Guard scope untuk JALUR BACA AI — murni, tanpa DB (audit 2026-07-27, B9).
 *
 * Jalur generate sudah ketat (`resolveAiScope` meng-intersect izin sebelum run
 * dibuat), tetapi jalur baca (riwayat run, artefak, Excel, cetak) dulu hanya
 * memeriksa capability `ai.view` — user ber-scope sempit bisa membuka laporan
 * AI berisi angka lokasi di luar scope-nya.
 *
 * Aturan: user boleh membaca run/artefak bila SEMUA lokasi pada `scopeIds` run
 * termasuk lokasi yang boleh ia akses. `accessible === null` = role lintas
 * lokasi (super_admin / program_director / exec_viewer) → selalu boleh.
 * `scopeIds` kosong / bukan array = scope tak teridentifikasi → HANYA role
 * lintas lokasi (jangan menebak, jangan bocorkan).
 */
export function scopeCoveredBy(accessible: string[] | null, scopeIds: unknown): boolean {
  if (accessible === null) return true;
  // Elemen non-string = data korup. JANGAN dibuang-lalu-loloskan — elemen yang
  // dibuang bisa saja lokasi di luar izin. Scope korup = tak teridentifikasi.
  if (!Array.isArray(scopeIds) || scopeIds.length === 0) return false;
  if (!scopeIds.every((x): x is string => typeof x === "string")) return false;
  const allowed = new Set(accessible);
  return scopeIds.every((id) => allowed.has(id));
}
