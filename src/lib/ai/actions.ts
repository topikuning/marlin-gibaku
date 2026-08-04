"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { setAiProviderConfig, setActiveAiProvider, getAiProviderConfig } from "@/lib/ai/config";
import { testAiProvider, listModels } from "@/lib/ai/client";
import { AI_PROVIDER_IDS, aiProvider, type AiProviderId } from "@/lib/ai/providers";

/** Konfigurasi provider AI (setting aplikasi, khusus super_admin). DECISIONS 121. */
export type AiActionState = { error?: string; success?: string; warning?: string } | undefined;

function fail(err: unknown): AiActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const providerSchema = z.enum(AI_PROVIDER_IDS as [AiProviderId, ...AiProviderId[]]);

/** Simpan API key + model satu provider. apiKey kosong = pertahankan; "-" = hapus. */
export async function saveAiProviderAction(
  _prev: AiActionState,
  formData: FormData,
): Promise<AiActionState> {
  try {
    const user = await requireCapability("system.manage");
    const id = providerSchema.parse(formData.get("provider"));
    const model = String(formData.get("model") ?? "").trim();
    const rawKey = String(formData.get("apiKey") ?? "").trim();
    // kosong = jangan ubah (undefined); "-" = hapus ("")
    const apiKey = rawKey === "" ? undefined : rawKey === "-" ? "" : rawKey;
    await setAiProviderConfig(id, { model: model || undefined, apiKey });
    await audit(user.id, "system.ai_config", "app_setting", null, { provider: id });
    revalidatePath("/administrasi/sistem");
    return { success: `Konfigurasi ${aiProvider(id)?.label ?? id} disimpan.` };
  } catch (err) {
    return fail(err);
  }
}

/** Pilih provider AI yang aktif (wajib sudah punya API key). */
export async function setActiveAiProviderAction(
  _prev: AiActionState,
  formData: FormData,
): Promise<AiActionState> {
  try {
    const user = await requireCapability("system.manage");
    const id = providerSchema.parse(formData.get("provider"));
    const cfg = await getAiProviderConfig(id);
    if (!cfg) {
      return { error: `Isi & simpan API key ${aiProvider(id)?.label ?? id} dulu sebelum menjadikannya aktif.` };
    }
    await setActiveAiProvider(id);
    await audit(user.id, "system.ai_active", "app_setting", null, { provider: id });
    revalidatePath("/administrasi/sistem");
    return { success: `Provider AI aktif: ${aiProvider(id)?.label ?? id}.` };
  } catch (err) {
    return fail(err);
  }
}

/** Tes koneksi satu provider (minimal request nyata ke provider). */
export async function testAiProviderAction(
  _prev: AiActionState,
  formData: FormData,
): Promise<AiActionState> {
  try {
    await requireCapability("system.manage");
    const id = providerSchema.parse(formData.get("provider"));
    const result = await testAiProvider(id);
    if (result.ok) {
      return {
        success: `Koneksi ${aiProvider(id)?.label ?? id} OK (model ${result.model}) — balasan: "${result.text.slice(0, 60) || "—"}".`,
      };
    }
    return { error: `Tes ${aiProvider(id)?.label ?? id} gagal: ${result.error}` };
  } catch (err) {
    return fail(err);
  }
}

/** Ambil daftar model dari endpoint /models provider (sumber otoritatif). */
export type AiModelsState = { error?: string; models?: string[] } | undefined;
export async function listAiModelsAction(
  _prev: AiModelsState,
  formData: FormData,
): Promise<AiModelsState> {
  try {
    await requireCapability("system.manage");
    const id = providerSchema.parse(formData.get("provider"));
    const result = await listModels(id);
    if (result.ok) return { models: result.models };
    return { error: `Gagal memuat model: ${result.error}` };
  } catch (err) {
    return { error: fail(err)?.error };
  }
}
