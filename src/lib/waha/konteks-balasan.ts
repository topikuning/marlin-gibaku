import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * KONTEKS BALASAN – siapa yang sedang dijawab MARLIN (DECISIONS baru 2026-10-07).
 *
 * Penjawab pesan WhatsApp mengirim balasan dari dua puluhan tempat. Daripada
 * menyisipkan "balas ke pesan siapa" di setiap panggilan – dan pasti ada satu
 * yang terlewat – penjawab menjalankan seluruh pekerjaannya di dalam konteks
 * ini, dan `balasWa`/`balasFileWa` membacanya sendiri.
 *
 * Dengan konteks ini, jawaban di grup MENGUTIP pesan penanya (fitur balas
 * WhatsApp), dan outbox mencatat siapa yang meminta.
 */
export type KonteksBalasan = {
  /** ID pesan yang dijawab – dikutip di WhatsApp. */
  balasKe: string | null;
  /** Akun MARLIN penanya, bila dikenali. */
  dimintaOlehId: string | null;
  /** Nama penanya (akun MARLIN, nama di Master Kontak, atau nama WhatsApp). */
  peminta: string | null;
};

const simpan = new AsyncLocalStorage<KonteksBalasan>();

export function jalankanDenganKonteksBalasan<T>(k: KonteksBalasan, fn: () => Promise<T>): Promise<T> {
  return simpan.run(k, fn);
}

/** Konteks yang sedang berlaku, atau null di luar penjawab pesan. */
export function konteksBalasan(): KonteksBalasan | null {
  return simpan.getStore() ?? null;
}
