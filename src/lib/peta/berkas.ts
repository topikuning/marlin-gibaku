import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { brotliDecompress, gunzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { env } from "@/lib/env";
import {
  PANJANG_KEPALA,
  bacaKepalaPmtiles,
  namaLapisanMeta,
  type KepalaPmtiles,
} from "./pmtiles";

/**
 * PETA DASAR DISIMPAN DI VOLUME SENDIRI — bukan di R2.
 *
 * Teguran user 2026-09-06: *"R2 antara dev dan production berbeda, lalu apa
 * yang kamu harapkan. kenapa tidak kamu simpan langsung saja di lokal,
 * production punya volume dedicated."*
 *
 * Benar, dan rancangan pertama saya salah di dua hal sekaligus:
 *
 * 1. **Satu berkas di R2 hanya melayani satu lingkungan.** R2 dev dan produksi
 *    berbeda bucket, jadi mengunggah "ke R2" lewat satu workflow CI berarti
 *    salah satunya pasti tidak kebagian — dan yang tidak kebagian itu diam,
 *    cuma terlihat sebagai peta kosong.
 * 2. **Peta dasar bukan dokumen.** Ia bukan milik satu organisasi, tidak perlu
 *    dicadangkan, dan tidak pernah berubah antar-tenant: ia berkas statis yang
 *    sama untuk semua orang. Menaruhnya di penyimpanan objek berarti membayar
 *    tanda tangan URL, jalur unduh, dan kunci akses untuk sesuatu yang cukup
 *    diletakkan di disk yang sudah ada.
 *
 * Jadi ia hidup di VOLUME, mengikuti pola `LAMPIRAN_DIR` yang sudah terbukti:
 * direktorinya disiapkan `docker-entrypoint.sh` saat masih root (volume Railway
 * dipasang milik root — pelajaran 2026-09-03), lalu ditulis & dibaca aplikasi
 * sebagai `marlin`. Tiap lingkungan punya salinannya sendiri, dan tidak ada
 * satu pun kunci yang perlu disamakan antar-lingkungan.
 */

/**
 * Direktori peta — HARUS jatuh di dalam volume, bukan di sebelahnya.
 *
 * Kejadian 2026-09-06: volume produksi ter-mount di `/data`, sementara nilai
 * bawaan saya `/app/.data/peta`. Berkas peta akan tertulis DI LUAR volume dan
 * lenyap tiap deploy — persis kegagalan lampiran 2026-09-03, terulang karena
 * saya menebak titik pasangnya alih-alih mengikuti yang sudah ada.
 *
 * Urutannya sekarang mengikuti bukti, bukan tebakan:
 *   1. `PETA_DIR` bila diisi — pengelola yang paling tahu.
 *   2. Bersebelahan dengan `LAMPIRAN_DIR` bila diisi. Lampiran sudah terbukti
 *      berada di volume; menaruh peta di sebelahnya berarti ikut benar tanpa
 *      satu pun variabel baru yang harus diisi orang.
 *   3. `/data/peta` bila `/data` ada — titik pasang volume Railway yang lazim.
 *   4. `.data/peta` di dalam aplikasi — hanya untuk pengembangan lokal.
 */
function pilihDirPeta(): string {
  const eksplisit = env.PETA_DIR?.trim();
  if (eksplisit) return eksplisit;

  const lampiran = process.env.LAMPIRAN_DIR?.trim();
  if (lampiran) return path.join(path.dirname(lampiran), "peta");

  try {
    if (statSync("/data").isDirectory()) return "/data/peta";
  } catch {
    // /data tidak ada – lingkungan pengembangan.
  }
  return path.join(process.cwd(), ".data", "peta");
}

export const DIR_PETA = pilihDirPeta();

/** Nama berkasnya tetap — satu peta dasar per lingkungan, tidak berversi. */
export const NAMA_BASEMAP = "basemap.pmtiles";

export const jalurBasemap = path.join(DIR_PETA, NAMA_BASEMAP);

export type BerkasPeta = { ada: boolean; ukuran: number; diperbarui: Date | null };

export async function periksaBasemap(): Promise<BerkasPeta> {
  try {
    const s = await stat(jalurBasemap);
    // Berkas kosong = unduhan yang mati di tengah jalan. Diperlakukan sebagai
    // TIDAK ADA supaya layar mengatakannya, bukan menyajikan peta rusak.
    if (s.size === 0) return { ada: false, ukuran: 0, diperbarui: null };
    return { ada: true, ukuran: s.size, diperbarui: s.mtime };
  } catch {
    return { ada: false, ukuran: 0, diperbarui: null };
  }
}

/**
 * ISI berkas peta dasar — bukan sekadar "ada dan berukuran sekian".
 *
 * Keluhan user 2026-09-06: *"berhasil didownload, tapi malah jadi abu2."*
 * Berkas yang ADA tapi salah isi menghasilkan kanvas abu-abu yang terbaca
 * sebagai kesalahan aplikasi. Yang dibaca di sini cuma 127 byte kepala +
 * metadata-nya, jadi memeriksanya murah walau berkasnya ratusan megabyte.
 */
export type IsiPeta =
  | { sah: true; kepala: KepalaPmtiles; lapisan: string[] }
  | { sah: false; sebab: string };

const gunzipAsync = promisify(gunzip);
const brotliAsync = promisify(brotliDecompress);

async function bacaMetadata(
  fh: Awaited<ReturnType<typeof open>>,
  kepala: KepalaPmtiles,
): Promise<unknown> {
  if (kepala.metaPanjang <= 0 || kepala.metaPanjang > 32 * 1024 * 1024) return null;
  const buf = Buffer.alloc(kepala.metaPanjang);
  await fh.read(buf, 0, kepala.metaPanjang, kepala.metaOffset);
  let mentah: Buffer = buf;
  if (kepala.kompresiDalam === "gzip") mentah = (await gunzipAsync(buf)) as Buffer;
  else if (kepala.kompresiDalam === "brotli") mentah = (await brotliAsync(buf)) as Buffer;
  else if (kepala.kompresiDalam !== "tanpa" && kepala.kompresiDalam !== "tidak diketahui")
    return null; // zstd: tidak ada di Node LTS ini; bukan kegagalan peta
  return JSON.parse(mentah.toString("utf8"));
}

/** Periksa isi berkas yang sedang terpasang. Tidak melempar. */
export async function periksaIsiBasemap(jalur = jalurBasemap): Promise<IsiPeta> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(jalur, "r");
    const kepalaBuf = Buffer.alloc(PANJANG_KEPALA);
    const { bytesRead } = await fh.read(kepalaBuf, 0, PANJANG_KEPALA, 0);
    const hasil = bacaKepalaPmtiles(kepalaBuf.subarray(0, bytesRead));
    if (!hasil.sah) return hasil;
    let lapisan: string[] = [];
    try {
      lapisan = namaLapisanMeta(await bacaMetadata(fh, hasil.kepala));
    } catch {
      // Metadata rusak tidak membatalkan berkasnya — kepala yang menentukan.
      lapisan = [];
    }
    return { sah: true, kepala: hasil.kepala, lapisan };
  } catch (e) {
    return { sah: false, sebab: `tidak bisa dibaca – ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Isi berkas terpasang, DIINGAT selama berkasnya tidak berubah.
 *
 * Pemeriksaannya murah tapi tidak gratis (metadata bisa ratusan kilobyte
 * ter-gzip), sedangkan jawabannya hanya berubah saat berkasnya diganti. Kunci
 * ingatannya ukuran + waktu ubah: mengganti berkas selalu mengubah keduanya.
 */
let ingatan: { kunci: string; isi: IsiPeta } | null = null;

export async function isiBasemapTerkini(): Promise<IsiPeta | null> {
  const berkas = await periksaBasemap();
  if (!berkas.ada) return null;
  const kunci = `${berkas.ukuran}:${berkas.diperbarui?.getTime() ?? 0}`;
  if (ingatan?.kunci === kunci) return ingatan.isi;
  const isi = await periksaIsiBasemap();
  ingatan = { kunci, isi };
  return isi;
}

/** Satu unduhan pada satu waktu, per proses. */
let sedangUnduh: Promise<{ ukuran: number }> | null = null;

export function unduhanBerjalan(): boolean {
  return sedangUnduh !== null;
}

/**
 * Unduh peta dasar ke volume.
 *
 * Ditulis ke berkas SEMENTARA lalu diganti nama saat selesai: unduhan 300 MB
 * yang putus di tengah tidak boleh meninggalkan berkas separuh yang terlihat
 * seperti peta yang siap dipakai. Kalau prosesnya mati, yang tertinggal cuma
 * `.bagian` yang diabaikan pembaca dan ditimpa percobaan berikutnya.
 */
export async function unduhBasemap(sumber: string): Promise<{ ukuran: number }> {
  if (sedangUnduh) return sedangUnduh;
  sedangUnduh = (async () => {
    await mkdir(DIR_PETA, { recursive: true });
    const sementara = `${jalurBasemap}.bagian`;
    const res = await fetch(sumber, { redirect: "follow" });
    if (!res.ok || !res.body) {
      // 404 punya arti khusus dan bisa ditindaklanjuti: berkasnya memang belum
      // pernah dibangun. Menjawab "404 Not Found" saja memaksa orang menebak
      // antara salah alamat, berkas hilang, dan hak akses.
      if (res.status === 404) {
        throw new Error(
          "berkas peta dasar belum pernah dibangun. Buka tab Actions di GitHub, jalankan workflow \"Peta dasar MARLIN\" sekali (±30–60 menit), lalu tekan tombol ini lagi. Kalau memakai cermin sendiri, isi PETA_SUMBER_URL.",
        );
      }
      throw new Error(`sumber peta menjawab ${res.status} ${res.statusText || ""}`.trim());
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(sementara));
    const s = await stat(sementara);
    if (s.size === 0) {
      await unlink(sementara).catch(() => {});
      throw new Error("Berkas yang terunduh kosong.");
    }
    /*
     * ISINYA DIPERIKSA SEBELUM DIPASANG — teguran user 2026-09-06: *"berhasil
     * didownload, tapi malah jadi abu2."*
     *
     * Versi pertama menyatakan berhasil begitu servernya menjawab 200 dan
     * berkasnya tidak nol byte. Itu terlalu longgar: halaman HTML "Not Found"
     * yang cantik, halaman masuk, atau berkas yang terpotong semuanya punya
     * ukuran. Yang tersimpan lalu dipuji "Terpasang", dan kegagalannya baru
     * muncul di layar peta sebagai abu-abu tanpa sebab. Sekarang yang tidak
     * berkepala PMTiles DIBUANG di sini, dengan menyebut isi awalnya.
     */
    const isi = await periksaIsiBasemap(sementara);
    if (!isi.sah) {
      await unlink(sementara).catch(() => {});
      throw new Error(`yang terunduh ${isi.sebab}`);
    }
    if (isi.kepala.jenisUbin !== "vektor") {
      await unlink(sementara).catch(() => {});
      throw new Error(
        `arsipnya berisi ubin ${isi.kepala.jenisUbin}, bukan vektor. Peta dasar MARLIN digambar dari ubin vektor (skema Protomaps); arsip gambar tidak bisa dipakai gaya ini.`,
      );
    }
    await rename(sementara, jalurBasemap);
    return { ukuran: s.size };
  })();
  try {
    return await sedangUnduh;
  } finally {
    sedangUnduh = null;
  }
}
