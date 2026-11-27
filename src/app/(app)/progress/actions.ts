"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { accessibleLocationIds, ForbiddenError, requireCapability } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { samakanKurvaDenganRab } from "@/lib/baseline";

export type SamakanKurvaState =
  | {
      error?: string;
      success?: string;
      /** Lokasi yang jadwal per pekerjaannya disusun ulang. */
      disamakan?: { nama: string; baselineNo: number; keluar: string[]; masuk: string[] }[];
      gagal?: { nama: string; alasan: string }[];
    }
  | undefined;

/**
 * SAMAKAN KURVA-S SEMUA LOKASI DENGAN RAB AKTIF – sekali klik (DECISIONS 797).
 *
 * Per lokasi sama persis dengan "Simpan kurva manual" tanpa mengubah satu
 * titik kurva pun (`samakanKurvaDenganRab`). Lokasi yang sudah sesuai
 * dilewati tanpa baseline baru. Hanya lokasi yang boleh diakses pemanggilnya,
 * dengan kewenangan yang sama dengan menyunting kurva satu lokasi.
 */
export async function samakanKurvaSemuaLokasiAction(_prev: SamakanKurvaState): Promise<SamakanKurvaState> {
  try {
    const user = await requireCapability("baseline.manage");
    const locIds = await accessibleLocationIds(user);
    const lokasi = await db.location.findMany({
      // SEMUA lokasi, termasuk yang belum/tidak aktif: kurva-S dan laporannya
      // tetap bisa dibuka, dan "seluruh lokasi" berarti seluruhnya. Lokasi tanpa
      // kurva-S cukup dihitung.
      where: locationScopeWhere(user, locIds),
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });

    const disamakan: NonNullable<NonNullable<SamakanKurvaState>["disamakan"]> = [];
    const gagal: NonNullable<NonNullable<SamakanKurvaState>["gagal"]> = [];
    let sesuai = 0;
    let tanpaKurva = 0;
    // Berurutan, bukan serentak: tiap lokasi satu transaksi kecil, dan 200+
    // lokasi serentak menghabiskan kolam koneksi basis data.
    for (const l of lokasi) {
      try {
        const h = await samakanKurvaDenganRab(l.id, user.id);
        if (h.status === "disamakan") {
          disamakan.push({ nama: l.name, baselineNo: h.baselineNo, keluar: h.keluar, masuk: h.masuk });
          revalidatePath(`/lokasi/${l.slug}`, "layout");
        } else if (h.status === "gagal") gagal.push({ nama: l.name, alasan: h.alasan });
        else if (h.status === "sesuai") sesuai++;
        else tanpaKurva++;
      } catch (e) {
        gagal.push({ nama: l.name, alasan: e instanceof Error ? e.message : "Galat tak dikenal." });
      }
    }
    await audit(user.id, "baseline.samakan_rab_semua", "location", null, {
      jumlahLokasi: lokasi.length,
      disamakan: disamakan.map((d) => d.nama),
      sesuai,
      tanpaKurva,
      gagal,
    });
    revalidatePath("/progress");

    const bagian = [
      disamakan.length > 0
        ? `${disamakan.length} lokasi disamakan dengan RAB aktifnya`
        : "Tidak ada lokasi yang perlu disamakan",
      `${sesuai} lokasi sudah sesuai dan tidak diubah`,
      tanpaKurva > 0 ? `${tanpaKurva} lokasi belum punya kurva-S atau jadwal per pekerjaan` : "",
      gagal.length > 0 ? `${gagal.length} lokasi gagal` : "",
    ].filter(Boolean);
    return {
      success: `${bagian.join(", ")}. Titik kurva-S rencana tidak berubah.`,
      disamakan,
      gagal,
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "Anda tidak punya izin menyusun kurva-S." };
    return { error: e instanceof Error ? e.message : "Gagal menyamakan kurva-S." };
  }
}
