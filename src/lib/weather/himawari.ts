import "server-only";
import { bukaHdf5, type BacaBita } from "@/lib/weather/hdf5-jarak";
import { HIMAWARI_UKURAN, jarakKm, persenAwan, pikselHimawari } from "@/lib/weather/satelit-murni";

/**
 * AWAN DARI SATELIT HIMAWARI-9 (DECISIONS 655).
 *
 * Sumber: produk penanda awan (cloud mask) NOAA dari citra Himawari-9 milik
 * JMA, terbuka di arsip NOAA Open Data (Amazon S3), tanpa akun. Satu berkas =
 * satu pemotretan 10 menit seluruh piringan bumi, piksel 2 km.
 *
 * Tiap jam dipakai pemotretan pertengahan jam (:30); bila tidak ada (jadwal
 * perawatan satelit), pemotretan terdekat di jam yang sama.
 *
 * SATU berkas dibuka sekali untuk BANYAK lokasi: kepala berkasnya dibaca
 * sekali, lalu tiap lokasi hanya butuh satu potongan kecil.
 */

export const HIMAWARI_PROVIDER = "himawari-9 (NOAA)";
const PREFIX = "AHI-L2-FLDK-Clouds";
const MENIT = ["30", "20", "40", "10", "50", "00"];
/** Jendela 5×5 piksel ≈ 10×10 km di sekitar lokasi. */
const SETENGAH_JENDELA = 2;
const TIMEOUT_MS = 20_000;
/** Lokasi dibaca bersamaan dalam satu berkas. */
const PARALEL_LOKASI = 8;

/**
 * Piksel yang koordinatnya sudah dicocokkan dengan berkas. Geometri piringan
 * Himawari tetap, jadi cukup sekali per proses – bukan dua dataset tambahan
 * di setiap jam.
 */
const pikselTerbukti = new Set<string>();

function baseUrl(): string {
  return (process.env.HIMAWARI_BASE_URL?.trim() || "https://noaa-himawari9.s3.amazonaws.com").replace(/\/$/, "");
}

export type TitikAwan = { id: string; lat: number; lng: number };

/** Satu permintaan daftar untuk SATU jam (keenam pemotretannya sekaligus). */
async function cariBerkas(tanggalUtc: string, jamUtc: number): Promise<string | null> {
  const [y, m, d] = tanggalUtc.split("-");
  const hh = String(jamUtc).padStart(2, "0");
  const url = `${baseUrl()}/?list-type=2&prefix=${encodeURIComponent(`${PREFIX}/${y}/${m}/${d}/${hh}`)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`Arsip Himawari menolak permintaan (HTTP ${res.status}).`);
  const xml = await res.text();
  const kunci = [...xml.matchAll(/<Key>([^<]*\/AHI-CMSK_[^<]*\.nc)<\/Key>/g)].map((x) => x[1]);
  for (const mm of MENIT) {
    const ada = kunci.find((k) => k.includes(`/${hh}${mm}/`));
    if (ada) return ada;
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
 * Persentase awan di sekitar tiap titik pada jam UTC itu. `undefined` = belum
 * ada pemotretan untuk jam tersebut (belum terbit atau jadwal perawatan);
 * nilai null untuk satu titik = pikselnya tidak cukup sah untuk disimpulkan.
 */
export async function awanHimawariBanyak(
  tanggalUtc: string,
  jamUtc: number,
  titik: TitikAwan[],
): Promise<Map<string, number | null> | undefined> {
  const kunci = await cariBerkas(tanggalUtc, jamUtc);
  if (!kunci) return undefined;
  const h = await bukaHdf5(pembacaJarak(`${baseUrl()}/${kunci}`));
  const hasil = new Map<string, number | null>();

  let i = 0;
  const kerja = async () => {
    while (i < titik.length) {
      const t = titik[i++];
      const piksel = pikselHimawari(t.lat, t.lng);
      if (!piksel) throw new Error("Lokasi ini di luar jangkauan satelit Himawari.");
      const kunciPiksel = `${piksel.baris},${piksel.kolom}`;
      if (!pikselTerbukti.has(kunciPiksel)) {
        // Koordinat piksel hitungan dicocokkan dengan berkas itu sendiri. Bila
        // satelit/geometrinya berganti, lebih baik gagal daripada membaca tempat lain.
        const [[latP]] = await h.jendela("Latitude", piksel.baris, piksel.kolom, 1, 1);
        const [[lngP]] = await h.jendela("Longitude", piksel.baris, piksel.kolom, 1, 1);
        const jarak = jarakKm(t.lat, t.lng, latP, lngP);
        if (!(jarak < 5)) {
          throw new Error(
            `Piksel Himawari meleset ${Number.isFinite(jarak) ? jarak.toFixed(1) : "?"} km dari lokasi; susunan berkasnya mungkin berubah.`,
          );
        }
        pikselTerbukti.add(kunciPiksel);
      }
      const b0 = Math.max(0, piksel.baris - SETENGAH_JENDELA);
      const k0 = Math.max(0, piksel.kolom - SETENGAH_JENDELA);
      const b1 = Math.min(HIMAWARI_UKURAN, piksel.baris + SETENGAH_JENDELA + 1);
      const k1 = Math.min(HIMAWARI_UKURAN, piksel.kolom + SETENGAH_JENDELA + 1);
      hasil.set(t.id, persenAwan(await h.jendela("CloudMask", b0, k0, b1 - b0, k1 - k0)));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALEL_LOKASI, titik.length) }, kerja));
  return hasil;
}
