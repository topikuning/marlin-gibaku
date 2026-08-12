"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { kirimLaporanMingguan, pratinjauMingguan } from "./kirim";
import { setMingguanAktif } from "./setelan";

/**
 * Aksi LAPORAN PROGRES MINGGUAN → grup WhatsApp (DECISIONS 311).
 *
 * Dua jalur, satu isi: tombol manual di sini dan penjadwal di `penjadwal.ts`
 * sama-sama memanggil `kirimLaporanMingguan`, jadi teks yang dikirim orang dan
 * teks yang dikirim cron tidak pernah bisa berbeda.
 */

/**
 * Bentuknya sengaja SEMUA-OPSIONAL, bukan union bertag.
 *
 * `tahanGagalKirim` (lihat `aksi-klien.ts`) membungkus aksi ini dan harus bisa
 * mengembalikan `{ error }` sendiri saat POST-nya gagal di jalan. Union bertag
 * membuat pembungkus itu tidak bisa dipakai — dan tanpa pembungkusnya,
 * kegagalan transport akan mengganti seluruh halaman alih-alih memunculkan
 * pesan di kartu ini.
 */
export type MingguanState =
  | { error?: string; success?: string; warning?: string; info?: string; body?: string }
  | undefined;

/** Paket harus milik organisasi si pemanggil — bukan sekadar UUID yang sah. */
async function pastikanPaketSeorganisasi(packageId: string, orgId: string): Promise<string> {
  const pkg = await db.package.findFirst({
    where: { id: packageId, orgId },
    select: { name: true },
  });
  if (!pkg) throw new ForbiddenError("Paket tidak ditemukan atau di luar akses Anda.");
  return pkg.name;
}

/**
 * Susun teksnya saja, JANGAN kirim.
 *
 * Laporan resmi ke pemberi kerja tidak boleh berangkat tanpa ada yang sempat
 * membacanya lebih dulu — apalagi ke grup yang isinya PPK dan konsultan, tempat
 * pesan tidak bisa ditarik kembali.
 */
export async function pratinjauMingguanAction(
  _prev: MingguanState,
  formData: FormData,
): Promise<MingguanState> {
  const parsed = z.object({ packageId: z.uuid() }).safeParse({
    packageId: formData.get("packageId"),
  });
  if (!parsed.success) return { error: "Paket tidak valid." };

  try {
    const user = await requireCapability("ai.report_send");
    await pastikanPaketSeorganisasi(parsed.data.packageId, user.orgId);
    const hasil = await pratinjauMingguan(parsed.data.packageId);
    if ("alasan" in hasil) return { error: hasil.alasan };
    return {
      info: `Minggu ke-${hasil.mingguKe} · ${hasil.lokasi} lokasi. Periksa dulu, baru kirim.`,
      body: hasil.body,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyusun pratinjau." };
  }
}

/**
 * Kirim sekarang juga ke grup WA paket.
 *
 * `paksa: true` — tombol ini MENIMPA baris minggu berjalan alih-alih menolak.
 * Yang dijaga UNIQUE `(paket, minggu)` adalah penjadwal yang tidak boleh
 * mengumumkan minggu yang sama dua kali; orang yang menekan tombol tahu persis
 * apa yang ia lakukan, dan paling sering justru sedang mengulang kiriman yang
 * gagal (pola yang sama dengan pengingat harian, DECISIONS 207).
 */
export async function kirimMingguanAction(
  _prev: MingguanState,
  formData: FormData,
): Promise<MingguanState> {
  const parsed = z.object({ packageId: z.uuid() }).safeParse({
    packageId: formData.get("packageId"),
  });
  if (!parsed.success) return { error: "Paket tidak valid." };

  try {
    const user = await requireCapability("ai.report_send");
    const nama = await pastikanPaketSeorganisasi(parsed.data.packageId, user.orgId);
    const hasil = await kirimLaporanMingguan(parsed.data.packageId, {
      manual: true,
      paksa: true,
      sentById: user.id,
    });
    await audit(user.id, "report.weekly_wa.send", "package", parsed.data.packageId, {
      ok: hasil.ok,
      ...(hasil.ok ? { mingguKe: hasil.mingguKe, lokasi: hasil.lokasi } : { alasan: hasil.alasan }),
    });
    revalidatePath(`/paket/${parsed.data.packageId}`);
    if (!hasil.ok) return { error: hasil.alasan };
    return {
      success: `Laporan minggu ke-${hasil.mingguKe} (${hasil.lokasi} lokasi) terkirim ke grup WA paket ${nama}.`,
      body: hasil.body,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengirim." };
  }
}

/**
 * Nyalakan/matikan PENJADWAL laporan mingguan.
 *
 * Sakelar terpisah dari pengingat harian, dan yang dimatikan hanya cron —
 * tombol kirim manual di atas tetap hidup (alasan lengkap di `setelan.ts`).
 */
export async function setMingguanAktifAction(
  _prev: MingguanState,
  formData: FormData,
): Promise<MingguanState> {
  const parsed = z
    .object({ aktif: z.enum(["1", "0"]) })
    .safeParse({ aktif: formData.get("aktif") });
  if (!parsed.success) return { error: "Nilai sakelar tidak dikenal." };
  const aktif = parsed.data.aktif === "1";

  try {
    const user = await requireCapability("system.manage");
    await setMingguanAktif(aktif);
    await audit(user.id, "report.weekly_wa.toggle", "system", null, { aktif });
    revalidatePath("/sistem");
    return {
      success: aktif
        ? "Laporan mingguan otomatis DINYALAKAN. Tiap paket dikirimi pada hari terakhir minggu kontraknya sendiri."
        : "Laporan mingguan otomatis DIMATIKAN. Penjadwal tidak mengirim apa pun — tombol kirim manual di halaman paket tetap bisa dipakai.",
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan sakelar." };
  }
}
