"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";

/** Aksi basis data AHSP (DECISIONS 317). */

export type AhspActionState = { error?: string; success?: string } | undefined;

/**
 * Impor/segarkan basis AHSP dari berkas di `seed-data/`.
 *
 * Aman ditekan berulang: berkas yang isinya sama persis (sha256) tidak ditulis
 * ulang sama sekali. Berkas BARU dengan kode sumber yang sama mengganti isinya
 * utuh — dua terbitan regulasi yang tercampur menghasilkan koefisien yang tidak
 * bisa dijelaskan asalnya.
 */
export async function imporAhspAction(): Promise<AhspActionState> {
  try {
    const user = await requireCapability("system.manage");
    const { imporAhspDariSeed } = await import("./import");
    const h = await imporAhspDariSeed(user.id);
    await audit(user.id, "ahsp.import", "system", null, {
      sourceCode: h.sourceCode,
      total: h.total,
      sha256: h.fileSha256,
      takBerubah: h.takBerubah,
    });
    revalidatePath("/sistem");
    revalidatePath("/master/ahsp");

    if (h.takBerubah) {
      return {
        success: `Basis AHSP sudah mutakhir — berkasnya identik (${h.total.toLocaleString("id-ID")} analisa). Tidak ada yang ditulis ulang.`,
      };
    }
    const komponen = h.komponen.upah + h.komponen.bahan + h.komponen.alat;
    const bagian = [
      `${h.total.toLocaleString("id-ID")} analisa (${h.kanonik.toLocaleString("id-ID")} kanonik, ${h.perluVerifikasi} perlu verifikasi)`,
      `${komponen.toLocaleString("id-ID")} komponen`,
    ];
    if (h.tanpaKomponen > 0) {
      bagian.push(`${h.tanpaKomponen} analisa belum punya koefisien terstruktur (rujuk halaman sumbernya)`);
    }
    return { success: `Basis AHSP dimuat: ${bagian.join(", ")}.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengimpor AHSP." };
  }
}
