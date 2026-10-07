import "server-only";
import type { HourlyWeather } from "@/lib/weather/hourly";
import { KKP_WEATHER_HOURS } from "@/lib/weather/hourly";
import { awanHimawari } from "@/lib/weather/himawari";
import { bukaGsmap, GsmapBelumSiapError, type SesiGsmap } from "@/lib/weather/gsmap";
import { jamSudahLewat, jamUtc, kategoriSatelit } from "@/lib/weather/satelit-murni";

/**
 * CUACA PER JAM DARI PENGAMATAN SATELIT (DECISIONS baru 2026-10-07):
 * awan Himawari-9 + hujan JAXA GSMaP. Hanya jam yang SUDAH lewat; jam yang
 * datanya belum terbit atau tidak cukup dibiarkan kosong dan disebut.
 */

export const SATELIT_PROVIDER = "satelit: Himawari-9 (awan) + JAXA GSMaP (hujan)";

export class SatelitError extends Error {}

export type HasilSatelit = {
  hours: HourlyWeather[];
  /** Jam WIB yang belum terjadi saat diambil. */
  belumTerjadi: number[];
  /** Jam WIB yang sudah terjadi tapi datanya belum ada/tidak cukup. */
  kosong: number[];
  /** Catatan untuk ditampilkan (mis. akun GSMaP belum dipasang). */
  catatan: string[];
};

/** Jalankan `fn` untuk tiap item dengan paling banyak `n` sekaligus. */
async function berbatas<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function fetchHourlySatelit(args: {
  lat: number;
  lng: number;
  dateKey: string;
  sekarang: Date;
}): Promise<HasilSatelit> {
  const { lat, lng, dateKey, sekarang } = args;
  const lewat = KKP_WEATHER_HOURS.filter((h) => jamSudahLewat(dateKey, h, sekarang));
  const belumTerjadi = KKP_WEATHER_HOURS.filter((h) => !lewat.includes(h));
  if (lewat.length === 0) {
    throw new SatelitError("Belum ada jam blanko yang selesai pada tanggal itu. Cuaca satelit hanya mencatat jam yang sudah lewat.");
  }
  const catatan: string[] = [];

  // Awan: tiap jam berdiri sendiri, dibaca paralel terbatas.
  let galatAwan: string | null = null;
  const awan = await berbatas(lewat, 5, async (h) => {
    try {
      return (await awanHimawari(dateKey, jamUtc(h), lat, lng))?.awanPersen ?? null;
    } catch (e) {
      galatAwan ??= e instanceof Error ? e.message : String(e);
      return null;
    }
  });
  if (galatAwan) catatan.push(`Data awan Himawari sebagian gagal dibaca: ${galatAwan}`);

  // Hujan: satu sesi FTP untuk semua jam, berurutan.
  const hujan: (number | null)[] = lewat.map(() => null);
  let gsmap: SesiGsmap | null = null;
  try {
    gsmap = await bukaGsmap();
    let tertunda = 0;
    for (let i = 0; i < lewat.length; i++) {
      const v = await gsmap.hujan(dateKey, jamUtc(lewat[i]), lat, lng);
      if (v === undefined) tertunda++;
      hujan[i] = v ?? null;
    }
    if (tertunda > 0) {
      catatan.push(`${tertunda} jam data hujan GSMaP belum terbit (biasanya tertunda ±4 jam). Tekan lagi nanti untuk melengkapinya.`);
    }
  } catch (e) {
    catatan.push(
      e instanceof GsmapBelumSiapError
        ? `${e.message} Tanpa data hujan, hanya jam yang langitnya nyaris bersih yang bisa diisi.`
        : `Data hujan GSMaP gagal diambil: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    await gsmap?.tutup().catch(() => undefined);
  }

  const hours: HourlyWeather[] = [];
  const kosong: number[] = [];
  lewat.forEach((h, i) => {
    const k = kategoriSatelit(h, awan[i], hujan[i]);
    if (k) hours.push(k);
    else kosong.push(h);
  });
  if (hours.length === 0) {
    throw new SatelitError(
      ["Data satelit untuk tanggal itu belum cukup untuk mengisi satu jam pun.", ...catatan].join(" "),
    );
  }
  return { hours, belumTerjadi, kosong, catatan };
}
