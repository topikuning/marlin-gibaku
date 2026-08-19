import { normalizeChatId } from "./ingest-parse";

/**
 * SATU bentuk kanonik ID grup WhatsApp — dipakai saat MENULIS dan saat MEMBACA
 * (DECISIONS 370). Murni: tanpa DB, tanpa server-only.
 *
 * ### Kenapa ini harus satu fungsi
 *
 * Sebelumnya ada dua, dan keduanya tidak setuju:
 *
 * - `normalizeGroupChatId()` (client.ts) dipakai saat admin MENAUTKAN grup. Ia
 *   mengembalikan teks apa adanya begitu berakhiran `@g.us` — sufiks perangkat
 *   (`:12`) dan domain berhuruf besar lolos utuh.
 * - `normalizeChatId()` (ingest-parse.ts) dipakai saat pesan MASUK. Ia membuang
 *   sufiks perangkat, mengecilkan domain, dan menyatukan `s.whatsapp.net`
 *   dengan `c.us`.
 *
 * Akibatnya satu grup bisa tersimpan dalam bentuk yang tidak pernah sama persis
 * dengan bentuk yang datang dari webhook — dan itulah sebabnya pembacaan
 * terpaksa mencocokkan SELURUH varian (`varianChatId`) dengan `findFirst()`.
 * Pencocokan longgar plus `findFirst()` berarti: kalau dua paket menunjuk grup
 * yang sama, paket mana yang menjawab ditentukan urutan baris di basis data.
 * Itu bukan sekadar kotor — itu data paket A yang bisa terkirim ke grup paket B.
 *
 * Sesudah semua baris dikanonikkan (migration `20260819...`) dan indeks unik
 * dipasang, pembacaan cukup memakai kesamaan persis: satu grup → paling banyak
 * satu paket, dan hasilnya tidak lagi bergantung pada urutan.
 */

export class GrupIdTidakValid extends Error {}

/**
 * Bentuk kanonik, atau `null` bila kosong/tak terbaca.
 *
 * Sengaja TIDAK melempar: dipakai juga di jalur baca, tempat masukan tak
 * terbaca berarti "tidak cocok apa pun", bukan kegagalan.
 */
export function kanonikGrupId(raw: string | null | undefined): string | null {
  const dasar = normalizeChatId(raw);
  if (!dasar) return null;
  // `normalizeChatId` sudah membuang sufiks perangkat, mengecilkan domain, dan
  // menyatukan s.whatsapp.net→c.us. Yang tersisa: memastikan ada domainnya.
  if (!dasar.includes("@")) return null;
  return dasar;
}

/**
 * Untuk jalur TULIS: kanonik, atau melempar dengan sebab yang bisa dibaca admin.
 *
 * Grup WhatsApp berdomain `@g.us`. `@c.us` tetap diterima karena beberapa paket
 * memang mengirim ke satu kontak, bukan grup — perilaku lama yang tidak diubah
 * di sini supaya perbaikan ini tidak diam-diam mematikan paket yang berjalan.
 */
export function wajibKanonikGrupId(raw: string): string {
  // Kosong dan salah-format dibedakan: admin yang lupa mengisi butuh pesan lain
  // daripada admin yang menempel teks yang salah.
  if (!raw || !raw.trim()) throw new GrupIdTidakValid("ID grup kosong.");
  const k = kanonikGrupId(raw);
  if (!k) {
    throw new GrupIdTidakValid(
      `Format ID grup tidak dikenal: ${raw} (harusnya seperti 12036300000000@g.us).`,
    );
  }
  if (!k.endsWith("@g.us") && !k.endsWith("@c.us")) {
    throw new GrupIdTidakValid(
      `Format ID grup tidak dikenal: ${raw} (harusnya seperti 12036300000000@g.us).`,
    );
  }
  return k;
}
