import "server-only";
import { bukaHdf5, type BacaBita } from "@/lib/weather/hdf5-jarak";
import { HIMAWARI_UKURAN, jarakKm, persenAwan, pikselHimawari } from "@/lib/weather/satelit-murni";

/**
 * AWAN DARI SATELIT HIMAWARI-9 (DECISIONS baru 2026-10-07).
 *
 * Sumber: produk penanda awan (cloud mask) NOAA dari citra Himawari-9 milik
 * JMA, terbuka di arsip NOAA Open Data (Amazon S3), tanpa akun. Satu berkas =
 * satu pemotretan 10 menit seluruh piringan bumi, piksel 2 km.
 *
 * Tiap jam dipakai pemotretan pertengahan jam (:30); bila tidak ada (jadwal
 * perawatan satelit), pemotretan terdekat di jam yang sama.
 */

export const HIMAWARI_PROVIDER = "himawari-9 (NOAA)";
const PREFIX = "AHI-L2-FLDK-Clouds";
const MENIT = [30, 20, 40, 10, 50, 0];
/** Jendela 5×5 piksel ≈ 10×10 km di sekitar lokasi. */
const SETENGAH_JENDELA = 2;
const TIMEOUT_MS = 20_000;

function baseUrl(): string {
  return (process.env.HIMAWARI_BASE_URL?.trim() || "https://noaa-himawari9.s3.amazonaws.com").replace(/\/$/, "");
}

export type AwanJam = { awanPersen: number | null; waktuScan: string };

async function cariBerkas(tanggalUtc: string, jamUtc: number): Promise<{ kunci: string; waktu: string } | null> {
  const [y, m, d] = tanggalUtc.split("-");
  for (const menit of MENIT) {
    const hhmm = `${String(jamUtc).padStart(2, "0")}${String(menit).padStart(2, "0")}`;
    const url = `${baseUrl()}/?list-type=2&prefix=${encodeURIComponent(`${PREFIX}/${y}/${m}/${d}/${hhmm}/`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`Arsip Himawari menolak permintaan (HTTP ${res.status}).`);
    const xml = await res.text();
    const kunci = /<Key>([^<]*\/AHI-CMSK_[^<]*\.nc)<\/Key>/.exec(xml)?.[1];
    if (kunci) return { kunci, waktu: `${hhmm.slice(0, 2)}:${hhmm.slice(2)} UTC` };
  }
  return null;
}

function pembacaJarak(url: string): BacaBita {
  return async (offset, panjang) => {
    const res = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + panjang - 1}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status !== 206 && res.status !== 200) throw new Error(`Berkas Himawari tidak bisa dibaca (HTTP ${res.status}).`);
    const isi = new Uint8Array(await res.arrayBuffer());
    // Server yang mengabaikan Range mengirim berkas utuh – ambil potongannya saja.
    return res.status === 200 ? isi.subarray(offset, offset + panjang) : isi;
  };
}

/**
 * Persentase awan di sekitar titik pada jam UTC itu. `undefined` = belum ada
 * pemotretan untuk jam tersebut (belum terbit atau jadwal perawatan).
 */
export async function awanHimawari(
  tanggalUtc: string,
  jamUtc: number,
  lat: number,
  lng: number,
): Promise<AwanJam | undefined> {
  const piksel = pikselHimawari(lat, lng);
  if (!piksel) throw new Error("Lokasi ini di luar jangkauan satelit Himawari.");
  const berkas = await cariBerkas(tanggalUtc, jamUtc);
  if (!berkas) return undefined;
  const h = await bukaHdf5(pembacaJarak(`${baseUrl()}/${berkas.kunci}`));

  // Pastikan piksel hitungan memang di lokasi: koordinat dari berkas itu sendiri.
  // Bila satelit/geometrinya berganti, lebih baik gagal daripada membaca tempat lain.
  const [[latPiksel]] = await h.jendela("Latitude", piksel.baris, piksel.kolom, 1, 1);
  const [[lngPiksel]] = await h.jendela("Longitude", piksel.baris, piksel.kolom, 1, 1);
  const jarak = jarakKm(lat, lng, latPiksel, lngPiksel);
  if (!(jarak < 5)) {
    throw new Error(`Piksel Himawari meleset ${Number.isFinite(jarak) ? jarak.toFixed(1) : "?"} km dari lokasi; susunan berkasnya mungkin berubah.`);
  }

  const b0 = Math.max(0, piksel.baris - SETENGAH_JENDELA);
  const k0 = Math.max(0, piksel.kolom - SETENGAH_JENDELA);
  const b1 = Math.min(HIMAWARI_UKURAN, piksel.baris + SETENGAH_JENDELA + 1);
  const k1 = Math.min(HIMAWARI_UKURAN, piksel.kolom + SETENGAH_JENDELA + 1);
  const jendela = await h.jendela("CloudMask", b0, k0, b1 - b0, k1 - k0);
  return { awanPersen: persenAwan(jendela), waktuScan: berkas.waktu };
}
