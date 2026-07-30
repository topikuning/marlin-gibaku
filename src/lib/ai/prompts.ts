import "server-only";
import { latestSettings, putAiSetting } from "@/lib/ai/config";
import {
  promptDefault,
  promptSlot,
  PROMPT_SLOTS,
  validatePromptOverride,
} from "@/lib/ai/prompt-registry";

/**
 * Pembacaan & penyimpanan override prompt (Sistem → Prompt AI, DECISIONS 180).
 *
 * Override disimpan sebagai AppSetting `ai.prompt.<key>` — effective-dated,
 * pola yang sama dengan konfigurasi AI lain, sehingga perubahan prompt punya
 * jejak waktu dan bisa ditelusuri lewat tabel setting + audit log.
 *
 * Bila belum pernah ditimpa (atau isinya kosong), teks BAWAAN dari registri
 * yang dipakai — sistem tidak pernah berjalan tanpa prompt.
 */

const PREFIX = "ai.prompt.";

export const promptSettingKey = (key: string): string => `${PREFIX}${key}`;

/** Ambil beberapa prompt sekaligus (override → bawaan). */
export async function resolvePrompts(keys: string[]): Promise<Record<string, string>> {
  const settings = await latestSettings(keys.map(promptSettingKey));
  const out: Record<string, string> = {};
  for (const key of keys) {
    const raw = settings.get(promptSettingKey(key))?.trim();
    out[key] = raw && raw.length > 0 ? raw : promptDefault(key);
  }
  return out;
}

/** Ambil SATU prompt (override → bawaan). */
export async function resolvePrompt(key: string): Promise<string> {
  return (await resolvePrompts([key]))[key];
}

export type PromptView = {
  key: string;
  group: string;
  label: string;
  description: string;
  text: string;
  isOverridden: boolean;
  defaultText: string;
  mustContain: string[];
  maxChars: number;
};

/** Seluruh slot + status override — untuk halaman pengaturan. */
export async function listPrompts(): Promise<PromptView[]> {
  const settings = await latestSettings(PROMPT_SLOTS.map((s) => promptSettingKey(s.key)));
  return PROMPT_SLOTS.map((slot) => {
    const raw = settings.get(promptSettingKey(slot.key))?.trim();
    const overridden = !!raw && raw.length > 0 && raw !== slot.default;
    return {
      key: slot.key,
      group: slot.group,
      label: slot.label,
      description: slot.description,
      text: raw && raw.length > 0 ? raw : slot.default,
      isOverridden: overridden,
      defaultText: slot.default,
      mustContain: slot.mustContain,
      maxChars: slot.maxChars,
    };
  });
}

export class PromptError extends Error {}

/** Simpan override (sudah divalidasi penjaga registri). */
export async function savePromptOverride(key: string, text: string): Promise<void> {
  if (!promptSlot(key)) throw new PromptError("Prompt tidak dikenal.");
  const problem = validatePromptOverride(key, text);
  if (problem) throw new PromptError(problem);
  await putAiSetting(promptSettingKey(key), text.trim());
}

/** Kembalikan ke teks bawaan (override dikosongkan). */
export async function resetPromptOverride(key: string): Promise<void> {
  if (!promptSlot(key)) throw new PromptError("Prompt tidak dikenal.");
  await putAiSetting(promptSettingKey(key), "");
}
