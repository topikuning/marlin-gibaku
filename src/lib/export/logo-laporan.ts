import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { isR2Configured } from "@/lib/r2";
import { alamatBerkas, ambilBerkas } from "@/lib/penyimpanan/berkas";

/**
 * LOGO KOP LAPORAN — pemilik pekerjaan (KKP) & kontraktor pelaksana.
 *
 * Berkas acuan KKP memasang kedua logo itu di sampul; laporan yang beredar ke
 * PPK tanpa keduanya terbaca seperti cetakan internal, bukan dokumen resmi
 * kontrak (koreksi user 2026-08-06).
 *
 * Sumbernya SUDAH ADA dan tidak diduplikasi: pemilik dari branding
 * (`brand.owner_logo_key`, menu Sistem — DECISIONS 166, jadi satu basis kode
 * melayani pemberi kerja mana pun), kontraktor dari `Vendor.logoKey`.
 *
 * **Wajib dikonversi ke PNG.** Logo diunggah sebagai WebP (system/actions.ts),
 * dan penulis XLSX hanya menerima png/jpeg/gif. Tanpa konversi, logonya hilang
 * DIAM-DIAM di berkas ekspor padahal di layar tampil normal — kelas kegagalan
 * yang sama sudah pernah terjadi di jalur PDF (28 Juli 2026).
 *
 * Kegagalan apa pun (R2 mati, key basi, berkas rusak) menghasilkan `null`, tidak
 * pernah melempar: laporan tanpa logo masih berguna, laporan yang gagal terbit
 * tidak.
 */

export type LogoGambar = {
  buffer: Buffer;
  /** Ukuran piksel setelah dimuat — dipakai menjaga rasio saat ditempel. */
  width: number;
  height: number;
};

export type LogoLaporan = {
  /** Pemilik pekerjaan / pemberi tugas (kiri kop). */
  pemilik: LogoGambar | null;
  /** Kontraktor pelaksana (kanan kop). */
  kontraktor: LogoGambar | null;
  /**
   * Konsultan pengawas (`Contract.supervisorLogoKey`) – kotak tengah kop
   * "LAPORAN PROGRES MINGGUAN" (DECISIONS 671). Opsional supaya pemakai lama
   * yang hanya memasang dua logo tidak berubah.
   */
  konsultan?: LogoGambar | null;
};

export const TANPA_LOGO: LogoLaporan = { pemilik: null, kontraktor: null, konsultan: null };

/** Sisi terpanjang hasil normalisasi — cukup tajam untuk cetak, tetap ringan. */
const SISI_MAKS = 320;

async function muatSatu(key: string | null | undefined, untuk: string): Promise<LogoGambar | null> {
  if (!key || !isR2Configured()) return null;
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(await ambilBerkas(key))
      .resize({ width: SISI_MAKS, height: SISI_MAKS, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err) {
    console.error(`[export] logo ${untuk} gagal disiapkan untuk XLSX:`, err);
    return null;
  }
}

/** Muat pasangan logo kop untuk satu lokasi. Tidak pernah melempar. */
export async function muatLogoLaporan(locationId: string): Promise<LogoLaporan> {
  try {
    const [branding, loc] = await Promise.all([
      getBranding(),
      db.location.findUnique({
        where: { id: locationId },
        select: {
          package: {
            select: { contract: { select: { supervisorLogoKey: true, vendor: { select: { logoKey: true } } } } },
          },
        },
      }),
    ]);
    const [pemilik, kontraktor, konsultan] = await Promise.all([
      muatSatu(branding.ownerLogoKey, "pemilik pekerjaan"),
      muatSatu(loc?.package.contract?.vendor?.logoKey, "kontraktor"),
      muatSatu(loc?.package.contract?.supervisorLogoKey, "konsultan pengawas"),
    ]);
    return { pemilik, kontraktor, konsultan };
  } catch (err) {
    console.error("[export] pasangan logo kop gagal dimuat:", err);
    return TANPA_LOGO;
  }
}

/** Alamat tiga logo kop untuk layar (presign singkat). Tidak pernah melempar. */
export type AlamatLogoLaporan = { pemilik: string | null; konsultan: string | null; penyedia: string | null };

export async function alamatLogoLaporan(locationId: string): Promise<AlamatLogoLaporan> {
  const alamat = async (key: string | null | undefined) => {
    if (!key) return null;
    try {
      return await alamatBerkas(key, 600);
    } catch {
      return null;
    }
  };
  try {
    const [branding, loc] = await Promise.all([
      getBranding(),
      db.location.findUnique({
        where: { id: locationId },
        select: {
          package: {
            select: { contract: { select: { supervisorLogoKey: true, vendor: { select: { logoKey: true } } } } },
          },
        },
      }),
    ]);
    const c = loc?.package.contract;
    const [pemilik, konsultan, penyedia] = await Promise.all([
      alamat(branding.ownerLogoKey),
      alamat(c?.supervisorLogoKey),
      alamat(c?.vendor?.logoKey),
    ]);
    return { pemilik, konsultan, penyedia };
  } catch {
    return { pemilik: null, konsultan: null, penyedia: null };
  }
}
