import "server-only";
import { encryptionKeyFromEnv, encryptSecret, isEncryptedSecret, kunciRahasia } from "@/lib/ai/crypto";
import { db } from "@/lib/db";

/**
 * Enkripsi-ulang rahasia yang masih tersimpan TELANJANG di `AppSetting`.
 *
 * Kenapa perlu, padahal penjaga penulisan sudah diperbaiki: penjaga hanya
 * mengawasi tulisan BARU. Nilai yang sudah telanjang di basis data tetap
 * telanjang selamanya, dan `readStoredSecret` menerimanya demi kompatibilitas —
 * jadi ia terus bekerja, tak pernah mengeluh, dan tak pernah ketahuan sampai
 * salinan basis datanya berpindah tangan. Cadangan lapangan 24 Agustus 2026
 * memuat `ai.claude.api_key` (`sk-ant-…`), `waha.api_key`, dan
 * `waha.webhook_secret` dalam bentuk terbaca.
 *
 * Karena itu perbaikannya harus berjalan sendiri saat boot, bukan jadi daftar
 * langkah manual: satu langkah manual yang terlewat meninggalkan kunci hidup di
 * basis data untuk waktu yang tak ditentukan.
 *
 * Sengaja TIDAK berhenti lewat penanda `AppSetting` seperti migrasi lain: ia
 * murah (satu SELECT ber-filter), dan rahasia telanjang bisa lahir lagi dari
 * baris `effectiveFrom` baru yang ditulis saat `AI_SECRET_ENCRYPTION_KEY`
 * kebetulan belum terpasang. Migrasi yang mematikan dirinya sendiri tidak akan
 * pernah menangkap yang kedua.
 *
 * Nilainya TIDAK pernah masuk log — hanya kuncinya, dan hanya jumlahnya.
 */
export type HasilMigrasiRahasia =
  | { status: "selesai"; diperiksa: number; dienkripsi: number }
  | { status: "dilewati"; alasan: "tanpa_kunci"; telanjang: number };

export async function enkripsiUlangRahasiaTelanjang(): Promise<HasilMigrasiRahasia> {
  const rows = await db.appSetting.findMany({
    select: { id: true, key: true, value: true },
  });
  const rahasia = rows.filter((r) => kunciRahasia(r.key));
  const telanjang = rahasia.filter((r) => r.value.trim() !== "" && !isEncryptedSecret(r.value));

  const kunci = encryptionKeyFromEnv();
  if (!kunci) {
    /*
     * Tanpa kunci tidak ada yang bisa dikerjakan — tetapi diamnya berbahaya,
     * jadi keadaannya dikembalikan supaya pemanggil bisa BERTERIAK. Rahasia
     * telanjang yang tidak ada yang tahu adalah bentuk terburuknya.
     */
    return { status: "dilewati", alasan: "tanpa_kunci", telanjang: telanjang.length };
  }

  for (const r of telanjang) {
    await db.appSetting.update({
      where: { id: r.id },
      data: { value: encryptSecret(r.value.trim(), kunci) },
    });
  }
  return { status: "selesai", diperiksa: rahasia.length, dienkripsi: telanjang.length };
}
