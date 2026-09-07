import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * BAWAAN TAMPILAN PENANDA PETA: berkelompok, atau satu per satu.
 *
 * Pertanyaan user 2026-09-06: *"bagaimana supaya aku bisa atur default kelompok
 * atau per titik langsung"*.
 *
 * Tombol di peta sudah ada sejak DECISIONS 537, tapi ia hanya berlaku selama
 * layar itu terbuka: berpindah halaman mengembalikannya ke bawaan. Yang diminta
 * di sini bawaannya sendiri — apa yang dilihat SEMUA orang saat peta pertama
 * kali terbuka, termasuk mandor yang tidak akan pernah menyentuh tombol itu.
 *
 * Disimpan di `AppSetting` ber-tanggal-berlaku, pola yang sama dengan sakelar
 * lain (mingguan, pengingat grup): perubahannya punya jejak waktu dan bisa
 * ditelusuri, bukan menghilang begitu diganti.
 *
 * **DEFAULT-nya BERKELOMPOK**, dan itu bukan selera. Sistem ini menuju 200+
 * lokasi di 7 provinsi; pada tampilan nasional ratusan pin yang saling menimpa
 * bukan informasi melainkan noda — yang terlihat cuma pin paling atas, dan
 * tidak ada yang tahu ada berapa di bawahnya. Yang memakai satu-per-satu adalah
 * organisasi dengan lokasi sedikit dan berjauhan; itu keadaan yang mereka tahu
 * sendiri, jadi mereka yang memutuskan.
 */

export const PETA_KELOMPOK_KEY = "peta.penanda_kelompok" as const;

/** Nilai bila setelannya belum pernah disimpan — lihat catatan di atas. */
export const PETA_KELOMPOK_DEFAULT = true;

/** Apakah penanda peta digabung jadi lingkaran berangka saat peta dibuka. */
export async function getKelompokBawaan(): Promise<boolean> {
  const row = await db.appSetting.findFirst({
    where: { key: PETA_KELOMPOK_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  if (v == null || v === "") return PETA_KELOMPOK_DEFAULT;
  return v === "1" || v.toLowerCase() === "true";
}

/** Simpan bawaan (berlaku hari ini, Asia/Jakarta). */
export async function setKelompokBawaan(aktif: boolean): Promise<void> {
  const effectiveFrom = jakartaToday();
  const value = aktif ? "1" : "0";
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: PETA_KELOMPOK_KEY, effectiveFrom } },
    update: { value },
    create: { key: PETA_KELOMPOK_KEY, value, effectiveFrom },
  });
}
