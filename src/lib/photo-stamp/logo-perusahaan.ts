import "server-only";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";

/**
 * LOGO PERUSAHAAN UNTUK CAP FOTO (DECISIONS 424).
 *
 * Permintaan user 2026-08-23: *"logo marlin di pojok kanan itu sepertinya perlu
 * diubah dengan logo perusahaan, jika logo perusahaan diisi maka gunakan logo
 * perusahaan, jika tidak gunakan default marlin."*
 *
 * Cap adalah SVG yang dikomposit sharp, dan librsvg hanya membaca gambar yang
 * DIBENAMKAN — berkas di R2 tidak bisa dirujuk lewat URL dari dalam SVG. Jadi
 * logonya diambil sekali lalu diubah jadi data URI PNG.
 *
 * ### Kenapa di-cache di memori
 *
 * Satu vendor mengunggah puluhan foto sehari, semuanya memakai logo yang sama.
 * Menariknya dari R2 per foto adalah biaya jaringan yang berulang untuk berkas
 * yang tidak berubah. Cache-nya per-proses dan kecil: kunci R2 berubah setiap
 * kali logonya diganti (nama objek baru), jadi tidak ada jalan logo lama
 * tertahan setelah diperbarui — tidak perlu invalidasi.
 *
 * ### Gagal = kembali ke wordmark MARLIN, bukan cap gagal
 *
 * Logo adalah hiasan; koordinat, jam, dan nama lokasi adalah buktinya. Berkas
 * logo yang rusak atau R2 yang sedang tidak bisa dihubungi TIDAK boleh
 * menggagalkan penyimpanan foto.
 */

/** Sisi terpanjang logo yang dibenamkan. Cap-nya sendiri ±5% lebar foto. */
const LOGO_MAX = 320;
/** Batas jumlah entri cache — vendor aktif jauh di bawah ini. */
const CACHE_MAX = 64;

const cache = new Map<string, string | null>();

async function muatSharp() {
  const mod = await import("sharp");
  return mod.default ?? (mod as unknown as typeof import("sharp").default);
}

/**
 * Kunci R2 logo → data URI PNG siap dibenamkan ke SVG cap.
 * `null` bila tidak ada logo, R2 mati, atau berkasnya tidak bisa dibaca.
 */
export async function logoPerusahaanDataUri(logoKey: string | null | undefined): Promise<string | null> {
  if (!logoKey || !isR2Configured()) return null;
  const tersimpan = cache.get(logoKey);
  if (tersimpan !== undefined) return tersimpan;

  let hasil: string | null = null;
  try {
    const sharp = await muatSharp();
    const raw = await r2GetBuffer(logoKey);
    // PNG + alpha dipertahankan: logo di atas foto gelap harus bisa transparan.
    const png = await sharp(raw, { failOn: "none" })
      .resize(LOGO_MAX, LOGO_MAX, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    hasil = `data:image/png;base64,${png.toString("base64")}`;
  } catch (err) {
    console.error("[photo-stamp] logo perusahaan gagal dimuat – pakai wordmark MARLIN:", err);
    hasil = null;
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(logoKey, hasil);
  return hasil;
}

/** Hanya untuk uji: kosongkan cache antar kasus. */
export function kosongkanCacheLogo(): void {
  cache.clear();
}
