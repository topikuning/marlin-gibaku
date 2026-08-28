import { AiGuardError } from "./guard-rules";

/**
 * Kalimat gagal untuk PENANYA — bukan pesan galat mentah (DECISIONS 456).
 *
 * `AiRun.errorMessage` datang dari provider pihak ketiga: berbahasa Inggris,
 * kadang memuat nama model, endpoint, atau potongan payload. Menempelkannya ke
 * gelembung percakapan berarti menaruh keterangan dalaman di layar orang
 * lapangan yang tidak bisa berbuat apa-apa dengannya — dan tetap tersimpan di
 * `AiMessage` selamanya.
 *
 * Yang tidak disamarkan: penolakan PAGAR (kuota, kill switch, lingkup). Itu
 * kalimat buatan MARLIN sendiri, berbahasa Indonesia, dan justru menyebutkan
 * apa yang harus dilakukan penanya. Menyamarkannya akan membuang satu-satunya
 * keterangan yang berguna.
 *
 * Rincian teknisnya TIDAK hilang: ia tetap tersimpan di `AiRun.errorMessage`
 * dan terbaca admin di layar run.
 */
export function pesanGagalUntukPenanya(err: unknown): string {
  if (err instanceof AiGuardError) return err.message;
  return "Maaf, pertanyaan ini belum bisa dijawab: layanan AI sedang tidak merespons. Coba lagi sebentar lagi – rincian galatnya tercatat di riwayat analisis.";
}
