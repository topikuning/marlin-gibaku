import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Penanda "kode ini berjalan di LATAR, bukan di dalam request" (DECISIONS 456).
 *
 * ### Kenapa ada
 *
 * Sejak Ask MARLIN menjawab di latar (DECISIONS 455), `audit()` ikut dipanggil
 * setelah responsnya dikirim — dan `headers()` hanya hidup di dalam scope
 * request. Penambalan pertamanya membungkus `requestIp()` dengan `try/catch`
 * yang menelan SEMUA galat. Itu memang menyelamatkan pekerjaan latar, tetapi
 * ongkosnya dibayar seluruh aplikasi: kegagalan `headers()` yang SUNGGUHAN di
 * dalam request pun ikut senyap, dan jejak auditnya kehilangan IP tanpa satu
 * pun tanda.
 *
 * Yang dipakai sekarang bukan menebak dari galat, melainkan MENYATAKAN
 * niatnya: pemanggil latar membungkus pekerjaannya, dan `requestIp()` tidak
 * pernah menyentuh `headers()` di sana. Di dalam request ia kembali ketat —
 * galat berarti galat.
 *
 * `AsyncLocalStorage` mengikuti seluruh rantai `await` di dalam callback, jadi
 * penandanya ikut sampai ke `audit()` sedalam apa pun ia dipanggil.
 */
const penanda = new AsyncLocalStorage<true>();

/** Jalankan `fn` sebagai pekerjaan latar — tanpa scope request. */
export function jalankanDiLatar<T>(fn: () => Promise<T>): Promise<T> {
  return penanda.run(true, fn);
}

/** Benarkah kode yang sedang berjalan ini pekerjaan latar? */
export function diLatar(): boolean {
  return penanda.getStore() === true;
}
