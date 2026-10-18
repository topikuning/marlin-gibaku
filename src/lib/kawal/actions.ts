"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jakartaToday } from "@/lib/format";
import { cekPenanggalanMinggu, petakanBentuk, type BentukData } from "./bentuk";
import { ambilLokasiKawal, KawalGalat, normalisasiAlamat, type LangkahKawal, type RingkasFormulir } from "./klien";
import { getAkunKawal, setAkunKawal } from "./setelan";

/**
 * Aksi layar Sistem untuk Kawal KNMP (DECISIONS 689): simpan / uji / hapus
 * akun. "Uji" masuk ke Kawal dan mengambil data lokasi SEKALI, lalu hanya
 * melaporkan BENTUKNYA (nama field, tipe, hitungan) – tidak ada data Kawal yang
 * disimpan atau ditampilkan nilainya. Sandi tidak pernah masuk catatan audit.
 */

export type LaporanUjiKawal = {
  langkah: LangkahKawal[];
  formulir: RingkasFormulir | null;
  bentuk: BentukData | null;
  minggu: ReturnType<typeof cekPenanggalanMinggu> | null;
};

export type KawalAkunState = { error?: string; success?: string; laporan?: LaporanUjiKawal } | undefined;

export async function kawalAkunAction(_prev: KawalAkunState, formData: FormData): Promise<KawalAkunState> {
  const p = z
    .object({
      aksi: z.enum(["simpan", "uji", "hapus"]),
      alamat: z.string().trim().max(300),
      akun: z.string().trim().max(150),
      sandi: z.string().max(300),
    })
    .safeParse({
      aksi: formData.get("aksi"),
      alamat: formData.get("alamat") ?? "",
      akun: formData.get("akun") ?? "",
      sandi: formData.get("sandi") ?? "",
    });
  if (!p.success) return { error: "Isian akun Kawal tidak dikenali. Muat ulang halaman, lalu coba lagi." };
  try {
    const user = await requireCapability("system.manage");
    const { aksi } = p.data;
    if (aksi === "hapus") {
      await setAkunKawal({ alamat: "", akun: "", sandi: "" });
      await audit(user.id, "system.kawal_akun", "system", null, { aksi });
      revalidatePath("/sistem");
      return { success: "Akun Kawal dihapus. Sinkron berhenti sampai akun diisi lagi." };
    }

    const tersimpan = await getAkunKawal();
    const akun = {
      alamat: p.data.alamat || tersimpan?.alamat || "",
      akun: p.data.akun || tersimpan?.akun || "",
      sandi: p.data.sandi || tersimpan?.sandi || "",
    };
    if (!akun.alamat || !akun.akun || !akun.sandi) return { error: "Isi alamat Kawal, nama akun, dan sandi dulu." };
    try {
      akun.alamat = normalisasiAlamat(akun.alamat);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Alamat Kawal tidak sah." };
    }

    if (aksi === "uji") {
      try {
        const hasil = await ambilLokasiKawal(akun);
        const bentuk = petakanBentuk(hasil.body);
        await audit(user.id, "system.kawal_uji", "system", null, {
          berhasil: true,
          host: new URL(akun.alamat).host,
          jumlahBaris: bentuk.jumlahBaris,
        });
        return {
          success:
            bentuk.jumlahBaris == null
              ? "Berhasil masuk ke Kawal, tapi bentuk datanya tidak seperti yang diharapkan (tidak ada daftar `data`). Lihat rinciannya di bawah."
              : `Berhasil masuk ke Kawal dan menerima ${bentuk.jumlahBaris} baris lokasi. Tidak ada data yang disimpan.`,
          laporan: {
            langkah: hasil.langkah,
            formulir: hasil.formulir,
            bentuk,
            minggu: cekPenanggalanMinggu(hasil.body, jakartaToday()),
          },
        };
      } catch (e) {
        await audit(user.id, "system.kawal_uji", "system", null, {
          berhasil: false,
          host: new URL(akun.alamat).host,
        });
        const pesan = e instanceof Error ? e.message : String(e);
        return {
          error: `Uji sambungan Kawal gagal: ${pesan}`,
          laporan:
            e instanceof KawalGalat
              ? { langkah: e.langkah, formulir: e.formulir, bentuk: null, minggu: null }
              : undefined,
        };
      }
    }

    await setAkunKawal({ alamat: akun.alamat, akun: akun.akun, sandi: p.data.sandi ? p.data.sandi : undefined });
    await audit(user.id, "system.kawal_akun", "system", null, {
      aksi,
      host: new URL(akun.alamat).host,
      akun: akun.akun,
      sandiDiganti: !!p.data.sandi,
    });
    revalidatePath("/sistem");
    return { success: "Akun Kawal tersimpan. Sandinya disimpan tersandi. Tekan Uji sambungan untuk memeriksanya." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan akun Kawal." };
  }
}
