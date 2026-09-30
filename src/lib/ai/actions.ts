"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import {
  ALERT_CHAT_KEY,
  FALLBACK_KEY,
  getActiveAiConfig,
  getAiProviderConfig,
  putAiSetting,
  setActiveAiProvider,
  setAiProviderConfig,
} from "@/lib/ai/config";
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
    revalidatePath("/sistem");
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
    revalidatePath("/sistem");
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
    const detik = (ms?: number) => (ms == null ? "" : `, ${(ms / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} dtk`);
    if (result.ok) {
      return {
        success: `Koneksi ${aiProvider(id)?.label ?? id} OK – model ${result.model} membalas JSON${detik(result.latencyMs)}.`,
      };
    }
    return {
      error: `Tes ${aiProvider(id)?.label ?? id} gagal${result.errorCode ? ` (${result.errorCode}${detik(result.latencyMs)})` : ""}: ${result.error}`,
    };
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

/**
 * Pengaman AI (DECISIONS 635): provider CADANGAN dan penerima alarm.
 *
 * Cadangan kosong = mati. Mengisinya berarti data proyek (termasuk teks grup
 * WA) boleh terkirim ke vendor kedua saat provider utama gagal – karena itu
 * keputusan ini sadar dan tercatat di audit. Penerima alarm hanya GRUP WA:
 * pagar nomor pribadi (DECISIONS 433) menolak kiriman ke nomor perorangan.
 */
export async function simpanPengamanAiAction(
  _prev: AiActionState,
  formData: FormData,
): Promise<AiActionState> {
  try {
    const user = await requireCapability("system.manage");
    const rawCadangan = String(formData.get("fallbackProvider") ?? "").trim();
    const cadangan = rawCadangan === "" ? "" : providerSchema.parse(rawCadangan);
    if (cadangan) {
      const aktif = await getActiveAiConfig();
      if (aktif?.id === cadangan) return { error: "Provider cadangan harus berbeda dari provider aktif." };
      if (!(await getAiProviderConfig(cadangan))) {
        return { error: `Isi & simpan API key ${aiProvider(cadangan)?.label ?? cadangan} dulu sebelum menjadikannya cadangan.` };
      }
    }
    const rawAlarm = String(formData.get("alertChatId") ?? "").trim();
    let alarm = "";
    if (rawAlarm) {
      const { kanonikGrupId } = await import("@/lib/waha/grup-id");
      const k = kanonikGrupId(rawAlarm);
      if (!k || !k.endsWith("@g.us")) {
        return { error: "Penerima alarm harus ID grup WhatsApp (…@g.us) – nomor pribadi ditolak pagar pengiriman." };
      }
      alarm = k;
    }
    await putAiSetting(FALLBACK_KEY, cadangan);
    await putAiSetting(ALERT_CHAT_KEY, alarm);
    await audit(user.id, "system.ai_pengaman", "app_setting", null, { fallbackProvider: cadangan || null, alertChatId: alarm || null });
    revalidatePath("/sistem");
    return {
      success:
        `Pengaman AI disimpan – cadangan: ${cadangan ? (aiProvider(cadangan)?.label ?? cadangan) : "tidak ada"}; ` +
        `alarm WA: ${alarm || "tidak dikirim (spanduk & audit saja)"}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

