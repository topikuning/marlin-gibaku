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

export type TitikHujan = { id: string; lat: number; lng: number };

export type SesiGsmap = {
  /**
   * Unduh berkas jam-jam itu ke folder simpanan, beberapa sambungan FTP
   * sekaligus. Mengembalikan jam (kunci "YYYY-MM-DD|jamUtc") yang berkasnya
   * sudah ada; yang belum terbit tidak termasuk.
   */
  unduh(jam: { tanggalUtc: string; jamUtc: number }[]): Promise<Set<string>>;
  /**
   * Curah hujan (mm/jam) di tiap titik untuk jam UTC itu, dari SATU berkas.
   * `undefined` = berkas jam itu belum terbit (GSMaP tertunda ±4 jam); nilai
   * null untuk satu titik = kotaknya tanpa pengamatan.
   */
  hujanBanyak(tanggalUtc: string, jamUtc: number, titik: TitikHujan[]): Promise<Map<string, number | null> | undefined>;
  tutup(): Promise<void>;
};

/** Sambungan FTP yang dipakai bersamaan untuk mengunduh. */
const SAMBUNGAN_PARALEL = 3;

/** Buka sesi baca GSMaP. FTP baru dihubungi bila ada berkas yang belum tersimpan. */
export async function bukaGsmap(): Promise<SesiGsmap> {
  const akun = await getAkunGsmap();
  if (!akun) {
    throw new GsmapBelumSiapError("Akun GSMaP belum diisi (Sistem → Pekerjaan Harian → Cuaca otomatis).");
  }
  const dir = folderSimpan();
  await mkdir(dir, { recursive: true });
  await bersihkan(dir);

  const terbuka: Promise<SesiFtp>[] = [];
  const bukaSatu = () => {
    const p = bukaFtp({ host: GSMAP_HOST, user: akun.user, pass: akun.pass, timeoutMs: 30_000 });
    terbuka.push(p);
    return p;
  };
  let versi: Promise<string[]> | null = null;
  const daftarVersi = (f: SesiFtp) =>
    (versi ??= f.daftar("realtime_ver").then((nama) => {
      const v = urutkanVersiGsmap(nama);
      if (v.length === 0) throw new Error("Folder versi GSMaP (realtime_ver/vN) tidak ditemukan di server JAXA.");
      return v;
    }));

  const kunciBerkas = (tanggalUtc: string, jamUtc: number) =>
    join(dir, `${tanggalUtc.replaceAll("-", "")}${String(jamUtc).padStart(2, "0")}.dat.gz`);
  const ada = async (path: string) => (await stat(path).catch(() => null))?.isFile() === true;

  const unduhSatu = async (f: SesiFtp, tanggalUtc: string, jamUtc: number): Promise<boolean> => {
    // Versi terbaru dulu; versi lama dipakai untuk tanggal yang belum ada di versi baru.
    for (const v of await daftarVersi(f)) {
      const isi = await f.ambil(jalurGsmap(v, tanggalUtc, jamUtc));
      if (!isi) continue;
      gunzipSync(isi); // berkas rusak/terpotong ditolak sebelum disimpan
      await writeFile(kunciBerkas(tanggalUtc, jamUtc), isi);
      return true;
    }
    return false;
  };

  return {
    async unduh(daftar) {
      const siap = new Set<string>();
      const antre: { tanggalUtc: string; jamUtc: number }[] = [];
      for (const j of daftar) {
        if (await ada(kunciBerkas(j.tanggalUtc, j.jamUtc))) siap.add(`${j.tanggalUtc}|${j.jamUtc}`);
        else antre.push(j);
      }
      if (antre.length === 0) return siap;
      let i = 0;
      const pekerja = async () => {
        const f = await bukaSatu();
        while (i < antre.length) {
          const j = antre[i++];
          if (await unduhSatu(f, j.tanggalUtc, j.jamUtc)) siap.add(`${j.tanggalUtc}|${j.jamUtc}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(SAMBUNGAN_PARALEL, antre.length) }, pekerja));
      return siap;
    },
    async hujanBanyak(tanggalUtc, jamUtc, titik) {
      const gz = await readFile(kunciBerkas(tanggalUtc, jamUtc)).catch(() => null);
      if (!gz) return undefined;
      const isi = gunzipSync(gz);
      return new Map(titik.map((t) => [t.id, hujanDariGrid(isi, t.lat, t.lng)]));
    },
    async tutup() {
      await Promise.all(terbuka.map(async (p) => (await p.catch(() => null))?.tutup()));
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
