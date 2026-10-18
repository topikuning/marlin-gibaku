import "server-only";
import { db } from "@/lib/db";
import { encryptionKeyFromEnv, readStoredSecret, secretUntukSimpan } from "@/lib/ai/crypto";
import { jakartaToday } from "@/lib/format";
import type { AkunKawal } from "./klien";

/**
 * AKUN KAWAL KNMP di basis data (DECISIONS 689), diisi dari layar Sistem –
 * bukan lewat chat, repo, atau env. Pola sama dengan akun GSMaP
 * (`lib/weather/setelan.ts`): sandi TERSANDI lewat `secretUntukSimpan`, dan
 * kuncinya berakhiran `.password` supaya ikut terjaring migrasi enkripsi-ulang.
 */
export const KAWAL_ALAMAT_KEY = "kawal.alamat";
export const KAWAL_AKUN_KEY = "kawal.akun";
export const KAWAL_SANDI_KEY = "kawal.password";

async function nilaiTerbaru(key: string): Promise<string> {
  const row = await db.appSetting.findFirst({
    where: { key },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  return row?.value.trim() ?? "";
}

/** Akun lengkap, atau null bila belum diisi / sandinya tidak bisa dibuka. */
export async function getAkunKawal(): Promise<AkunKawal | null> {
  const [alamat, akun, simpan] = await Promise.all([
    nilaiTerbaru(KAWAL_ALAMAT_KEY),
    nilaiTerbaru(KAWAL_AKUN_KEY),
    nilaiTerbaru(KAWAL_SANDI_KEY),
  ]);
  const sandi = simpan ? (readStoredSecret(simpan, encryptionKeyFromEnv()) ?? "") : "";
  return alamat && akun && sandi ? { alamat, akun, sandi } : null;
}

/** Untuk layar: alamat, nama akun, dan apakah sandinya tersimpan – sandinya tidak pernah dikirim. */
export async function getAkunKawalTampil(): Promise<{ alamat: string; akun: string; adaSandi: boolean }> {
  const [alamat, akun, simpan] = await Promise.all([
    nilaiTerbaru(KAWAL_ALAMAT_KEY),
    nilaiTerbaru(KAWAL_AKUN_KEY),
    nilaiTerbaru(KAWAL_SANDI_KEY),
  ]);
  return { alamat, akun, adaSandi: simpan !== "" };
}

/** `sandi` undefined = sandi lama dipertahankan; string kosong = hapus. */
export async function setAkunKawal(input: { alamat: string; akun: string; sandi?: string }): Promise<void> {
  const effectiveFrom = jakartaToday();
  const put = (key: string, value: string) =>
    db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  // Sandi disandikan LEBIH DULU: bila kunci enkripsi tidak ada di production,
  // ia melempar sebelum apa pun tertulis.
  const sandi = input.sandi === undefined ? undefined : input.sandi === "" ? "" : secretUntukSimpan(input.sandi);
  await put(KAWAL_ALAMAT_KEY, input.alamat.trim());
  await put(KAWAL_AKUN_KEY, input.akun.trim());
  if (sandi !== undefined) await put(KAWAL_SANDI_KEY, sandi);
}
