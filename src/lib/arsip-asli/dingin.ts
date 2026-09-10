import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

/**
 * KLIEN ARSIP DINGIN — mesin sendiri di balik Cloudflare Access.
 *
 * Yang disimpan di sana hanya BERKAS ASLI foto: byte apa adanya dari kamera,
 * besar, dan nyaris tidak pernah dibuka. Foto ber-cap yang dilihat orang
 * sehari-hari tetap di R2 dan tidak pernah lewat sini.
 *
 * ### Kenapa modul ini kecil sekali
 *
 * Rancangan awal (disusun ChatGPT, 2026-09-09) menaruh Railway Volume sebagai
 * persinggahan: unggahan menulis ke disk, pekerja latar memindahkannya ke sini,
 * dan kalau disknya penuh ada jalur darurat balik ke R2. Itu menambah empat
 * masalah yang tidak perlu ada — disk penuh, izin berkas, urutan resolusi path
 * yang harus sama antara aplikasi dan skrip shell, dan satu jendela waktu
 * ketika satu-satunya salinan ada di disk yang tidak dibackup.
 *
 * Padahal persinggahannya sudah ada: R2. Berkas asli memang SUDAH ditulis ke
 * sana sejak dulu. Jadi jalur unggah tidak disentuh sama sekali; yang
 * ditambahkan cuma pemindahan di belakang layar. Tiga dari lima keadaan di
 * rancangan awal lenyap bersama Volume-nya.
 *
 * ### Empat header, dan alasannya masing-masing
 *
 * - `CF-Access-Client-Id` / `CF-Access-Client-Secret` — melewati Cloudflare
 *   Access. Tanpa ini permintaan tidak pernah sampai ke mesinnya, ia dibalas
 *   halaman login oleh Cloudflare. Opsional: kalau mesinnya tidak di balik
 *   Access, kosongkan saja.
 * - `Authorization: Bearer` — otentikasi ke aplikasi penyimpannya sendiri.
 *   Terpisah dari Access, karena Access menjaga pintu gedung sedangkan ini
 *   menjaga pintu kamar.
 * - `X-Content-SHA256` — sidik jari isi. Penerima bisa menolak berkas yang
 *   berubah di jalan tanpa perlu membaca ulang seluruhnya.
 */

/** Sekali kirim/terima paling lama semenit setengah — uplink rumah, bukan pusat data. */
const BATAS_WAKTU_MS = 90_000;

export type SetelanDingin = { url: string; token: string; cfId?: string; cfSecret?: string };

/** `null` = arsip dingin belum dikonfigurasi; pemanggil harus diam, bukan gagal. */
export function setelanDingin(): SetelanDingin | null {
  const url = env.ORIGINAL_ARCHIVE_URL?.replace(/\/+$/, "");
  const token = env.ORIGINAL_ARCHIVE_TOKEN;
  if (!url || !token) return null;
  /*
   * TLS wajib, kecuali ke mesin sendiri.
   *
   * Yang dikirim ke sana bukan cuma foto: tiap permintaan membawa token
   * pembawa dan sepasang rahasia Cloudflare Access di headernya. Lewat HTTP
   * biasa, ketiganya terbaca siapa pun di jalan — dan salah ketik "http" di
   * satu variabel lingkungan tidak boleh sediam itu akibatnya.
   *
   * localhost dikecualikan supaya uji integrasi bisa menjalankan arsip tiruan
   * tanpa mengurus sertifikat. Di luar mesin sendiri, tidak ada pengecualian.
   */
  const keMesinSendiri = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(url);
  if (!url.startsWith("https://") && !keMesinSendiri) {
    throw new Error("ORIGINAL_ARCHIVE_URL wajib https – token tidak boleh lewat jalur terbuka");
  }
  return {
    url,
    token,
    cfId: env.ORIGINAL_ARCHIVE_CF_CLIENT_ID || undefined,
    cfSecret: env.ORIGINAL_ARCHIVE_CF_CLIENT_SECRET || undefined,
  };
}

/**
 * Kunci logis → jalur URL.
 *
 * ### Bentuknya mengikuti gateway yang SUDAH BERJALAN, bukan sebaliknya
 *
 * Uji sambungan pertama (2026-09-10) dijawab 404 di langkah PUT. Sebabnya bukan
 * Cloudflare: di mesin itu sudah berjalan `marlin-original-storage`, gateway
 * susunan ChatGPT yang dipasang user lebih dulu, dan dialeknya berbeda —
 * `/v1/objects/<kunci ter-base64url>`, bukan `/photos/...` apa adanya.
 *
 * Yang menyesuaikan MARLIN, dan itu bukan kompromi melainkan aturan tetap
 * (DECISIONS 203, ketetapan user 2026-08): yang sudah berjalan di lapangan tidak
 * dibongkar demi kerapian sistem. Gateway itu sudah lolos round-trip test di
 * mesinnya, sudah di balik Cloudflare Access, dan sudah punya batas ukuran objek
 * serta ambang sisa disk. Menyuruhnya diganti berarti membuang semua itu untuk
 * mendapatkan hal yang sama.
 *
 * ### Yang tetap dipertahankan: pemeriksaan bentuk kunci
 *
 * `originalKey` selalu dibuat sendiri oleh MARLIN
 * (`photos/{slug}/{tanggal}/{uuid}.asli.jpg`), jadi secara teori tidak mungkin
 * jahat. "Secara teori" bukan alasan yang cukup: satu impor data lama atau satu
 * kolom yang diedit tangan sudah cukup membuat `../` menyelinap. Base64url
 * memang sudah menutup jalur direktori dengan sendirinya — tapi pemeriksaan ini
 * menangkap hal lain yang lebih sering terjadi: kunci yang KACAU (kosong, salah
 * kolom, sisa migrasi) tertangkap di sini, bukan tersimpan diam-diam di arsip
 * permanen dengan nama yang tak seorang pun bisa telusuri.
 */
const BENTUK_KUNCI = /^photos\/[A-Za-z0-9._-]+\/[0-9-]+\/[A-Za-z0-9._-]+$/;

export function jalurDingin(kunci: string): string {
  if (!BENTUK_KUNCI.test(kunci) || kunci.includes("..")) {
    throw new Error(`Kunci arsip tidak berbentuk sah: ${kunci.slice(0, 80)}`);
  }
  // base64url TANPA padding – sama dengan `base64 -w0 | tr '+/' '-_' | tr -d '='`
  // di panduan pemasangan gateway-nya.
  return `v1/objects/${Buffer.from(kunci, "utf8").toString("base64url")}`;
}

/** Jalur pemeriksaan kesehatan gateway – tanpa token, dipakai mengenali lawan bicara. */
export const JALUR_SEHAT = "health";

function kepala(s: SetelanDingin, tambahan: Record<string, string> = {}): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${s.token}`, ...tambahan };
  if (s.cfId && s.cfSecret) {
    h["CF-Access-Client-Id"] = s.cfId;
    h["CF-Access-Client-Secret"] = s.cfSecret;
  }
  return h;
}

/**
 * Satu-satunya pintu keluar ke arsip dingin — dan itu disengaja.
 *
 * Header otentikasi dipasang DI SINI, bukan di tiap pemanggil. Versi pertama
 * menyerahkannya ke pemanggil dan langsung terbukti rapuh: `HEAD` lupa
 * membawanya, sehingga pemeriksaan "sudah ada belum" akan dijawab halaman login
 * Cloudflare, terbaca sebagai galat, dan berkas yang sudah aman di sana akan
 * dikirim ulang berkali-kali. Kalau otentikasi bisa lupa dipasang, suatu saat
 * ia akan lupa dipasang.
 */
async function minta(
  s: SetelanDingin,
  kunci: string,
  init: RequestInit & { tambahanKepala?: Record<string, string> },
): Promise<Response> {
  const { tambahanKepala, ...sisa } = init;
  return fetch(`${s.url}/${jalurDingin(kunci)}`, {
    ...sisa,
    headers: kepala(s, tambahanKepala),
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
    cache: "no-store",
  });
}

export type KeadaanDingin =
  | { ada: false }
  | { ada: true; bytes: number | null; sha256: string | null };

/** Sudah ada di sana? Beserta sidik jari & ukurannya bila penerima menyebutkannya. */
export async function periksaDingin(s: SetelanDingin, kunci: string): Promise<KeadaanDingin> {
  const res = await minta(s, kunci, { method: "HEAD" });
  if (res.status === 404) return { ada: false };
  if (!res.ok) throw new Error(`HEAD arsip gagal (${res.status})`);
  const panjang = res.headers.get("content-length");
  return {
    ada: true,
    bytes: panjang ? Number(panjang) : null,
    sha256: res.headers.get("x-content-sha256")?.toLowerCase() ?? null,
  };
}

export async function kirimDingin(s: SetelanDingin, kunci: string, isi: Buffer): Promise<void> {
  const sha = createHash("sha256").update(isi).digest("hex");
  const res = await minta(s, kunci, {
    method: "PUT",
    body: new Uint8Array(isi),
    tambahanKepala: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(isi.length),
      "X-Content-SHA256": sha,
    },
  });
  if (!res.ok) throw new Error(`PUT arsip gagal (${res.status})`);
}

export async function ambilDingin(s: SetelanDingin, kunci: string): Promise<Buffer> {
  const res = await minta(s, kunci, { method: "GET" });
  if (!res.ok) throw new Error(`GET arsip gagal (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * @param sha256 sidik jari isi yang DIHARAPKAN ada di sana.
 *
 * Gateway-nya menuntutnya lewat `X-Delete-SHA256`, dan tuntutan itu masuk akal:
 * penghapusan adalah satu-satunya operasi yang tidak bisa dibatalkan, jadi
 * penghapus wajib menunjukkan ia tahu persis apa yang dihapusnya. Kalau tidak
 * diketahui, header-nya tidak dikirim — biar gateway yang memutuskan, bukan kita
 * yang mengarang nilainya.
 */
export async function hapusDingin(s: SetelanDingin, kunci: string, sha256?: string): Promise<void> {
  const res = await minta(s, kunci, {
    method: "DELETE",
    tambahanKepala: sha256 ? { "X-Delete-SHA256": sha256 } : undefined,
  });
  // 404 = memang sudah tidak ada; itu hasil yang diinginkan, bukan kegagalan.
  if (!res.ok && res.status !== 404) throw new Error(`DELETE arsip gagal (${res.status})`);
}
