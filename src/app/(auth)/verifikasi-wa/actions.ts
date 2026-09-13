"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { bacaKeadaan, konfirmasiKode, mulaiVerifikasi } from "@/lib/waha/verifikasi";
import type { KeadaanVerifikasi } from "@/lib/waha/verifikasi-aturan";
import { COOKIE_LEWATI } from "./konstanta";

/**
 * Aksi layar verifikasi nomor WhatsApp (DECISIONS 570).
 *
 * Tidak memakai `requireCapability`: yang dikerjakan di sini adalah verifikasi
 * nomor DIRI SENDIRI, dan tiap pengguna yang bisa login berhak atasnya. Yang
 * dijaga bukan perannya melainkan siapa yang diubah — seluruh fungsi di bawah
 * hanya menyentuh `user.id` dari sesi, tidak pernah id dari FormData.
 */

export type VerifikasiState =
  | { error?: string; success?: string; keadaan?: KeadaanVerifikasi }
  | undefined;

export async function mulaiVerifikasiAction(): Promise<VerifikasiState> {
  const user = await requireUser();
  await mulaiVerifikasi(user.id);
  await audit(user.id, "user.wa_verify_mulai", "user", user.id);
  return { keadaan: await bacaKeadaan(user.id) };
}

/** Dipanggil layar untuk melihat apakah pesannya sudah masuk. */
export async function bacaKeadaanAction(): Promise<VerifikasiState> {
  const user = await requireUser();
  return { keadaan: await bacaKeadaan(user.id) };
}

export async function konfirmasiKodeAction(
  _prev: VerifikasiState,
  formData: FormData,
): Promise<VerifikasiState> {
  const user = await requireUser();
  const kode = String(formData.get("kode") ?? "");
  const hasil = await konfirmasiKode(user.id, kode);
  if (!hasil.ok) return { error: hasil.pesan, keadaan: await bacaKeadaan(user.id) };
  return {
    success: hasil.nomorLama && hasil.nomorLama !== hasil.nomor
      ? `Nomor WhatsApp Anda diperbarui ke ${hasil.nomor}.`
      : `Nomor WhatsApp ${hasil.nomor} terverifikasi.`,
    keadaan: await bacaKeadaan(user.id),
  };
}

/** Lewati untuk sesi ini. Ditanyakan lagi saat login berikutnya. */
export async function lewatiVerifikasiAction(): Promise<void> {
  const user = await requireUser();
  const jar = await cookies();
  jar.set(COOKIE_LEWATI, "1", { httpOnly: true, sameSite: "lax", path: "/" });
  await audit(user.id, "user.wa_verify_lewati", "user", user.id);
  redirect("/");
}
