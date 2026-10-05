"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { putuskanAkunCadangan, setAktifCadangan } from "./akun";

/** Aksi layar Sistem → Cadangan ke Google Drive (DECISIONS 650). */

export type CadanganActionState = { error?: string; success?: string } | undefined;

export async function setAktifCadanganAction(_prev: CadanganActionState, formData: FormData): Promise<CadanganActionState> {
  const actor = await requireCapability("system.manage");
  const aktif = formData.get("aktif") === "on";
  await setAktifCadangan(aktif);
  await audit(actor.id, "cadangan.set_aktif", "app_setting", null, { aktif });
  revalidatePath("/sistem");
  return { success: aktif ? "Cadangan aktif. Berjalan otomatis tiap jam." : "Cadangan dijeda. Tidak ada yang dicadangkan sampai diaktifkan lagi." };
}

export async function jalankanCadanganAction(): Promise<CadanganActionState> {
  const actor = await requireCapability("system.manage");
  const { mulaiCadanganLatar } = await import("./jalankan");
  try {
    // Tombol = "cadangkan sekarang": database ikut dibuat walau cadangan hari ini sudah ada.
    const h = await mulaiCadanganLatar({ paksaDb: true });
    await audit(actor.id, "cadangan.run", "system", null, h);
    revalidatePath("/sistem");
    if (!h.dimulai && h.alasan) {
      return {
        error:
          h.alasan === "mati"
            ? "Cadangan sedang dijeda. Aktifkan dulu."
            : "Akun Google untuk cadangan belum tersambung.",
      };
    }
    if (!h.dimulai && h.berjalanSejak) {
      const jam = h.berjalanSejak.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
      return { success: `Cadangan sudah berjalan sejak ${jam}. Tidak perlu ditekan lagi.` };
    }
    return {
      success:
        "Cadangan sudah dimulai: database lebih dulu, lalu berkas. Muat ulang halaman ini beberapa menit lagi untuk melihat hasilnya.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Cadangan gagal dimulai." };
  }
}

export async function putuskanAkunCadanganAction(): Promise<CadanganActionState> {
  const actor = await requireCapability("system.manage");
  await putuskanAkunCadangan();
  await audit(actor.id, "cadangan.disconnect", "app_setting", null, {});
  revalidatePath("/sistem");
  return {
    success: "Akun Google cadangan diputus. Berkas yang sudah tersalin tetap ada di Google Drive.",
  };
}
