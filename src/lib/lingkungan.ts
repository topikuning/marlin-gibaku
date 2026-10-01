/**
 * PENANDA LINGKUNGAN (DECISIONS 640).
 *
 * User 2026-10-01: *"aku perlu pembeda di server dev/test agar user bisa sadar
 * dia di environment mana, karena kalau cuma domain yang beda rentan lupa."*
 *
 * Satu keputusan, satu tempat: label yang ditampilkan di bilah atas, kepala
 * halaman masuk, dan judul tab. `null` = produksi – tidak ada penanda sama
 * sekali, supaya produksi tetap bersih dan penandanya tidak menjadi
 * pemandangan biasa yang diabaikan.
 *
 * - `PENANDA_LINGKUNGAN` diisi (mis. "DEV", "TEST", "STAGING") → label itu,
 *   APA PUN `APP_ENV`-nya. Server dev yang memakai image produksi
 *   (`APP_ENV=production`) cukup mengisi variabel ini.
 * - Tidak diisi → `APP_ENV` selain production otomatis berlabel ("DEV"/"TEST"),
 *   jadi lupa mengisinya tidak membuat server uji tampil seperti produksi.
 */
export function labelLingkungan(e: { APP_ENV: string; PENANDA_LINGKUNGAN?: string }): string | null {
  const label = (e.PENANDA_LINGKUNGAN ?? "").trim().slice(0, 20);
  if (label) return label.toUpperCase();
  if (e.APP_ENV === "production") return null;
  return e.APP_ENV === "test" ? "TEST" : "DEV";
}
