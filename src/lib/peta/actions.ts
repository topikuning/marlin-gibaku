"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { DIR_PETA, unduhBasemap, unduhanBerjalan } from "./berkas";

export type PetaActionState = { error?: string; success?: string } | undefined;

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
  _formData: FormData,
): Promise<PetaActionState> {
  let aktor: { id: string } | null = null;
  try {
    aktor = await requireCapability("system.manage");
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }

  if (unduhanBerjalan()) return { error: "Unduhan peta dasar sedang berjalan – tunggu sampai selesai." };

  const sumber = env.PETA_SUMBER_URL?.trim() || SUMBER_BAWAAN;
  try {
    const { ukuran } = await unduhBasemap(sumber);
    await audit(aktor.id, "peta.basemap_unduh", "system", null, {
      sumber,
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
      error: `Gagal mengunduh peta dasar dari ${sumber}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
