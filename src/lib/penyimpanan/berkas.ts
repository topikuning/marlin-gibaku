import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { r2Delete, r2GetBuffer, r2GetDenganJenis, r2HapusBanyak, r2PresignGet } from "@/lib/r2";
import { ambilDingin, bentukKunciSah, hapusDingin, setelanDingin } from "@/lib/arsip-asli/dingin";

/**
 * SATU PINTU KE BERKAS, DI MANA PUN IA BERADA (DECISIONS 645).
 *
 * Berkas yang sudah tidak baru dipindah dari R2 ke arsip Lenovo supaya R2
 * tetap di bawah batasnya. Kuncinya tidak berubah – tabel asal (foto, dokumen,
 * surat, lampiran) tetap menyimpan kunci yang sama, dan semua link MARLIN
 * (`/api/foto/<token>`, `/api/documents/<id>`, …) tetap menyebut ID, bukan
 * tempat simpan. Yang berubah hanya modul ini: ia tahu berkas mana yang
 * isinya sekarang diambil dari Lenovo.
 *
 * Karena itu SEMUA pembacaan, alamat, dan penghapusan berkas lewat sini, bukan
 * lewat `r2GetBuffer`/`r2PresignGet`/`r2Delete` langsung – dijaga
 * `tests/unit/penyimpanan-satu-pintu.test.ts`. Pemanggil yang lolos dari pintu
 * ini akan membaca R2 untuk berkas yang sudah tidak ada di sana.
 *
 * Berkas ASLI foto (`Photo.originalKey`) tetap diurus `arsip-asli/` dengan
 * kolomnya sendiri; modul ini tidak pernah mencatatnya.
 */

/** Berkas sudah dipindah tapi mesin arsipnya sedang tidak bisa dihubungi. */
export class BerkasTidakTerjangkau extends Error {
  constructor(sebab: string) {
    super(`Berkas ini tersimpan di arsip Lenovo yang sedang tidak bisa dihubungi – coba lagi nanti (${sebab}).`);
    this.name = "BerkasTidakTerjangkau";
  }
}

type Pindahan = {
  kunci: string;
  kunciDingin: string;
  sha256: string | null;
  contentType: string | null;
  r2DibuangAt: Date | null;
};

/**
 * Baris yang isinya SEKARANG di Lenovo. Baris `dihapus` dikecualikan: kunci
 * berbentuk sidik jari isi (`surat/<sha>`) bisa diunggah ulang sesudah
 * dihapus, dan unggahan baru itu ada di R2.
 */
const DIPAKAI = { dipindahAt: { not: null }, kategori: { not: "dihapus" } };

const PILIH = { kunci: true, kunciDingin: true, sha256: true, contentType: true, r2DibuangAt: true } as const;

async function pindahan(kunci: string): Promise<Pindahan | null> {
  return db.berkasPindah.findFirst({ where: { kunci, ...DIPAKAI }, select: PILIH });
}

/** Kunci yang isinya sekarang di Lenovo, dari daftar yang diberikan. Satu kueri. */
export async function pindahanBanyak(kunci: string[]): Promise<Map<string, Pindahan>> {
  const unik = [...new Set(kunci.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const rows = await db.berkasPindah.findMany({
    where: { kunci: { in: unik }, ...DIPAKAI },
    select: PILIH,
  });
  return new Map(rows.map((r) => [r.kunci, r]));
}

/** Seluruh kunci yang isinya di Lenovo – untuk audit R2 (bukan "hilang"). */
export async function semuaKunciPindahan(): Promise<Set<string>> {
  const rows = await db.berkasPindah.findMany({ where: DIPAKAI, select: { kunci: true } });
  return new Set(rows.map((r) => r.kunci));
}

async function dariLenovo(p: Pindahan): Promise<Buffer> {
  const s = setelanDingin();
  if (!s) {
    if (!p.r2DibuangAt) return r2GetBuffer(p.kunci);
    throw new BerkasTidakTerjangkau("arsip belum dikonfigurasi");
  }
  try {
    return await ambilDingin(s, p.kunciDingin);
  } catch (err) {
    // Salinan R2 belum dibuang – jangan gagalkan pekerjaan orang.
    if (!p.r2DibuangAt) return r2GetBuffer(p.kunci);
    throw new BerkasTidakTerjangkau(err instanceof Error ? err.message : "gagal");
  }
}

/** Isi berkas, dari R2 atau dari Lenovo. */
export async function ambilBerkas(kunci: string): Promise<Buffer> {
  const p = await pindahan(kunci);
  return p ? dariLenovo(p) : r2GetBuffer(kunci);
}

export async function ambilBerkasDenganJenis(kunci: string): Promise<{ isi: Buffer; jenis: string | null }> {
  const p = await pindahan(kunci);
  if (!p) return r2GetDenganJenis(kunci);
  return { isi: await dariLenovo(p), jenis: p.contentType };
}

/* ── Alamat ──────────────────────────────────────────────────────────────── */

/**
 * Masa berlaku token dibulatkan ke jam berikutnya. Alamat yang sama selama
 * satu jam berarti peramban bisa memakai simpanannya – galeri yang dibuka
 * ulang tidak menarik foto yang sama dari Lenovo berkali-kali.
 */
function kedaluwarsa(expiresIn: number): number {
  const detik = Math.floor(Date.now() / 1000) + expiresIn;
  return Math.ceil(detik / 3600) * 3600 + 3600;
}

function tanda(kunci: string, exp: number): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`berkas:${kunci}:${exp}`).digest("base64url");
}

export function tokenBerkas(kunci: string, exp: number): string {
  return `${Buffer.from(kunci, "utf8").toString("base64url")}.${exp.toString(36)}.${tanda(kunci, exp)}`;
}

/** Token → kunci, atau null bila rusak, palsu, atau kedaluwarsa. */
export function bacaTokenBerkas(token: string, sekarang = Date.now()): string | null {
  const [k, e, t] = token.split(".");
  if (!k || !e || !t) return null;
  const exp = parseInt(e, 36);
  if (!Number.isFinite(exp) || exp * 1000 < sekarang) return null;
  let kunci: string;
  try {
    kunci = Buffer.from(k, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!kunci) return null;
  const a = Buffer.from(t);
  const b = Buffer.from(tanda(kunci, exp));
  return a.length === b.length && timingSafeEqual(a, b) ? kunci : null;
}

function alamatLenovo(kunci: string, expiresIn: number, namaBerkas?: string): string {
  const q = namaBerkas ? `?nama=${encodeURIComponent(namaBerkas)}` : "";
  return `/api/berkas/${tokenBerkas(kunci, kedaluwarsa(expiresIn))}${q}`;
}

/**
 * Alamat sementara untuk membuka berkas. Di R2: presign seperti sebelumnya.
 * Di Lenovo: `/api/berkas/<token>` (RELATIF – pemanggil di route handler
 * menyusunnya terhadap URL permintaan), yang mengambil isinya lewat MARLIN.
 */
export async function alamatBerkas(kunci: string, expiresIn = 300, namaBerkas?: string): Promise<string> {
  const p = await pindahan(kunci);
  return p ? alamatLenovo(kunci, expiresIn, namaBerkas) : r2PresignGet(kunci, expiresIn);
}

export async function alamatBerkasBanyak(kunci: string[], expiresIn = 300): Promise<Map<string, string>> {
  const pindah = await pindahanBanyak(kunci);
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(kunci.filter(Boolean))].map(async (k) => {
      try {
        out.set(k, pindah.has(k) ? alamatLenovo(k, expiresIn) : await r2PresignGet(k, expiresIn));
      } catch {
        // Satu kunci gagal tidak boleh mengosongkan seluruh galeri – yang
        // tidak punya alamat tampil sebagai placeholder.
      }
    }),
  );
  return out;
}

/* ── Hapus ───────────────────────────────────────────────────────────────── */

/**
 * Salinan Lenovo yang gagal dihapus TIDAK menggagalkan penghapusan: barisnya
 * ditandai `dihapus` dan dibersihkan putaran pemindah berikutnya. Yang
 * tertinggal paling buruk ruang terbuang, bukan berkas yang muncul lagi.
 */
async function hapusSalinanLenovo(kunci: string[]): Promise<void> {
  if (kunci.length === 0) return;
  const rows = await db.berkasPindah.findMany({
    where: { kunci: { in: kunci } },
    select: { kunci: true, kunciDingin: true, sha256: true, dipindahAt: true },
  });
  const s = setelanDingin();
  for (const r of rows) {
    if (!r.dipindahAt) {
      await db.berkasPindah.delete({ where: { kunci: r.kunci } }).catch(() => null);
      continue;
    }
    try {
      if (!s) throw new Error("arsip belum dikonfigurasi");
      await hapusDingin(s, r.kunciDingin, r.sha256 ?? undefined);
      await db.berkasPindah.delete({ where: { kunci: r.kunci } }).catch(() => null);
    } catch (err) {
      await db.berkasPindah
        .update({
          where: { kunci: r.kunci },
          data: {
            kategori: KATEGORI_DIHAPUS,
            galat: `dihapus pemiliknya, salinan Lenovo belum terhapus: ${err instanceof Error ? err.message : "gagal"}`.slice(0, 500),
          },
        })
        .catch(() => null);
    }
  }
}

/** Kategori baris yang berkasnya sudah dihapus pemiliknya, menunggu salinan Lenovo dibuang. */
export const KATEGORI_DIHAPUS = "dihapus";

export async function hapusBerkas(kunci: string): Promise<void> {
  await r2Delete(kunci);
  await hapusSalinanLenovo([kunci]);
}

export async function hapusBerkasBanyak(kunci: string[]): Promise<{ terhapus: number; gagal: string[] }> {
  const hasil = await r2HapusBanyak(kunci);
  const gagal = new Set(hasil.gagal);
  await hapusSalinanLenovo(kunci.filter((k) => !gagal.has(k)));
  return hasil;
}

/* ── Nama di arsip ───────────────────────────────────────────────────────── */

/**
 * Nama berkas di mesin arsip. Gateway arsip (yang sudah berjalan di Lenovo)
 * hanya menerima kunci berbentuk foto `photos/<x>/<tanggal>/<nama>` – dan
 * gateway itu tidak dibongkar (DECISIONS 554). Foto ber-cap memakai kuncinya
 * sendiri; dokumen dan lainnya dinamai sidik jari kuncinya di bawah
 * `photos/pindahan/<tanggal>/`. Nama aslinya tetap di `berkas_pindah.kunci`.
 */
export function kunciDinginUntuk(kunci: string, tanggal: Date): string {
  if (bentukKunciSah(kunci)) return kunci;
  const hari = tanggal.toISOString().slice(0, 10);
  return `photos/pindahan/${hari}/${createHash("sha256").update(kunci).digest("hex")}`;
}
