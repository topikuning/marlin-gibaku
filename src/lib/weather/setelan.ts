import "server-only";
import { encryptionKeyFromEnv, readStoredSecret, secretUntukSimpan } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * PILIHAN SUMBER CUACA OTOMATIS (DECISIONS baru 2026-10-07) – di layar Sistem.
 *
 * - `open-meteo`: model cuaca (perilaku lama, tetap BAWAAN supaya tidak ada
 *   yang berubah diam-diam).
 * - `satelit`: pengamatan satelit – awan Himawari-9 + hujan JAXA GSMaP.
 *
 * Isian manual dari lapangan tetap menang atas keduanya.
 */

export const SUMBER_CUACA_KEY = "cuaca.sumber";
export const SUMBER_CUACA = ["open-meteo", "satelit"] as const;
export type SumberCuaca = (typeof SUMBER_CUACA)[number];
export const SUMBER_CUACA_DEFAULT: SumberCuaca = "open-meteo";

export const LABEL_SUMBER_CUACA: Record<SumberCuaca, string> = {
  "open-meteo": "Open-Meteo (model cuaca)",
  satelit: "Satelit (awan Himawari + hujan JAXA GSMaP)",
};

export async function getSumberCuaca(): Promise<SumberCuaca> {
  const row = await db.appSetting.findFirst({
    where: { key: SUMBER_CUACA_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  return (SUMBER_CUACA as readonly string[]).includes(v ?? "") ? (v as SumberCuaca) : SUMBER_CUACA_DEFAULT;
}

export async function setSumberCuaca(sumber: SumberCuaca): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: SUMBER_CUACA_KEY, effectiveFrom } },
    update: { value: sumber },
    create: { key: SUMBER_CUACA_KEY, value: sumber, effectiveFrom },
  });
}

/**
 * AKUN FTP JAXA GSMaP – di basis data, diisi dari layar Sistem (permintaan
 * user 2026-10-07: *"masukkan aja di variable database"*). Sandinya TERSANDI
 * dengan aturan yang sama seperti kunci WAHA/AI/Google (`secretUntukSimpan`):
 * kuncinya berakhiran `.password`, jadi ikut terjaring migrasi enkripsi-ulang.
 */
export const GSMAP_USER_KEY = "cuaca.gsmap.ftp_user";
export const GSMAP_PASS_KEY = "cuaca.gsmap.password";

async function nilaiTerbaru(key: string): Promise<string> {
  const row = await db.appSetting.findFirst({
    where: { key },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  return row?.value.trim() ?? "";
}

/** Akun lengkap, atau null bila belum diisi / sandinya tidak bisa dibuka. */
export async function getAkunGsmap(): Promise<{ user: string; pass: string } | null> {
  const [user, simpan] = await Promise.all([nilaiTerbaru(GSMAP_USER_KEY), nilaiTerbaru(GSMAP_PASS_KEY)]);
  const pass = simpan ? (readStoredSecret(simpan, encryptionKeyFromEnv()) ?? "") : "";
  return user && pass ? { user, pass } : null;
}

/** Untuk layar: nama akun dan apakah sandinya tersimpan – sandinya tidak pernah dikirim. */
export async function getAkunGsmapTampil(): Promise<{ user: string; adaSandi: boolean }> {
  const [user, simpan] = await Promise.all([nilaiTerbaru(GSMAP_USER_KEY), nilaiTerbaru(GSMAP_PASS_KEY)]);
  return { user, adaSandi: simpan !== "" };
}

/** `pass` undefined = sandi lama dipertahankan; string kosong = hapus. */
export async function setAkunGsmap(input: { user: string; pass?: string }): Promise<void> {
  const effectiveFrom = jakartaToday();
  const put = (key: string, value: string) =>
    db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  // Sandi disandikan LEBIH DULU: bila kunci enkripsi tidak ada di production,
  // ia melempar sebelum apa pun tertulis.
  const pass = input.pass === undefined ? undefined : input.pass === "" ? "" : secretUntukSimpan(input.pass);
  await put(GSMAP_USER_KEY, input.user.trim());
  if (pass !== undefined) await put(GSMAP_PASS_KEY, pass);
}
