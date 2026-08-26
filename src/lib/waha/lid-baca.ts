/**
 * Pembacaan padanan `@lid` (DECISIONS 444) — MURNI, tanpa DB/jaringan, supaya
 * bisa diuji unit tanpa menyalakan aplikasi.
 */

/** MURNI: ambil JID bernomor pertama dari balasan WAHA, apa pun nama medannya. */
export function nomorDariBalasanLid(data: unknown): string | null {
  const lihat = (v: unknown): string | null => {
    if (typeof v === "string") {
      const t = v.trim();
      // `@lid` sengaja TIDAK diterima: itu yang sedang kita cari padanannya.
      return /^\d{8,15}(@(c\.us|s\.whatsapp\.net))?$/i.test(t) ? t : null;
    }
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = lihat(x);
        if (r) return r;
      }
      return null;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) {
        const r = lihat(x);
        if (r) return r;
      }
    }
    return null;
  };
  return lihat(data);
}


/** Kunci ingatan untuk satu LID. Satu LID = satu kunci, apa pun cara menulisnya. */
export function kunciLid(lid: string): string {
  return `waha.lid.${lid.trim().toLowerCase()}`;
}
