"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { DIR_PETA, unduhBasemap, unduhanBerjalan } from "./berkas";
import { setKelompokBawaan } from "./setelan";

export type PetaActionState = { error?: string; success?: string } | undefined;

/**
 * Atur bawaan penanda peta: berkelompok atau satu per satu.
 *
 * Permintaan user 2026-09-06: *"bagaimana supaya aku bisa atur default kelompok
 * atau per titik langsung"*. Tombol di peta hanya berlaku selama layar itu
 * terbuka; ini yang menentukan apa yang dilihat semua orang saat peta dibuka —
 * termasuk mandor yang tidak akan pernah menyentuh tombol itu.
 */
export async function setKelompokPetaAction(
  _prev: PetaActionState,
  formData: FormData,
): Promise<PetaActionState> {
  let aktor: { id: string } | null = null;
  try {
    aktor = await requireCapability("system.manage");
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }

  const aktif = String(formData.get("kelompok") ?? "") === "1";
  await setKelompokBawaan(aktif);
  await audit(aktor.id, "peta.kelompok_bawaan", "system", null, { aktif });
  revalidatePath("/sistem");
  revalidatePath("/peta");
  revalidatePath("/aktivitas");
  revalidatePath("/");
  return {
    success: aktif
      ? "Penanda peta digabung jadi lingkaran berangka saat peta dibuka."
      : "Penanda peta digambar satu per satu saat peta dibuka.",
  };
}

/**
 * Sumber bawaan berkas peta dasar: ekstrak Indonesia yang dibangun CI dan
 * ditempelkan ke rilis GitHub repo ini. Satu berkas untuk SEMUA lingkungan —
 * yang berbeda antar-lingkungan cuma volumenya, dan itu urusan masing-masing.
 * Bisa ditimpa `PETA_SUMBER_URL` (mis. cermin internal KKP).
 */
const SUMBER_BAWAAN =
  "https://github.com/topikuning/marlin-gibaku/releases/download/peta-basemap/basemap-indonesia.pmtiles";

/**
 * Unduh peta dasar ke volume lingkungan INI — super admin saja.
 *
 * Kenapa tombol, bukan otomatis saat boot: berkasnya ratusan MB. Unduhan
 * sebesar itu di setiap boot akan memperlambat tiap deploy dan mengulang
 * pekerjaan yang hasilnya sudah duduk di volume. Ditekan sekali, lalu selesai.
 *
 * Kenapa di aplikasi, bukan di CI: R2 — dan volume — dev dan produksi berbeda.
 * Yang tahu volume mana yang perlu diisi adalah aplikasi yang berjalan di
 * atasnya (teguran user 2026-09-06).
 */
export async function unduhPetaDasarAction(
  _prev: PetaActionState,
  formData: FormData,
): Promise<PetaActionState> {
  let aktor: { id: string } | null = null;
  try {
    aktor = await requireCapability("system.manage");
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }

  if (unduhanBerjalan()) return { error: "Unduhan peta dasar sedang berjalan – tunggu sampai selesai." };

  /*
   * SUMBERNYA BISA DIISI DI LAYAR — teguran user 2026-09-06: *"kalau itu harus
   * ada di main, bagaimana aku bisa test dulu!"*
   *
   * Rancangan pertama mematok sumbernya ke rilis GitHub yang hanya bisa
   * dibangun dari branch default. Artinya tidak ada satu pun cara mencoba peta
   * di dev sebelum merilis ke produksi — urutan yang terbalik: yang belum
   * teruji justru harus mendarat lebih dulu di tempat yang paling tidak boleh
   * rusak. Sekarang alamatnya boleh diketik: cermin internal, berkas sementara,
   * apa pun yang bisa diambil server ini.
   */
  const diketik = String(formData.get("sumber") ?? "").trim();
  if (diketik && !/^https:\/\//i.test(diketik))
    return { error: "Alamat sumber harus https:// – berkas peta tidak diambil lewat sambungan terbuka." };
  const sumber = diketik || env.PETA_SUMBER_URL?.trim() || SUMBER_BAWAAN;
  try {
    const { ukuran } = await unduhBasemap(sumber);
    await audit(aktor.id, "peta.basemap_unduh", "system", null, {
      sumber,
      diketikDiLayar: Boolean(diketik),
      ukuran,
      dir: DIR_PETA,
    });
    revalidatePath("/sistem");
    revalidatePath("/peta");
    return {
      success: `Peta dasar terpasang (${Math.round((ukuran / 1024 / 1024) * 10) / 10} MB) di ${DIR_PETA}. Buka /peta untuk melihatnya.`,
    };
  } catch (e) {
    // Sebabnya disebut apa adanya: unduhan yang gagal tanpa alasan memaksa
    // orang menebak antara salah URL, volume penuh, dan jaringan.
    return {
      error: `Gagal mengunduh peta dasar – ${e instanceof Error ? e.message : String(e)} (sumber: ${sumber})`,
    };
  }
}
