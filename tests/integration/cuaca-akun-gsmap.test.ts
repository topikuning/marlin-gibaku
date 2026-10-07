// AKUN GSMaP DI BASIS DATA (DECISIONS 655, diperbarui 2026-10-07).
//
// Permintaan user: *"masukkan aja di variable database"*. Yang dijaga: sandi
// tersimpan TERSANDI (bukan teks polos) dan ikut terjaring migrasi
// enkripsi-ulang; nama akun terbaca; sandi kosong saat menyimpan = sandi lama
// dipertahankan; menghapus mengosongkan keduanya.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.AI_SECRET_ENCRYPTION_KEY = "kunci-uji-gsmap-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { getAkunGsmap, getAkunGsmapTampil, setAkunGsmap, GSMAP_PASS_KEY, GSMAP_USER_KEY } = await import(
  "@/lib/weather/setelan"
);
const { gsmapSiap } = await import("@/lib/weather/gsmap");
const { kunciRahasia, isEncryptedSecret } = await import("@/lib/ai/crypto");

const bersih = () => db.appSetting.deleteMany({ where: { key: { in: [GSMAP_USER_KEY, GSMAP_PASS_KEY] } } });
beforeAll(bersih);
afterAll(async () => {
  await bersih();
  await db.$disconnect();
});

describe("akun GSMaP", () => {
  it("belum diisi → tidak siap", async () => {
    expect(await getAkunGsmap()).toBeNull();
    expect(await gsmapSiap()).toBe(false);
  });

  it("sandi disimpan tersandi, terbaca kembali utuh, dan kuncinya dikenali sebagai rahasia", async () => {
    await setAkunGsmap({ user: " rainmap ", pass: "Rahasia+123" });
    const baris = await db.appSetting.findFirstOrThrow({ where: { key: GSMAP_PASS_KEY } });
    expect(baris.value).not.toContain("Rahasia");
    expect(isEncryptedSecret(baris.value)).toBe(true);
    expect(kunciRahasia(GSMAP_PASS_KEY)).toBe(true);
    expect(kunciRahasia(GSMAP_USER_KEY)).toBe(false);
    expect(await getAkunGsmap()).toEqual({ user: "rainmap", pass: "Rahasia+123" });
    expect(await getAkunGsmapTampil()).toEqual({ user: "rainmap", adaSandi: true });
    expect(await gsmapSiap()).toBe(true);
  });

  it("sandi tidak diberikan → sandi lama dipertahankan", async () => {
    await setAkunGsmap({ user: "rainmap2" });
    expect(await getAkunGsmap()).toEqual({ user: "rainmap2", pass: "Rahasia+123" });
  });

  it("hapus → kosong dan tidak siap", async () => {
    await setAkunGsmap({ user: "", pass: "" });
    expect(await getAkunGsmap()).toBeNull();
    expect(await getAkunGsmapTampil()).toEqual({ user: "", adaSandi: false });
  });
});
