import "server-only";

/**
 * Olah satu berkas gambar tanda tangan / stempel / logo menjadi WebP 800px dan
 * simpan di R2 (DECISIONS 328/634). SATU aturan untuk semua jalur unggah:
 * formulir "Tanda tangan & stempel" kontrak dan isian cepat penanda tangan di
 * halaman Laporan (DECISIONS 758).
 *
 * Bukan berkas `"use server"`: fungsi ini bukan aksi yang boleh dipanggil
 * peramban, melainkan bagian dari aksi yang sudah memeriksa izin.
 */

export const BERKAS_TTD_MAKS = 2 * 1024 * 1024;

export async function simpanGambarTtd(berkas: File, label: string, key: string): Promise<string | { error: string }> {
  if (berkas.size > BERKAS_TTD_MAKS) return { error: `Berkas ${label} terlalu besar. Ukuran maksimal 2 MB.` };
  if (!/^image\/(png|jpe?g|webp)$/i.test(berkas.type)) {
    return { error: `Berkas ${label} harus berupa gambar PNG, JPG, atau WebP.` };
  }
  const { isR2Configured, r2Put } = await import("@/lib/r2");
  if (!isR2Configured()) {
    return { error: "Penyimpanan berkas (R2) belum disiapkan, jadi gambar belum bisa diunggah. Hubungi admin." };
  }
  const sharp = (await import("sharp")).default;
  // 800px sisi terpanjang: cukup tajam untuk cetak A4 pada ruang ±2 cm,
  // masih ringan untuk dimuat di halaman cetak yang berisi 3 blok.
  const buf = await sharp(Buffer.from(await berkas.arrayBuffer()), { failOn: "none" })
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 92 })
    .toBuffer();
  await r2Put(key, buf, "image/webp");
  return key;
}
