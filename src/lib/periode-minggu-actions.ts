"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { WEEK_PERIOD_MODES } from "@/lib/progress-calc";
import { LABEL_MODE_MINGGU } from "@/lib/periode-minggu";
import { getModeMingguBawaan, MODE_MINGGU_BAWAAN_KEY, setModeMingguBawaan } from "@/lib/periode-minggu-setelan";

export type ModeMingguBawaanState = { ok?: string; error?: string } | undefined;

const schema = z.enum(WEEK_PERIOD_MODES, "Pilih periode minggu dari daftar.");

/** Ganti periode minggu bawaan kontrak BARU (DECISIONS 708). Kontrak yang sudah ada tidak disentuh. */
export async function ubahModeMingguBawaanAction(
  _prev: ModeMingguBawaanState,
  formData: FormData,
): Promise<ModeMingguBawaanState> {
  const actor = await requireCapability("system.manage");
  const parsed = schema.safeParse(formData.get("weekMode"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const ke = parsed.data;
  const dari = await getModeMingguBawaan();
  if (dari === ke) return { ok: `Bawaan tetap ${LABEL_MODE_MINGGU[ke]}.` };
  await setModeMingguBawaan(ke);
  await audit(actor.id, "system.mode_minggu_bawaan", "app_setting", MODE_MINGGU_BAWAAN_KEY, { dari, ke });
  revalidatePath("/sistem");
  return {
    ok: `Kontrak baru kini memakai periode ${LABEL_MODE_MINGGU[ke]}. Kontrak yang sudah ada tidak berubah – gantinya per paket di halaman kontrak.`,
  };
}
