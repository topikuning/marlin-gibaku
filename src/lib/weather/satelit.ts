import "server-only";
import { db } from "@/lib/db";
import { parseDateKey } from "@/lib/format";
import type { HourlyWeather } from "@/lib/weather/hourly";
import { KKP_WEATHER_HOURS } from "@/lib/weather/hourly";
import { awanHimawariBanyak } from "@/lib/weather/himawari";
import { bukaGsmap, gsmapSiap, GsmapBelumSiapError, type SesiGsmap } from "@/lib/weather/gsmap";
import { jamSudahLewat, jamUtc, kategoriSatelit } from "@/lib/weather/satelit-murni";

/**
 * CUACA PER JAM DARI PENGAMATAN SATELIT (DECISIONS 655): awan Himawari-9 +
 * hujan JAXA GSMaP. Hanya jam yang SUDAH lewat; jam yang datanya belum terbit
 * atau tidak cukup dibiarkan kosong dan disebut.
 *
 * KECEPATAN. Bacaan mentah disimpan per lokasi per jam (`cuaca_satelit_jam`)
 * dan hanya jam yang BELUM terbaca yang diambil. Pembaruan pukul 04.00
 * (`weather/subuh.ts`) mengisinya untuk SEMUA lokasi sekaligus – satu berkas
 * satelit melayani 83 lokasi.
 */

export const SATELIT_PROVIDER = "satelit: Himawari-9 (awan) + JAXA GSMaP (hujan)";

export class SatelitError extends Error {}

export type HasilSatelit = {
  hours: HourlyWeather[];
  /** Jam WIB yang belum terjadi saat diambil. */
  belumTerjadi: number[];
  /** Jam WIB yang sudah terjadi tapi datanya belum ada/tidak cukup. */
  kosong: number[];
  /** Catatan untuk ditampilkan (mis. akun GSMaP belum diisi). */
  catatan: string[];
};

export type TitikLokasi = { id: string; lat: number; lng: number };

/** Jalankan `fn` untuk tiap item dengan paling banyak `n` sekaligus. */
async function berbatas<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/**
 * Lengkapi bacaan mentah untuk lokasi-lokasi itu pada satu tanggal: hanya jam
 * yang sudah lewat dan belum terbaca. Aman diulang dan dijalankan bersamaan
 * (upsert per lokasi-jam). Mengembalikan catatan kegagalan/penundaan.
 */
export async function isiCuacaSatelit(lokasi: TitikLokasi[], dateKey: string, sekarang: Date): Promise<string[]> {
  const tanggal = parseDateKey(dateKey);
  if (!tanggal || lokasi.length === 0) return [];
  const lewat = KKP_WEATHER_HOURS.filter((h) => jamSudahLewat(dateKey, h, sekarang));
  if (lewat.length === 0) return [];

  const ada = await db.cuacaSatelitJam.findMany({
    where: { locationId: { in: lokasi.map((l) => l.id) }, tanggal },
    select: { locationId: true, jam: true, awanDiambil: true, hujanDiambil: true },
  });
  const sudah = new Map(ada.map((r) => [`${r.locationId}|${r.jam}`, r]));
  const perlu = (h: number, jenis: "awan" | "hujan") =>
    lokasi.filter((l) => {
      const r = sudah.get(`${l.id}|${h}`);
      return !(jenis === "awan" ? r?.awanDiambil : r?.hujanDiambil);
    });

  const simpan = (locationId: string, jam: number, data: { awanPersen?: number | null; awanDiambil?: Date; hujanMm?: number | null; hujanDiambil?: Date }) =>
    db.cuacaSatelitJam.upsert({
      where: { locationId_tanggal_jam: { locationId, tanggal, jam } },
      create: { locationId, tanggal, jam, ...data },
      update: data,
    });

  const catatan: string[] = [];

  // Awan: tiap jam satu berkas, semua jam bersamaan.
  let galatAwan: string | null = null;
  await berbatas(lewat, 15, async (h) => {
    const titik = perlu(h, "awan");
    if (titik.length === 0) return;
    try {
      const hasil = await awanHimawariBanyak(dateKey, jamUtc(h), titik);
      if (!hasil) return; // pemotretan jam itu belum ada – dicoba lagi nanti
      const kini = new Date();
      for (const t of titik) await simpan(t.id, h, { awanPersen: hasil.get(t.id) ?? null, awanDiambil: kini });
    } catch (e) {
      galatAwan ??= e instanceof Error ? e.message : String(e);
    }
  });
  if (galatAwan) catatan.push(`Data awan Himawari sebagian gagal dibaca: ${galatAwan}`);

  // Hujan: unduh semua berkas jam yang perlu (beberapa sambungan), lalu baca.
  const jamHujan = lewat.filter((h) => perlu(h, "hujan").length > 0);
  if (jamHujan.length > 0) {
    let gsmap: SesiGsmap | null = null;
    try {
      gsmap = await bukaGsmap();
      const siap = await gsmap.unduh(jamHujan.map((h) => ({ tanggalUtc: dateKey, jamUtc: jamUtc(h) })));
      for (const h of jamHujan) {
        if (!siap.has(`${dateKey}|${jamUtc(h)}`)) continue;
        const titik = perlu(h, "hujan");
        const hasil = await gsmap.hujanBanyak(dateKey, jamUtc(h), titik);
        if (!hasil) continue;
        const kini = new Date();
        for (const t of titik) await simpan(t.id, h, { hujanMm: hasil.get(t.id) ?? null, hujanDiambil: kini });
      }
    } catch (e) {
      if (!(e instanceof GsmapBelumSiapError)) {
        catatan.push(`Data hujan GSMaP gagal diambil: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      await gsmap?.tutup().catch(() => undefined);
    }
  }
  return catatan;
}

export async function fetchHourlySatelit(args: {
  locationId: string;
  lat: number;
  lng: number;
  dateKey: string;
  sekarang: Date;
}): Promise<HasilSatelit> {
  const { locationId, lat, lng, dateKey, sekarang } = args;
  const lewat = KKP_WEATHER_HOURS.filter((h) => jamSudahLewat(dateKey, h, sekarang));
  const belumTerjadi = KKP_WEATHER_HOURS.filter((h) => !lewat.includes(h));
  if (lewat.length === 0) {
    throw new SatelitError("Belum ada jam blanko yang selesai pada tanggal itu. Cuaca satelit hanya mencatat jam yang sudah lewat.");
  }

  const catatan = await isiCuacaSatelit([{ id: locationId, lat, lng }], dateKey, sekarang);
  const baris = await db.cuacaSatelitJam.findMany({
    where: { locationId, tanggal: parseDateKey(dateKey)! },
  });
  const perJam = new Map(baris.map((r) => [r.jam, r]));

  const akunAda = await gsmapSiap();
  if (!akunAda) {
    catatan.push(
      "Akun GSMaP belum diisi (Sistem → Pekerjaan Harian → Cuaca otomatis). Tanpa data hujan, hanya jam yang langitnya nyaris bersih yang bisa diisi.",
    );
  } else {
    const tertunda = lewat.filter((h) => !perJam.get(h)?.hujanDiambil).length;
    if (tertunda > 0) {
      catatan.push(`${tertunda} jam data hujan GSMaP belum terbit (biasanya tertunda ±4 jam). Tekan lagi nanti untuk melengkapinya.`);
    }
  }

  const hours: HourlyWeather[] = [];
  const kosong: number[] = [];
  for (const h of lewat) {
    const r = perJam.get(h);
    const k = kategoriSatelit(h, r?.awanDiambil ? r.awanPersen : null, r?.hujanDiambil ? r.hujanMm : null);
    if (k) hours.push(k);
    else kosong.push(h);
  }
  if (hours.length === 0) {
    throw new SatelitError(["Data satelit untuk tanggal itu belum cukup untuk mengisi satu jam pun.", ...catatan].join(" "));
  }
  return { hours, belumTerjadi, kosong, catatan };
}
