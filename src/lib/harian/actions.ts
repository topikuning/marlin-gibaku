"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireCapability, ForbiddenError } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/format";
import { isWahaConfigured } from "@/lib/waha/client";
import { kirimPengingatHarian, type RincianKirim } from "./penjadwal";

/**
 * Pemicu MANUAL pengingat harian dari halaman Sistem (DECISIONS 205/207).
 *
 * Permintaan user: "buat juga satu tombol untuk eksekusi pengingat semua orang,
 * dari admin." Alasannya nyata — penjadwal luar bisa mati, telat, atau belum
 * dipasang, dan tanpa tombol ini satu-satunya cara menagih lapangan adalah
 * menunggu besok.
 *
 * Tombol ini SENGAJA tidak dikunci sekali sehari (DECISIONS 207). Yang dicegah
 * adalah pengiriman yang tidak disengaja — lewat daftar penerima yang tampil
 * lebih dulu + konfirmasi yang menyebut berapa orang menerima pesan kedua —
 * bukan kemampuan admin mengirim ulang. Pesan pertama yang tidak sampai adalah
 * keadaan yang nyata; sistem yang menjawab "sudah dikirim hari ini" pada
 * keadaan itu memutuskan sesuatu yang bukan haknya.
 */

export type PengingatState =
  | { error?: string; success?: string; rincian?: RincianKirim[] }
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
    // `paksa` = tombol admin boleh mengirim ulang; lihat DECISIONS 207.
    const hasil = await kirimPengingatHarian(new Date(), user.orgId, { paksa: true });
    await audit(user.id, "reminder.manual_send", "system", null, {
      dateKey: jakartaDateKey(new Date()),
      terkirim: hasil.terkirim,
      gagal: hasil.gagal,
      sesi: hasil.sesi,
      // Tujuan tiap pesan ikut tercatat: pengiriman ke HP orang lain harus bisa
      // ditelusuri ke nomornya, bukan cuma jumlahnya.
      tujuan: hasil.rincian.map((r) => r.tujuan),
    });
    revalidatePath("/sistem");

    if (hasil.terkirim === 0 && hasil.gagal === 0) {
      // Sebabnya TIDAK ditebak: nol bisa berarti semua sudah lapor, bisa juga
      // belum ada lokasi berjalan yang SPMK-nya tiba.
      return { success: "Tidak ada penanggung jawab yang perlu ditagih saat ini." };
    }

    const berbukti = hasil.rincian.filter((r) => r.ok && r.waMessageId).length;
    const sesi = hasil.sesi.replace(/\.+$/, "");
    const bagian = [`${hasil.terkirim} pesan terkirim`];
    if (hasil.gagal > 0) bagian.push(`${hasil.gagal} GAGAL`);

    // Nol terkirim dengan kegagalan = kegagalan, apa pun kalimatnya. Nada hijau
    // di atas daftar yang semuanya merah adalah cara halaman berbohong.
    if (hasil.terkirim === 0) {
      return {
        error: `${bagian.join(", ")}. Sesi WhatsApp: ${sesi}.`,
        rincian: hasil.rincian,
      };
    }
    // Inti keluhan user: "gak jelas ini berhasil atau tidak". Jawabannya bukan
    // kata "sukses", melainkan ID pesan dari WhatsApp — satu-satunya bukti
    // bahwa pesannya benar-benar diterima antrean, bukan cuma diterima server.
    if (hasil.terkirim > 0 && berbukti === 0) {
      return {
        error:
          `${bagian.join(", ")} — tetapi TIDAK SATU PUN mengembalikan ID pesan. ` +
          `WAHA menerima permintaannya tanpa memberi bukti pengiriman (status sesi: ${sesi}). ` +
          "Periksa rincian di bawah dan cek sesi di tab Integrasi.",
        rincian: hasil.rincian,
      };
    }
    if (berbukti < hasil.terkirim) {
      bagian.push(`${hasil.terkirim - berbukti} tanpa ID pesan (tidak bisa dipastikan sampai)`);
    }
    return {
      success: `${bagian.join(", ")}. Sesi WhatsApp: ${sesi}.`,
      rincian: hasil.rincian,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengirim pengingat." };
  }
}
