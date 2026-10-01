/**
 * PERKECIL GAMBAR DI PERAMBAN SEBELUM DIKIRIM (DECISIONS 642).
 *
 * Laporan user 2026-10-01: unggah kop PNG gagal dengan *"An unexpected response
 * was received from the server"*. Kiriman server action melewati server
 * perantara (proxy) yang punya batas ukurannya sendiri – nginx bawaan 1 MB –
 * dan yang membalas adalah halaman galat proxy, bukan MARLIN. Gambar identitas
 * (kop, logo, stempel) toh diperkecil & dikompres ulang di server; mengirim
 * berkas asli berukuran megabita hanya membuatnya rentan ditolak di jalan.
 *
 * Maka gambar diperkecil di sini dulu: sisi terpanjang ≤ `maxSisi`, WebP mutu
 * tinggi (transparansi logo tetap). Hasilnya dipakai HANYA bila lebih kecil;
 * gambar yang tidak bisa dibaca peramban (mis. HEIC di Chrome) dikirim apa
 * adanya dan server yang menjelaskan penolakannya.
 */
export async function perkecilGambar(berkas: File, maxSisi: number, mutu = 0.92): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return berkas;
  if (berkas.type && !berkas.type.startsWith("image/")) return berkas;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(berkas);
  } catch {
    return berkas;
  }
  try {
    const skala = Math.min(1, maxSisi / Math.max(bmp.width, bmp.height));
    const lebar = Math.max(1, Math.round(bmp.width * skala));
    const tinggi = Math.max(1, Math.round(bmp.height * skala));
    const kanvas = document.createElement("canvas");
    kanvas.width = lebar;
    kanvas.height = tinggi;
    const ctx = kanvas.getContext("2d");
    if (!ctx) return berkas;
    ctx.drawImage(bmp, 0, 0, lebar, tinggi);
    const blob = await new Promise<Blob | null>((ok) => kanvas.toBlob(ok, "image/webp", mutu));
    if (!blob || blob.type !== "image/webp" || blob.size >= berkas.size) return berkas;
    const nama = berkas.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], nama, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return berkas;
  } finally {
    bmp.close();
  }
}
