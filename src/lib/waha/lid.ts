import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { kunciLid } from "./lid-baca";

/**
 * Padanan `@lid` → nomor telepon, dengan INGATAN (DECISIONS 444).
 *
 * ### Kenapa ini ada
 *
 * WhatsApp makin sering mengirim identitas privasi `@lid` alih-alih nomor —
 * pada engine WAHA mana pun, WEBJS termasuk. Akibatnya di lapangan sangat
 * spesifik dan membingungkan: orang yang SAMA dijawab di grup (di sana
 * identitas memang tidak menentukan apa-apa, DECISIONS 351) tapi didiamkan di
 * chat pribadi, karena di sana nomornya satu-satunya dasar.
 *
 * ### Kenapa ditanyakan ke WAHA, bukan ditebak dari payload
 *
 * Pemetaan `@lid` ↔ nomor hanya dipegang sesi WhatsApp. Menebaknya dari nama
 * medan payload berarti mengejar rilis WAHA satu tebakan per pesan asli —
 * persis jebakan yang sudah dicatat DECISIONS 347.
 *
 * ### Kenapa diingat
 *
 * Jawaban WAHA tidak selalu ada (waha#1830), dan memanggilnya tiap pesan masuk
 * membuat balasan bergantung pada satu panggilan jaringan tambahan. Yang sudah
 * pernah terjawab disimpan; yang gagal TIDAK disimpan, supaya percobaan
 * berikutnya masih punya kesempatan.
 */

/**
 * Nomor di balik satu `@lid`, dari ingatan lalu dari WAHA.
 *
 * `null` = belum diketahui. Itu bukan galat: pemanggil tetap boleh mendiamkan
 * pesannya, dan alasannya yang tercatat kini menyebut bahwa WAHA pun tidak
 * mengenalinya — bukan sekadar "nomor tidak cocok".
 */
export async function nomorDariLid(lid: string): Promise<string | null> {
  const kunci = kunciLid(lid);
  // AppSetting ber-riwayat (unik per key+tanggal berlaku); yang dipakai selalu
  // baris TERBARU, sama seperti setelan WAHA lainnya.
  const tersimpan = await db.appSetting.findFirst({
    where: { key: kunci },
    orderBy: { effectiveFrom: "desc" },
    select: { value: true },
  });
  const dariIngatan = tersimpan?.value?.trim();
  if (dariIngatan) return dariIngatan;

  let nomor: string | null = null;
  try {
    const { lidKeNomor } = await import("./client");
    nomor = await lidKeNomor(lid);
  } catch {
    // WAHA mati / rute tidak ada: perlakukan sebagai "belum diketahui".
    return null;
  }
  if (!nomor) return null;

  // Disimpan supaya pesan berikutnya tidak menunggu jaringan lagi. Kegagalan
  // menyimpan tidak boleh menggagalkan jawaban yang sudah bisa diberikan.
  try {
    const effectiveFrom = jakartaToday();
    await db.appSetting.upsert({
      where: { key_effectiveFrom: { key: kunci, effectiveFrom } },
      update: { value: nomor },
      create: { key: kunci, value: nomor, effectiveFrom },
    });
  } catch {
    /* abaikan */
  }
  return nomor;
}
