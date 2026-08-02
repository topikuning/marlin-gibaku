"use server";

import { requireUser } from "@/lib/auth/session";
import { searchGlobal } from "./global";
import type { SearchHit } from "./types";

/**
 * Server action pencarian global. Sengaja TIDAK menerima daftar objek dari
 * client: seluruh penyaringan capability + scope terjadi di server, sehingga
 * client tidak pernah memegang data yang tidak boleh dilihatnya.
 *
 * Bukan mutasi → tanpa `audit()`. Tetap `requireUser()`: tanpa sesi, nol hasil.
 */
export async function cariGlobal(q: string): Promise<SearchHit[]> {
  const user = await requireUser();
  return searchGlobal(user, q);
}
