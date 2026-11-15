"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jakartaToday } from "@/lib/format";
import { cekHubunganAngka, cekPenanggalanMinggu, petakanBentuk, type BentukData, type LaporanHubungan } from "./bentuk";
import { parseResponsKawal } from "./parser";
import {
  ambilLokasiKawal,
  bacaCookieTempel,
  KawalGalat,
  normalisasiAlamat,
  type LangkahKawal,
  type RingkasFormulir,
} from "./klien";
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
  /** Apakah parser sinkron menerima data ini – bukti sebelum sinkron pertama (DECISIONS 690). */
  parser: { diterima: boolean; masalah: string[]; catatan: string[] } | null;
  /** Pasangan angka yang nilainya sama – bukti makna field dari data (DECISIONS 690). */
  hubungan: LaporanHubungan | null;
};

export type KawalAkunState = { error?: string; success?: string; laporan?: LaporanUjiKawal } | undefined;

export async function kawalAkunAction(_prev: KawalAkunState, formData: FormData): Promise<KawalAkunState> {
  const p = z
    .object({
      aksi: z.enum(["simpan", "uji", "hapus"]),
      alamat: z.string().trim().max(300),
      akun: z.string().trim().max(150),
      sandi: z.string().max(300),
      // Cookie "ingat saya" dari peramban (DECISIONS 769).
      cookie: z.string().max(8000),
      hapusCookie: z.boolean(),
    })
    .safeParse({
      aksi: formData.get("aksi"),
      alamat: formData.get("alamat") ?? "",
      akun: formData.get("akun") ?? "",
      sandi: formData.get("sandi") ?? "",
      cookie: formData.get("cookie") ?? "",
      hapusCookie: formData.get("hapusCookie") === "1",
    });
  if (!p.success) return { error: "Isian akun Kawal tidak dikenali. Muat ulang halaman, lalu coba lagi." };
  try {
    const user = await requireCapability("system.manage");
    const { aksi } = p.data;
    if (aksi === "hapus") {
      await setAkunKawal({ alamat: "", akun: "", sandi: "", cookie: "" });
      await audit(user.id, "system.kawal_akun", "system", null, { aksi });
      revalidatePath("/sistem");
      return { success: "Akun Kawal dihapus. Sinkron berhenti sampai akun diisi lagi." };
    }

    const cookieBaru = p.data.cookie.trim() ? bacaCookieTempel(p.data.cookie) : null;
    if (p.data.cookie.trim() && !cookieBaru) {
      return { error: "Cookie tidak terbaca. Salin isi Cookie dari peramban (bentuknya nama=nilai; nama=nilai)." };
    }
    const tersimpan = await getAkunKawal();
    const akun = {
      alamat: p.data.alamat || tersimpan?.alamat || "",
      akun: p.data.akun || tersimpan?.akun || "",
      sandi: p.data.sandi || tersimpan?.sandi || "",
      cookie: p.data.hapusCookie ? null : cookieBaru || tersimpan?.cookie || null,
    };
    if (!akun.alamat || (!akun.cookie && (!akun.akun || !akun.sandi))) {
      return { error: "Isi alamat Kawal, lalu cookie peramban, atau nama akun dan sandi." };
    }
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
            parser: (() => {
              const r = parseResponsKawal(hasil.body);
              return r.ok
                ? { diterima: true, masalah: [], catatan: r.catatan }
                : { diterima: false, masalah: r.masalah, catatan: [] };
            })(),
            hubungan: cekHubunganAngka(hasil.body),
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
              ? { langkah: e.langkah, formulir: e.formulir, bentuk: null, minggu: null, parser: null, hubungan: null }
              : undefined,
        };
      }
    }

    await setAkunKawal({
      alamat: akun.alamat,
      akun: akun.akun,
      sandi: p.data.sandi ? p.data.sandi : undefined,
      cookie: p.data.hapusCookie ? "" : (cookieBaru ?? undefined),
    });
    await audit(user.id, "system.kawal_akun", "system", null, {
      aksi,
      host: new URL(akun.alamat).host,
      akun: akun.akun,
      sandiDiganti: !!p.data.sandi,
      cookieDiganti: !!cookieBaru,
      cookieDihapus: p.data.hapusCookie,
    });
    revalidatePath("/sistem");
    return { success: "Akun Kawal tersimpan. Sandi dan cookie disimpan tersandi. Tekan Uji sambungan untuk memeriksanya." };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan akun Kawal." };
  }
}
