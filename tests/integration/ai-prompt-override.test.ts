// PENGATURAN PROMPT AI (DECISIONS 180) — override tersimpan sebagai AppSetting
// dan benar-benar dipakai aksi AI berikutnya; frasa pengaman tidak bisa dibuang.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { db } = await import("@/lib/db");
const {
  listPrompts,
  promptSettingKey,
  PromptError,
  resetPromptOverride,
  resolvePrompt,
  savePromptOverride,
} = await import("@/lib/ai/prompts");
const { promptDefault } = await import("@/lib/ai/prompt-registry");

const KEY = "hub.system";

beforeEach(async () => {
  await db.appSetting.deleteMany({ where: { key: { startsWith: "ai.prompt." } } });
});

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { startsWith: "ai.prompt." } } });
  await db.$disconnect();
});

describe("resolvePrompt", () => {
  it("belum pernah ditimpa → teks BAWAAN (sistem tak pernah jalan tanpa prompt)", async () => {
    expect(await resolvePrompt(KEY)).toBe(promptDefault(KEY));
  });

  it("setelah disimpan → teks admin yang dipakai", async () => {
    const teks = "Anda analis MARLIN yang sangat ringkas. Anda BUKAN sumber angka.";
    await savePromptOverride(KEY, teks);
    expect(await resolvePrompt(KEY)).toBe(teks);
  });

  it("setelah dikembalikan → kembali ke bawaan", async () => {
    await savePromptOverride(KEY, "Ringkas saja. Anda BUKAN sumber angka.");
    await resetPromptOverride(KEY);
    expect(await resolvePrompt(KEY)).toBe(promptDefault(KEY));
  });

  it("override kosong di DB diperlakukan sebagai belum ditimpa", async () => {
    await db.appSetting.create({
      data: { key: promptSettingKey(KEY), value: "   ", effectiveFrom: new Date() },
    });
    expect(await resolvePrompt(KEY)).toBe(promptDefault(KEY));
  });
});

describe("penjaga simpan", () => {
  it("membuang frasa pengaman → DITOLAK, tidak ada yang tersimpan", async () => {
    await expect(savePromptOverride(KEY, "Karang saja seperlunya.")).rejects.toThrow(PromptError);
    expect(await resolvePrompt(KEY)).toBe(promptDefault(KEY));
  });

  it("kunci tidak dikenal → DITOLAK", async () => {
    await expect(savePromptOverride("tidak.ada", "apa saja")).rejects.toThrow(PromptError);
  });
});

describe("listPrompts (halaman Sistem → Prompt AI)", () => {
  it("menandai mana yang bawaan dan mana yang diubah", async () => {
    await savePromptOverride(KEY, "Sangat ringkas. Anda BUKAN sumber angka.");
    const items = await listPrompts();

    const diubah = items.find((i) => i.key === KEY)!;
    expect(diubah.isOverridden).toBe(true);
    expect(diubah.text).toMatch(/Sangat ringkas/);
    expect(diubah.defaultText).toBe(promptDefault(KEY));

    const bawaan = items.find((i) => i.key === "chat.summary")!;
    expect(bawaan.isOverridden).toBe(false);
    expect(bawaan.text).toBe(promptDefault("chat.summary"));

    // Seluruh slot tetap terdaftar walau hanya satu yang ditimpa.
    expect(items.length).toBeGreaterThanOrEqual(14);
  });

  it("teks yang PERSIS sama dengan bawaan tidak dianggap 'diubah'", async () => {
    await savePromptOverride(KEY, promptDefault(KEY));
    const item = (await listPrompts()).find((i) => i.key === KEY)!;
    expect(item.isOverridden).toBe(false);
  });
});
