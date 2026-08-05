"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { PromptError, resetPromptOverride, savePromptOverride } from "@/lib/ai/prompts";

/**
 * Server action pengaturan prompt AI (Sistem → Prompt AI, DECISIONS 180).
 * Kapabilitas `system.manage` — sama dengan pengaturan AI lainnya. Isi prompt
 * TIDAK ikut ditulis ke audit (bisa panjang); yang dicatat: slot mana, oleh
 * siapa, berapa karakter, dan apakah kembali ke bawaan.
 */

export type PromptState = { error?: string; success?: string } | undefined;

const saveSchema = z.object({ key: z.string().min(1), text: z.string() });

export async function savePromptAction(_prev: PromptState, formData: FormData): Promise<PromptState> {
  try {
    const user = await requireCapability("system.manage");
    const parsed = saveSchema.safeParse({ key: formData.get("key"), text: formData.get("text") ?? "" });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    await savePromptOverride(parsed.data.key, parsed.data.text);
    await audit(user.id, "ai.prompt.simpan", "app_setting", null, {
      key: parsed.data.key,
      chars: parsed.data.text.trim().length,
    });
    revalidatePath("/administrasi/sistem");
    return { success: "Prompt tersimpan. Aksi AI berikutnya memakai teks ini." };
  } catch (err) {
    if (err instanceof PromptError) return { error: err.message };
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
}

export async function resetPromptAction(_prev: PromptState, formData: FormData): Promise<PromptState> {
  try {
    const user = await requireCapability("system.manage");
    const key = z.string().min(1).safeParse(formData.get("key"));
    if (!key.success) return { error: "Prompt tidak valid." };

    await resetPromptOverride(key.data);
    await audit(user.id, "ai.prompt.reset", "app_setting", null, { key: key.data });
    revalidatePath("/administrasi/sistem");
    return { success: "Prompt dikembalikan ke teks bawaan." };
  } catch (err) {
    if (err instanceof PromptError) return { error: err.message };
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
}
