"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCapability, ForbiddenError } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/format";
import { isWahaConfigured } from "@/lib/waha/client";
import { kirimPengingatHarian, type RincianKirim } from "./penjadwal";
import { setPengingatAktif } from "./setelan";

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
          "WhatsApp (WAHA) belum dikonfigurasi – tidak ada yang bisa dikirim. Isi dulu di tab Integrasi.",
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
      // Dulu di sini selalu kalimat HIJAU "tidak ada yang perlu ditagih" —
      // dan itulah keluhan user: "aku sudah klik, dinyatakan berhasil, tapi
      // tidak ada wa yang terkirim". Nol pesan punya DUA arti yang berlawanan:
      //   (a) semua lokasi sudah melapor → memang sehat;
      //   (b) ada yang belum melapor tapi tak satu pun penanggung jawabnya
      //       punya nomor WA → SALAH KONFIGURASI, dan hijau menyembunyikannya.
      // Sebabnya tetap tidak ditebak; yang disebut adalah ANGKA-ANGKANYA —
      // jumlah lokasi, penugasan, dan orang tanpa nomor semuanya fakta.
      const { sebabTidakAdaPenerima } = await import("./penjadwal");
      const sebab = hasil.diagnosa ? sebabTidakAdaPenerima(hasil.diagnosa) : null;
      if (sebab) return { error: `Tidak ada pesan terkirim. ${sebab}` };
      const d = hasil.diagnosa;
      return {
        success:
          d && d.lokasiSudahLapor > 0
            ? `Tidak ada yang perlu ditagih – ${d.lokasiSudahLapor} dari ${d.lokasiDalamLingkup} lokasi sudah melapor hari ini.`
            : "Tidak ada penanggung jawab yang perlu ditagih saat ini.",
      };
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
    // Inti keluhan user: "gak jelas ini berhasil atau tidak". ID pesan dari
    // WAHA memang lebih baik daripada kata "sukses" — tapi ia BUKAN bukti
    // sampai.
    //
    // Dibuktikan salah oleh log server user 2026-08-02: WAHA mengembalikan
    // msgId 3EB052C20C9F6C2394177D, lalu mesinnya menolak sendiri —
    // `error 463: account restricted or missing tctoken for contact`, yaitu
    // WhatsApp memblokir nomor pengirim untuk menghubungi nomor BARU. ID sudah
    // terbit, pesan tidak pernah berangkat, dan halaman menyatakan berhasil.
    // Karena itu kalimatnya sekarang menyebut batas pengetahuannya sendiri.
    // DECISIONS 222.
    if (hasil.terkirim > 0 && berbukti === 0) {
      return {
        error:
          `${bagian.join(", ")} – tetapi TIDAK SATU PUN mengembalikan ID pesan. ` +
          `WAHA menerima permintaannya tanpa memberi bukti pengiriman (status sesi: ${sesi}). ` +
          "Periksa rincian di bawah dan cek sesi di tab Integrasi.",
        rincian: hasil.rincian,
      };
    }
    if (berbukti < hasil.terkirim) {
      bagian.push(`${hasil.terkirim - berbukti} tanpa ID pesan (tidak bisa dipastikan sampai)`);
    }
    return {
      success:
        `${bagian.join(", ")}. Sesi WhatsApp: ${sesi}. ` +
        "Angka ini berarti WAHA MENERIMA permintaannya – bukan jaminan pesannya sampai. " +
        "Kalau penerima melapor tidak menerima apa pun, periksa log server WAHA: " +
        "penolakan seperti error 463 (nomor pengirim dibatasi WhatsApp untuk menghubungi nomor baru) " +
        "terjadi SESUDAH ID pesan terbit dan tidak terlihat dari sini.",
      rincian: hasil.rincian,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengirim pengingat." };
  }
}

/* ── Sakelar pengingat otomatis (DECISIONS 260) ──────────────────────────── */

/**
 * Nyalakan/matikan PENJADWAL pengingat harian.
 *
 * Yang dimatikan hanya cron. Tombol manual — massal maupun per orang — tetap
 * hidup, dan aktivasi SPMK jatuh tempo juga tetap jalan (lihat `setelan.ts`).
 */
export async function setPengingatAktifAction(
  _prev: PengingatState,
  formData: FormData,
): Promise<PengingatState> {
  const parsed = z
    .object({ aktif: z.enum(["1", "0"]) })
    .safeParse({ aktif: formData.get("aktif") });
  if (!parsed.success) return { error: "Nilai sakelar tidak dikenal." };
  const aktif = parsed.data.aktif === "1";

  try {
    const user = await requireCapability("system.manage");
    await setPengingatAktif(aktif);
    await audit(user.id, "reminder.toggle", "system", null, { aktif });
    revalidatePath("/sistem");
    return {
      success: aktif
        ? "Pengingat harian otomatis DINYALAKAN. Penjadwal akan menagih lagi pada putaran berikutnya."
        : "Pengingat harian otomatis DIMATIKAN. Penjadwal tidak akan mengirim apa pun – tombol kirim manual di halaman ini tetap bisa dipakai.",
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan sakelar." };
  }
}

/* ── Sakelar pengingat harian ke GRUP paket (ketetapan user 2026-08-29) ──── */

/**
 * Nyalakan/matikan pengingat harian yang masuk ke GRUP WhatsApp paket.
 *
 * Terpisah dari sakelar pengingat perorangan: yang membaca pesan ini PPK dan
 * konsultan pengawas, bukan orang lapangan (alasan lengkap di `setelan-grup.ts`).
 */
export async function setPengingatGrupAktifAction(
  _prev: PengingatState,
  formData: FormData,
): Promise<PengingatState> {
  const parsed = z
    .object({ aktif: z.enum(["1", "0"]) })
    .safeParse({ aktif: formData.get("aktif") });
  if (!parsed.success) return { error: "Nilai sakelar tidak dikenal." };
  const aktif = parsed.data.aktif === "1";

  try {
    const user = await requireCapability("system.manage");
    const { setPengingatGrupAktif } = await import("./setelan-grup");
    await setPengingatGrupAktif(aktif);
    await audit(user.id, "reminder.group.toggle", "system", null, { aktif });
    revalidatePath("/sistem");
    return {
      success: aktif
        ? "Pengingat harian ke grup DINYALAKAN. Mulai putaran sore berikutnya, tiap paket yang laporannya belum lengkap ditagih di grupnya – berjeda satu menit antar grup."
        : "Pengingat harian ke grup DIMATIKAN. Tidak ada pesan yang dikirim ke grup mana pun.",
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan sakelar." };
  }
}

/* ── Pengingat manual PER ORANG (permintaan user 2026-08-05) ─────────────── */

/**
 * Kirim pengingat ke SATU orang.
 *
 * Alasannya nyata: yang gagal biasanya satu-dua orang, bukan semuanya. Tanpa
 * ini, menagih ulang satu mandor berarti mengirim pesan kedua ke semua orang
 * yang sudah menerima — dan pengingat yang datang berkali-kali tanpa sebab
 * akan berhenti dibaca.
 *
 * Memakai mesin yang SAMA dengan pengiriman massal (`kirimPengingatHarian`
 * dengan filter `userIds`), jadi isi pesan dan aturan "yang sudah lapor tidak
 * ditagih" tidak bisa menyimpang antara dua tombol.
 */
export async function kirimPengingatSatuOrangAction(
  _prev: PengingatState,
  formData: FormData,
): Promise<PengingatState> {
  const parsed = z
    .object({ userId: z.string().uuid("Pengguna tidak dikenal.") })
    .safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { userId } = parsed.data;

  try {
    const user = await requireCapability("system.manage");
    if (!(await isWahaConfigured())) {
      return {
        error:
          "WhatsApp (WAHA) belum dikonfigurasi – tidak ada yang bisa dikirim. Isi dulu di tab Integrasi.",
      };
    }

    // `orgId` si admin tetap dipasang: tanpa itu, sebuah userId dari organisasi
    // lain yang dikirim langsung ke endpoint ini akan lolos. Penyaringan
    // per-orang di dalam `kirimPengingatHarian` bekerja pada daftar yang SUDAH
    // ter-scope, jadi userId asing menghasilkan daftar kosong, bukan kiriman.
    const hasil = await kirimPengingatHarian(new Date(), user.orgId, {
      paksa: true,
      userIds: [userId],
    });
    await audit(user.id, "reminder.manual_send_one", "user", userId, {
      dateKey: jakartaDateKey(new Date()),
      terkirim: hasil.terkirim,
      gagal: hasil.gagal,
      sesi: hasil.sesi,
      tujuan: hasil.rincian.map((r) => r.tujuan),
    });
    revalidatePath("/sistem");

    const r = hasil.rincian[0];
    if (!r) {
      // Daftar kosong = orang ini memang tidak perlu ditagih sekarang (sudah
      // melapor, tidak punya lokasi tertagih, atau bukan organisasi ini).
      // Tidak menebak yang mana — tapi juga tidak menyatakan "terkirim".
      return {
        error:
          "Tidak ada yang dikirim – orang ini sedang tidak masuk daftar tagihan hari ini. " +
          "Muat ulang halaman untuk melihat daftar terbaru.",
      };
    }
    if (!r.ok) {
      return { error: `Gagal mengirim ke ${r.nama} (${r.tujuan}): ${r.error ?? "sebab tidak diketahui."}`, rincian: hasil.rincian };
    }
    if (!r.waMessageId) {
      // Sama seperti versi massal: 2xx tanpa ID pesan BUKAN bukti sampai.
      return {
        error:
          `Permintaan ke ${r.nama} (${r.tujuan}) diterima WAHA tetapi TANPA ID pesan – ` +
          `tidak bisa dipastikan sampai. Sesi WhatsApp: ${hasil.sesi.replace(/\.+$/, "")}.`,
        rincian: hasil.rincian,
      };
    }
    return {
      success:
        `Pengingat terkirim ke ${r.nama} (${r.tujuan}) dengan ID pesan. ` +
        "Ini berarti WAHA menerima permintaannya – bukan jaminan pesannya sampai.",
      rincian: hasil.rincian,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengirim pengingat." };
  }
}
