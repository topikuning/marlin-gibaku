"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, accessibleLocationIds, requireCapability } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";

/**
 * Kurasi relevansi pesan chat grup (2026-08-24): reviewer bisa MENIMPA
 * klasifikasi otomatis per pesan — "Tandai relevan" / "Abaikan" / kembali ke
 * otomatis. Timpaan disimpan di `WaMessage.relevanceOverride` dan dipakai SATU
 * aturan yang sama oleh layar, KPI, dan generator ringkasan (lihat
 * `ChatMessageView.dipakai`), sehingga janji di kaki halaman — hanya pesan
 * relevan yang diringkas — selalu benar.
 */

export type RelevansiState = { error?: string; success?: string } | undefined;

const schema = z.object({
  packageId: z.uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  aksi: z.enum(["relevan", "diabaikan", "reset"]),
  ids: z.array(z.uuid()).min(1, "Pilih minimal satu pesan").max(500),
});

const AKSI_LABEL = { relevan: "ditandai relevan", diabaikan: "diabaikan", reset: "dikembalikan ke klasifikasi otomatis" } as const;

export async function setMessageRelevanceAction(
  _prev: RelevansiState,
  formData: FormData,
): Promise<RelevansiState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = schema.safeParse({
      packageId: formData.get("packageId"),
      dateKey: formData.get("dateKey"),
      aksi: formData.get("aksi"),
      ids: formData.getAll("ids").map(String),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { packageId, dateKey, aksi, ids } = parsed.data;

    // Hanya pesan milik paket dalam scope user yang boleh disentuh.
    const scope = packageScopeWhere(user, await accessibleLocationIds(user));
    const owned = await db.waMessage.findMany({
      where: { id: { in: ids }, packageId, package: scope },
      select: { id: true },
    });
    if (owned.length === 0) return { error: "Pesan tidak ditemukan dalam scope Anda." };

    await db.waMessage.updateMany({
      where: { id: { in: owned.map((m) => m.id) } },
      data: { relevanceOverride: aksi === "reset" ? null : aksi },
    });
    await audit(user.id, "wa.chat_relevansi", "package", packageId, {
      dateKey,
      aksi,
      jumlah: owned.length,
    });
    revalidatePath("/chat-grup");
    return { success: `${owned.length} pesan ${AKSI_LABEL[aksi]}.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
