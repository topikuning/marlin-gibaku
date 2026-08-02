"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireCapability, ForbiddenError } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/format";
import { isWahaConfigured } from "@/lib/waha/client";
import { kirimPengingatHarian } from "./penjadwal";

/**
 * Pemicu MANUAL pengingat harian dari halaman Sistem (DECISIONS 205).
 *
 * Permintaan user: "buat juga satu tombol untuk eksekusi pengingat semua orang,
 * dari admin." Alasannya nyata — penjadwal luar bisa mati, telat, atau belum
 * dipasang, dan tanpa tombol ini satu-satunya cara menagih lapangan adalah
 * menunggu besok.
 *
 * Perilakunya PERSIS sama dengan yang dijalankan cron (fungsi yang sama), jadi
 * hasil manual dan hasil terjadwal tidak mungkin berbeda. Termasuk pengaman
 * `UNIQUE (user_id, date_key)`: menekan tombol dua kali di hari yang sama TIDAK
 * mengirim pesan kedua ke HP orang lapangan.
 */

export type PengingatState =
  | { error?: string; success?: string }
  | undefined;

export async function kirimPengingatSekarangAction(
  _prev: PengingatState,
  _formData: FormData,
): Promise<PengingatState> {
  try {
    // Mengirim WA ke banyak orang sekaligus = tindakan keluar yang tak bisa
    // ditarik. Dikunci ke pengelola sistem, bukan sekadar "yang bisa lihat".
    const user = await requireCapability("system.manage");
    if (!(await isWahaConfigured())) {
      return {
        error:
          "WhatsApp (WAHA) belum dikonfigurasi — tidak ada yang bisa dikirim. Isi dulu di tab Integrasi.",
      };
    }

    // Ter-scope ke organisasi si admin — lihat catatan di kumpulkanPengingat.
    const hasil = await kirimPengingatHarian(new Date(), user.orgId);
    await audit(user.id, "reminder.manual_send", "system", null, {
      dateKey: jakartaDateKey(new Date()),
      ...hasil,
    });
    revalidatePath("/sistem");

    // Sesi mati = tidak ada yang keluar. Katakan status aslinya, jangan
    // membiarkan "0 terkirim" terbaca sebagai "tidak ada yang perlu ditagih".
    if (hasil.sesi !== "WORKING") {
      return {
        error:
          `Tidak ada pesan yang dikirim — sesi WhatsApp tidak siap (status: ${hasil.sesi}). ` +
          "Scan QR di server WAHA, lalu cek status di tab Integrasi dan ulangi.",
      };
    }
    if (hasil.terkirim === 0 && hasil.gagal === 0 && hasil.dilewati === 0) {
      // Sebabnya TIDAK ditebak: nol bisa berarti semua sudah lapor, bisa juga
      // belum ada lokasi berjalan yang SPMK-nya tiba. Sama seperti bannernya
      // di panel — satu layar tidak boleh menyebut dua sebab yang berbeda.
      return { success: "Tidak ada penanggung jawab yang perlu ditagih saat ini." };
    }
    const bagian = [`${hasil.terkirim} pesan terkirim`];
    // "Dilewati" DISEBUT, bukan disembunyikan: tanpa ini, admin yang menekan
    // tombol dua kali akan mengira pengirimannya gagal.
    if (hasil.dilewati > 0) bagian.push(`${hasil.dilewati} dilewati karena sudah dikirim hari ini`);
    if (hasil.gagal > 0) bagian.push(`${hasil.gagal} GAGAL dikirim`);
    return { success: `${bagian.join(", ")}.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengirim pengingat." };
  }
}
