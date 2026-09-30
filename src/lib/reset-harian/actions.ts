"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { adalahAkar, parseAkar } from "@/lib/akar";
import { env } from "@/lib/env";
import { resetHarianLokasi } from "@/lib/reset-harian/service";

export type ResetHarianState = { error?: string; success?: string } | undefined;

const skema = z.object({
  locationId: z.string().uuid(),
  konfirmasi: z.string(),
});

/**
 * Reset seluruh laporan harian satu lokasi (DECISIONS 630). Tiga pagar:
 * kapabilitas super admin, SUPER ADMIN UTAMA (env), dan nama lokasi diketik
 * persis – penghapusan ini tidak bisa dibatalkan.
 */
export async function resetHarianLokasiAction(_prev: ResetHarianState, formData: FormData): Promise<ResetHarianState> {
  const user = await requireCapability("daily_report.reset_location");
  if (!adalahAkar(user, parseAkar(env.SUPER_ADMIN_UTAMA))) {
    return { error: "Hanya super admin utama yang boleh mereset laporan harian lokasi." };
  }
  const parsed = skema.safeParse({
    locationId: formData.get("locationId"),
    konfirmasi: formData.get("konfirmasi") ?? "",
  });
  if (!parsed.success) return { error: "Permintaan reset tidak valid." };

  const lokasi = await db.location.findUnique({
    where: { id: parsed.data.locationId },
    select: { id: true, name: true, slug: true },
  });
  if (!lokasi) return { error: "Lokasi tidak ditemukan." };
  await requireLocationAccess(user, lokasi.id);
  if (parsed.data.konfirmasi.trim() !== lokasi.name.trim()) {
    return { error: `Ketik nama lokasi persis "${lokasi.name}" untuk konfirmasi.` };
  }

  const hasil = await resetHarianLokasi(lokasi.id);
  await audit(user.id, "location.daily_reset", "location", lokasi.id, hasil);
  revalidatePath(`/lokasi/${lokasi.slug}`, "layout");

  const sisa =
    hasil.berkasGagal + hasil.arsipGagal > 0
      ? ` ${hasil.berkasGagal + hasil.arsipGagal} berkas gagal dihapus dari penyimpanan dan akan dibersihkan audit penyimpanan.`
      : "";
  return {
    success:
      `${hasil.laporan} laporan harian ${lokasi.name} dihapus, bersama ${hasil.fotoLaporan} foto, ` +
      `${hasil.temuan} temuan, ${hasil.verifikasi} verifikasi, dan ${hasil.kendala} kendala.` +
      sisa,
  };
}
