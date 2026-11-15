import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { alamatUnduhLangsung, type SetelanDingin } from "@/lib/arsip-asli/dingin";

/**
 * UJI SAMBUNGAN SEBELUM LENOVO MELAYANI PERAMBAN LANGSUNG (DECISIONS 768).
 *
 * Diuji persis seperti peramban akan memintanya: TANPA kartu Cloudflare Access
 * dan TANPA token gateway. Dua hal harus sudah beres di Lenovo, dan keduanya
 * dikerjakan orang, bukan MARLIN:
 * - program arsip (`arsip-dingin/server.mjs`) sudah versi yang mengenal
 *   `/v1/unduh/`;
 * - Cloudflare Access punya aturan Bypass untuk jalur `/v1/unduh/*`.
 *
 * Kalau salah satu belum, sakelar tidak boleh nyala: foto lama akan gagal
 * dibuka semua orang, bukan cuma lambat.
 */
export type HasilUji = { siap: true } | { siap: false; sebab: string };

const SEBAB_ACCESS =
  "Cloudflare Access masih menghadang jalur /v1/unduh. Tambahkan aturan Bypass untuk jalur itu di Cloudflare Zero Trust (lihat docs/ARSIP_DINGIN_SETUP.md).";
const SEBAB_LAMA =
  "Program arsip di Lenovo belum diperbarui. Pasang arsip-dingin/server.mjs terbaru, lalu mulai ulang layanannya.";

async function ketuk(url: string): Promise<Response | string> {
  try {
    return await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    return `Lenovo tidak bisa dihubungi: ${err instanceof Error ? err.message : "galat"}.`;
  }
}

function artikan(r: Response): string | null {
  if (r.status >= 300 && r.status < 400) return SEBAB_ACCESS; // dialihkan ke halaman masuk Access
  if (r.status === 403) return SEBAB_ACCESS;
  if (r.status === 401) return SEBAB_LAMA; // gateway lama menuntut token pembawa
  return null;
}

export async function ujiUnduhLangsung(s: SetelanDingin): Promise<HasilUji> {
  const umur = Math.floor(Date.now() / 1000) + 600;

  // 1. Kunci yang pasti tidak ada: gateway baru menjawab 404, gateway lama 401,
  //    Access 302/403.
  const kosong = `photos/uji-sambungan/2000-01-01/${randomBytes(8).toString("hex")}.bin`;
  const r1 = await ketuk(
    alamatUnduhLangsung(s, kosong, { jenis: "application/octet-stream", disposisi: "attachment", nama: "uji.bin", kedaluwarsa: umur }),
  );
  if (typeof r1 === "string") return { siap: false, sebab: r1 };
  if (r1.status !== 404) return { siap: false, sebab: artikan(r1) ?? `Lenovo menjawab ${r1.status} untuk jalur unduh.` };

  // 2. Berkas sungguhan yang terakhir dipindah, bila ada: isinya harus persis.
  const contoh = await db.berkasPindah.findFirst({
    where: { dipindahAt: { not: null }, kategori: { not: "dihapus" }, sha256: { not: null } },
    orderBy: { dipindahAt: "desc" },
    select: { kunciDingin: true, sha256: true, contentType: true },
  });
  if (contoh) {
    const r2 = await ketuk(
      alamatUnduhLangsung(s, contoh.kunciDingin, {
        jenis: contoh.contentType || "application/octet-stream",
        disposisi: "attachment",
        nama: "uji",
        kedaluwarsa: umur,
      }),
    );
    if (typeof r2 === "string") return { siap: false, sebab: r2 };
    if (r2.status === 200) {
      const sha = createHash("sha256").update(Buffer.from(await r2.arrayBuffer())).digest("hex");
      if (sha !== contoh.sha256) return { siap: false, sebab: "Isi berkas dari Lenovo tidak cocok dengan catatan MARLIN." };
    } else if (r2.status !== 404) {
      return { siap: false, sebab: artikan(r2) ?? `Lenovo menjawab ${r2.status} untuk berkas contoh.` };
    }
  }
  return { siap: true };
}
