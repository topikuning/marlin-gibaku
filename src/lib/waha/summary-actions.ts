"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { generateChatSummary } from "./chat-summary";

/** Server action ringkasan chat grup (gate exec_report.send — SM ke atas). DECISIONS 135. */

export type ChatSummaryState = { error?: string; success?: string } | undefined;

const schema = z.object({
  packageId: z.uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
});

export async function generateChatSummaryAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("exec_report.send");
    const parsed = schema.safeParse({
      packageId: formData.get("packageId"),
      dateKey: formData.get("dateKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const r = await generateChatSummary(user, parsed.data.packageId, parsed.data.dateKey);
    if (!r.ok) return { error: r.error };
    revalidatePath("/chat-grup");
    return { success: "Ringkasan tersimpan." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
