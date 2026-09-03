"use client";

/**
 * MENGECILKAN FOTO DI PERAMBAN — bagian yang menyentuh canvas.
 *
 * Keputusannya (sasaran ukuran, sisi terpanjang, tangga mutu) ada di modul
 * murni `lib/photo-kecilkan.ts` supaya bisa diuji tanpa peramban. Di sini
 * hanya pekerjaan menggambar ulang pikselnya.
 *
 * Dijalankan HANYA setelah orangnya menekan tombol (permintaan user
 * 2026-09-03). Foto itu bukti; mengubahnya tanpa diminta bukan hak program.
 */

import {
  SASARAN_KECIL_BYTE,
  TANGGA_MUTU,
  hasilnyaCukup,
  namaHasil,
  ukuranHasil,
} from "@/lib/photo-kecilkan";

export class KecilkanGagal extends Error {}

/**
 * Kecilkan satu foto. Melempar `KecilkanGagal` dengan sebab yang bisa dibaca
 * orang — bukan `undefined` yang berakhir sebagai layar diam.
 *
 * Kegagalan yang WAJAR dan harus terbaca apa adanya:
 *  - HEIC/HEIF yang tidak bisa dibaca peramban (lazim di iPhone lama);
 *  - foto yang setelah dikecilkan pun masih di atas sasaran (jarang, tapi ada
 *    pada panorama raksasa) — lebih baik dikatakan daripada mengirim berkas
 *    yang tetap akan ditolak.
 */
export async function kecilkanFoto(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new KecilkanGagal(
      "Peramban ini tidak bisa membuka format fotonya (sering terjadi pada HEIC dari iPhone). " +
        "Potret ulang dengan format JPG, atau kirim lewat WhatsApp.",
    );
  }

  try {
    const { lebar, tinggi } = ukuranHasil(bitmap.width, bitmap.height);
    const kanvas = document.createElement("canvas");
    kanvas.width = lebar;
    kanvas.height = tinggi;
    const ctx = kanvas.getContext("2d");
    if (!ctx) throw new KecilkanGagal("Peramban ini tidak menyediakan kanvas gambar.");
    ctx.drawImage(bitmap, 0, 0, lebar, tinggi);

    // Tangga mutu: berhenti pada percobaan PERTAMA yang cukup, supaya foto
    // tidak dirusak lebih dari yang perlu.
    let terbaik: Blob | null = null;
    for (const mutu of TANGGA_MUTU) {
      const blob = await new Promise<Blob | null>((res) => kanvas.toBlob(res, "image/jpeg", mutu));
      if (!blob) continue;
      terbaik = blob;
      if (hasilnyaCukup(blob.size, file.size)) break;
    }
    if (!terbaik) throw new KecilkanGagal("Peramban ini gagal menyimpan hasil pengecilan.");
    if (!hasilnyaCukup(terbaik.size, file.size, SASARAN_KECIL_BYTE)) {
      throw new KecilkanGagal(
        "Foto ini tetap terlalu besar setelah dikecilkan. Potret ulang dengan resolusi kamera yang lebih rendah.",
      );
    }
    return new File([terbaik], namaHasil(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
