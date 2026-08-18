/**
 * BAGIAN halaman Rencana & RAB — murni, tanpa DB (DECISIONS 362).
 *
 * Halaman ini punya tiga bagian setara yang sebelumnya ditumpuk vertikal;
 * pohon RAB yang berisi ratusan item ada di paling atas, sehingga dua bagian
 * lainnya praktis tidak pernah terlihat. Sekarang bagiannya dipilih lewat query
 * `?bagian=`.
 *
 * Aturan mainnya ditaruh di sini, bukan di dalam komponen halaman, karena dua
 * hal yang gampang rusak diam-diam justru ada di alamatnya:
 *
 *  1. nilai `bagian` yang tidak dikenal harus JATUH KE BAGIAN YANG SAH, bukan
 *     membuat halaman kosong;
 *  2. berpindah bagian harus MEMBAWA minggu yang sedang dilihat — kalau tidak,
 *     mampir ke pohon RAB lalu kembali ke rencana membuang pilihan minggunya
 *     dan orang mengira datanya hilang.
 */

import { bacaSubTab, hrefSubTab } from "@/lib/ui/sub-tab";

export type BagianRab = "rab" | "rencana" | "revisi";

export const BAGIAN_RAB: readonly BagianRab[] = ["rab", "rencana", "revisi"];

/** Default `"rab"`: pohon RAB adalah isi yang paling dulu ada di lokasi mana pun. */
export function bacaBagian(v: string | undefined | null): BagianRab {
  return bacaSubTab(BAGIAN_RAB, v, "rab");
}

/**
 * Alamat satu bagian, dengan minggu yang sedang dilihat ikut terbawa.
 *
 * `bagian` SELALU ditulis — juga untuk `"rab"` yang kebetulan default. Tautan
 * tanpa parameter memang mendarat di tempat yang sama hari ini, tapi ia berhenti
 * benar begitu defaultnya diubah, dan kegagalannya sunyi.
 */
export function hrefBagian(slug: string, bagian: BagianRab, minggu?: string | null): string {
  return hrefSubTab(`/lokasi/${slug}/rab`, bagian, { minggu });
}
