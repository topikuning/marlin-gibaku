// RAHASIA TIDAK BOLEH TERSIMPAN TELANJANG DI BASIS DATA (audit 2026-08-28).
//
// Cadangan lapangan 24 Agustus 2026 memuat `ai.claude.api_key` (`sk-ant-…`),
// `waha.api_key`, dan `waha.webhook_secret` dalam bentuk terbaca, sementara
// kredensial Google di baris sebelahnya terenkripsi. Tiga penyimpan, tiga
// perilaku berbeda:
//
//   ai/config.ts     — mengenkripsi, dan MENOLAK plaintext di production;
//   gdrive/config.ts — diam-diam plaintext bila kunci tak ada;
//   waha/config.ts   — tidak pernah mengenkripsi sama sekali.
//
// Dua hal yang dijaga di sini, dan keduanya harus dijaga bersama:
//
//   1. tulisan BARU selalu terenkripsi (satu aturan, `secretUntukSimpan`);
//   2. nilai LAMA yang sudah telanjang tidak hidup selamanya — penjaga
//      penulisan tidak menyentuhnya, dan `readStoredSecret` menerimanya demi
//      kompatibilitas, jadi ia terus bekerja tanpa pernah mengeluh.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const KUNCI = "kunci-uji-rahasia-marlin-0123456789";

const { db } = await import("@/lib/db");
const { isEncryptedSecret, kunciRahasia } = await import("@/lib/ai/crypto");
const { enkripsiUlangRahasiaTelanjang } = await import("@/lib/migrasi/rahasia-terenkripsi");
const { setWahaConfig, getWahaConfig, getWahaWebhookSecret, getWahaConfigDisplay } = await import(
  "@/lib/waha/config"
);

const HARI = new Date("2026-08-28T00:00:00.000Z");

async function tulisLangsung(key: string, value: string) {
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key, effectiveFrom: HARI } },
    update: { value },
    create: { key, value, effectiveFrom: HARI },
  });
}

const baca = async (key: string) =>
  (await db.appSetting.findFirst({ where: { key }, orderBy: { effectiveFrom: "desc" } }))?.value ?? "";

afterEach(async () => {
  await db.appSetting.deleteMany({});
  delete process.env.AI_SECRET_ENCRYPTION_KEY;
});

afterAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE TABLE app_settings RESTART IDENTITY CASCADE`);
  await db.$disconnect();
});

describe("kunci mana yang dianggap rahasia", () => {
  it("berbasis pola, jadi kunci rahasia BARU ikut terjaring tanpa diingat", () => {
    for (const k of [
      "ai.claude.api_key",
      "ai.provider-yang-belum-ada.api_key",
      "waha.api_key",
      "waha.webhook_secret",
      "gdrive.client_secret",
      "gdrive.refresh_token",
    ]) {
      expect(kunciRahasia(k), k).toBe(true);
    }
    for (const k of ["waha.base_url", "brand.app_name", "ai.claude.model", "waha.debug_hits"]) {
      expect(kunciRahasia(k), k).toBe(false);
    }
  });
});

describe("WAHA menyimpan rahasianya terenkripsi", () => {
  it("REGRESI: api key & webhook secret tidak lagi telanjang di basis data", async () => {
    process.env.AI_SECRET_ENCRYPTION_KEY = KUNCI;
    await setWahaConfig({
      baseUrl: "https://waha.contoh.test",
      apiKey: "wak_RAHASIA_UJI_123",
      webhookSecret: "secret_webhook_uji_456",
    });

    // Yang tersimpan BUKAN nilai aslinya…
    const apiTersimpan = await baca("waha.api_key");
    const hookTersimpan = await baca("waha.webhook_secret");
    expect(isEncryptedSecret(apiTersimpan)).toBe(true);
    expect(isEncryptedSecret(hookTersimpan)).toBe(true);
    expect(apiTersimpan).not.toContain("wak_RAHASIA_UJI_123");
    expect(hookTersimpan).not.toContain("secret_webhook_uji_456");

    // …tetapi yang dibaca aplikasi tetap nilai aslinya.
    expect((await getWahaConfig())?.apiKey).toBe("wak_RAHASIA_UJI_123");
    expect(await getWahaWebhookSecret()).toBe("secret_webhook_uji_456");
    // Layar Sistem menampilkan secret webhook penuh — admin menyalinnya ke WAHA.
    expect((await getWahaConfigDisplay()).webhookSecret).toBe("secret_webhook_uji_456");
  });

  it("string KOSONG tetap kosong – bukan ciphertext dari string kosong", async () => {
    /*
     * Kosong berarti "hapus". Kalau ia ikut dienkripsi, hasilnya nilai tak
     * kosong yang terbaca sebagai "key masih terpasang", dan layar Sistem akan
     * mengaku terkonfigurasi padahal tidak.
     */
    process.env.AI_SECRET_ENCRYPTION_KEY = KUNCI;
    await setWahaConfig({ apiKey: "wak_ada", webhookSecret: "hook_ada" });
    await setWahaConfig({ apiKey: "", webhookSecret: "" });
    expect(await baca("waha.api_key")).toBe("");
    expect((await getWahaConfigDisplay()).hasApiKey).toBe(false);
    expect(await getWahaWebhookSecret()).toBeNull();
  });
});

describe("rahasia lama yang telanjang tidak hidup selamanya", () => {
  it("REGRESI: dienkripsi-ulang saat boot, dan nilainya tidak berubah", async () => {
    /*
     * Persis bentuk yang ditemukan di cadangan lapangan: nilai terbaca, ditulis
     * jauh sebelum penjaga penulisan ada. Penjaga itu hanya mengawasi tulisan
     * baru — tanpa migrasi ini, barisnya telanjang selamanya.
     */
    await tulisLangsung("ai.claude.api_key", "sk-ant-RAHASIA-LAMA");
    await tulisLangsung("waha.api_key", "wak_LAMA");
    await tulisLangsung("waha.webhook_secret", "hook_LAMA");
    await tulisLangsung("waha.base_url", "https://waha.contoh.test");

    process.env.AI_SECRET_ENCRYPTION_KEY = KUNCI;
    const r = await enkripsiUlangRahasiaTelanjang();
    expect(r.status).toBe("selesai");
    expect(r.status === "selesai" && r.dienkripsi).toBe(3);

    for (const k of ["ai.claude.api_key", "waha.api_key", "waha.webhook_secret"]) {
      expect(isEncryptedSecret(await baca(k)), k).toBe(true);
    }
    // Yang BUKAN rahasia tidak disentuh — mengenkripsi base URL akan mematikan WAHA.
    expect(await baca("waha.base_url")).toBe("https://waha.contoh.test");
    // Dan nilainya tetap terbaca sama seperti sebelumnya.
    expect(await getWahaWebhookSecret()).toBe("hook_LAMA");
    expect((await getWahaConfig())?.apiKey).toBe("wak_LAMA");
  });

  it("idempoten: jalan kedua tidak mengenkripsi apa pun lagi", async () => {
    process.env.AI_SECRET_ENCRYPTION_KEY = KUNCI;
    await tulisLangsung("waha.api_key", "wak_LAMA");
    await enkripsiUlangRahasiaTelanjang();
    const kedua = await enkripsiUlangRahasiaTelanjang();
    expect(kedua.status === "selesai" && kedua.dienkripsi).toBe(0);
    expect((await getWahaConfig())?.apiKey).toBeUndefined(); // baseUrl belum diisi
    expect(await baca("waha.api_key")).toMatch(/^enc:v1:/);
  });

  it("tanpa kunci: TIDAK diam – jumlah yang telanjang dilaporkan", async () => {
    /*
     * Diam adalah kegagalan terburuk di sini. Kalau migrasi ini melewat tanpa
     * bersuara, rahasia telanjang tinggal di basis data tanpa ada yang tahu.
     */
    await tulisLangsung("waha.api_key", "wak_LAMA");
    await tulisLangsung("gdrive.client_secret", "gcs_LAMA");
    const r = await enkripsiUlangRahasiaTelanjang();
    expect(r).toEqual({ status: "dilewati", alasan: "tanpa_kunci", telanjang: 2 });
  });
});
