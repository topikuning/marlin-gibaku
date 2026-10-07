import "server-only";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { bukaFtp, type SesiFtp } from "@/lib/weather/ftp";
import { hujanDariGrid, jalurGsmap, urutkanVersiGsmap } from "@/lib/weather/satelit-murni";
import { getAkunGsmap } from "@/lib/weather/setelan";

/**
 * HUJAN DARI JAXA GSMaP GAUGE NRT (DECISIONS baru 2026-10-07).
 *
 * Satu berkas per jam UTC untuk seluruh dunia (60°LU–60°LS), dibagikan JAXA
 * lewat FTP dengan akun terdaftar. Akun diisi di layar Sistem dan disimpan di
 * basis data, sandinya tersandi (`weather/setelan.ts`).
 *
 * Berkas yang sudah diunduh disimpan di folder sementara selama 3 hari:
 * 83 lokasi pada tanggal yang sama memakai berkas jam yang sama, jadi server
 * JAXA cukup dihubungi sekali per jam data, bukan sekali per lokasi.
 */

export const GSMAP_PROVIDER = "JAXA GSMaP Gauge NRT";
const SIMPAN_HARI = 3;

export class GsmapBelumSiapError extends Error {}

export async function gsmapSiap(): Promise<boolean> {
  return (await getAkunGsmap()) != null;
}

/** Host FTP JAXA. */
export const GSMAP_HOST = "hokusai.eorc.jaxa.jp";

function folderSimpan(): string {
  return join(tmpdir(), "marlin-gsmap");
}

async function bersihkan(dir: string): Promise<void> {
  const batas = Date.now() - SIMPAN_HARI * 86_400_000;
  for (const nama of await readdir(dir).catch(() => [] as string[])) {
    const p = join(dir, nama);
    const s = await stat(p).catch(() => null);
    if (s && s.mtimeMs < batas) await unlink(p).catch(() => undefined);
  }
}

export type SesiGsmap = {
  /**
   * Curah hujan (mm/jam) di titik untuk jam UTC itu. `undefined` = berkas jam
   * itu belum terbit (GSMaP tertunda ±4 jam); `null` = berkas ada tapi kotak
   * itu tanpa pengamatan.
   */
  hujan(tanggalUtc: string, jamUtc: number, lat: number, lng: number): Promise<number | null | undefined>;
  tutup(): Promise<void>;
};

/** Buka sesi baca GSMaP. FTP baru dihubungi bila ada berkas yang belum tersimpan. */
export async function bukaGsmap(): Promise<SesiGsmap> {
  const akun = await getAkunGsmap();
  if (!akun) {
    throw new GsmapBelumSiapError("Akun GSMaP belum diisi (Sistem → Pekerjaan Harian → Sumber cuaca otomatis).");
  }
  const dir = folderSimpan();
  await mkdir(dir, { recursive: true });
  await bersihkan(dir);

  let ftp: Promise<SesiFtp> | null = null;
  let versi: Promise<string[]> | null = null;
  const sesi = () =>
    (ftp ??= bukaFtp({ host: GSMAP_HOST, user: akun.user, pass: akun.pass, timeoutMs: 30_000 }));
  const daftarVersi = () =>
    (versi ??= sesi().then(async (f) => {
      const v = urutkanVersiGsmap(await f.daftar("realtime_ver"));
      if (v.length === 0) throw new Error("Folder versi GSMaP (realtime_ver/vN) tidak ditemukan di server JAXA.");
      return v;
    }));

  const isiBerkas = async (tanggalUtc: string, jamUtc: number): Promise<Uint8Array | undefined> => {
    const kunci = `${tanggalUtc.replaceAll("-", "")}${String(jamUtc).padStart(2, "0")}.dat.gz`;
    const lokal = join(dir, kunci);
    const ada = await readFile(lokal).catch(() => null);
    if (ada) return gunzipSync(ada);
    const f = await sesi();
    // Versi terbaru dulu; versi lama dipakai untuk tanggal yang belum ada di versi baru.
    for (const v of await daftarVersi()) {
      const isi = await f.ambil(jalurGsmap(v, tanggalUtc, jamUtc));
      if (!isi) continue;
      const mentah = gunzipSync(isi);
      await writeFile(lokal, isi).catch(() => undefined);
      return mentah;
    }
    return undefined;
  };

  return {
    async hujan(tanggalUtc, jamUtc, lat, lng) {
      const isi = await isiBerkas(tanggalUtc, jamUtc);
      if (!isi) return undefined;
      return hujanDariGrid(isi, lat, lng);
    },
    async tutup() {
      if (ftp) await (await ftp.catch(() => null))?.tutup();
    },
  };
}

/**
 * Uji akun dari layar Sistem: masuk ke FTP JAXA dan baca daftar versi data.
 * Akun yang diberikan dipakai apa adanya (belum tentu sudah tersimpan).
 */
export async function ujiAkunGsmap(akun: { user: string; pass: string }): Promise<string[]> {
  const f = await bukaFtp({ host: GSMAP_HOST, user: akun.user, pass: akun.pass, timeoutMs: 20_000 });
  try {
    return urutkanVersiGsmap(await f.daftar("realtime_ver"));
  } finally {
    await f.tutup();
  }
}
