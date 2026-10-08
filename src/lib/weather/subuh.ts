import "server-only";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { jakartaDateKey, jakartaHour, parseDateKey } from "@/lib/format";
import { dominantWeatherCode, parseHourlyWeather, type HourlyWeather } from "@/lib/weather/hourly";
import { fetchHourlyWeather } from "@/lib/weather/open-meteo";
import { isiCuacaSatelit } from "@/lib/weather/satelit";
import { gabungkanJam, type BacaanSatelit } from "@/lib/weather/satelit-murni";
import { FILLABLE_STATUSES, GABUNGAN_PROVIDER, simpanObservasi } from "@/lib/weather/service";
import { gsmapSiap } from "@/lib/weather/gsmap";
import {
  catatSubuhTanggalTerjadwal,
  catatSubuhTerakhir,
  getSatelitSubuhAktif,
  getSubuhTanggalTerjadwal,
  type RingkasSubuh,
} from "@/lib/weather/setelan";
import type { Prisma } from "@/generated/prisma/client";

/**
 * PEMBARUAN CUACA SENYAP PUKUL 04.00 WIB (DECISIONS 657).
 *
 * Permintaan user: *"saat user klik di inputan laporan harian, datanya
 * sementara diambil dari meteo. tapi saat 4 dini hari WIB, data diperbarui
 * dengan data dari gsmap dan himawari kalau memang data dari dua sumber ini
 * lebih valid, senyap tapi data tetap terisi dengan valid"*.
 *
 * Untuk laporan KEMARIN yang cuacanya otomatis atau masih kosong, dan yang
 * belum disetujui/final:
 *   1. bacaan satelit seluruh lokasi diambil sekali (satu berkas per jam untuk
 *      semua lokasi);
 *   2. Open-Meteo diambil ulang – sekarang semua jamnya sudah lewat, jadi
 *      jam sore yang dulu berupa prakiraan ikut terganti;
 *   3. per jam: satelit bila kategorinya bisa disimpulkan, selain itu
 *      Open-Meteo (`gabungkanJam`).
 *
 * Isian MANUAL dan laporan yang sudah disetujui/final tidak pernah disentuh.
 * Unggahan otomatis ke Google Drive hanya mengambil laporan FINAL, dan
 * snapshot final dibangun dari kolom cuaca laporan saat difinalkan – jadi
 * laporan yang difinalkan sesudah pukul 04.00 membawa hasil gabungan ini.
 */

/** Jam WIB paling awal pembaruan berjalan: data GSMaP hari kemarin sudah terbit. */
export const JAM_SUBUH_WIB = 4;
/** Paling jauh tanggal yang disusul bila penjadwal sempat terlewat. */
const SUSUL_MAKS_HARI = 3;

type LaporanTarget = {
  id: string;
  locationId: string;
  weatherHourly: Prisma.JsonValue;
  lat: number;
  lng: number;
};

/** Perbarui semua laporan yang memenuhi syarat pada SATU tanggal. Aman diulang. */
export async function perbaruiCuacaTanggal(dateKey: string, sekarang = new Date()): Promise<RingkasSubuh> {
  const tanggal = parseDateKey(dateKey);
  const ringkas: RingkasSubuh = {
    tanggal: dateKey,
    pada: sekarang.toISOString(),
    laporan: 0,
    diperbarui: 0,
    jamSatelit: 0,
    jamModel: 0,
    catatan: [],
  };
  if (!tanggal) return ringkas;

  const baris = await db.dailyReport.findMany({
    where: {
      reportDate: tanggal,
      status: { in: [...FILLABLE_STATUSES] },
      OR: [{ weatherSource: null }, { weatherSource: "otomatis" }],
      location: { gpsLat: { not: null }, gpsLng: { not: null } },
    },
    select: { id: true, locationId: true, weatherHourly: true, location: { select: { gpsLat: true, gpsLng: true } } },
  });
  const laporan: LaporanTarget[] = baris.map((r) => ({
    id: r.id,
    locationId: r.locationId,
    weatherHourly: r.weatherHourly,
    lat: Number(r.location.gpsLat),
    lng: Number(r.location.gpsLng),
  }));
  ringkas.laporan = laporan.length;
  if (laporan.length === 0) return ringkas;

  if (!(await gsmapSiap())) {
    ringkas.catatan.push("Akun GSMaP belum diisi, jadi data hujan satelit tidak dipakai – hanya data awan.");
  }

  // 1. Satelit: semua lokasi sekaligus.
  const titik = [...new Map(laporan.map((l) => [l.locationId, { id: l.locationId, lat: l.lat, lng: l.lng }])).values()];
  ringkas.catatan.push(...(await isiCuacaSatelit(titik, dateKey, sekarang)));
  const bacaan = await db.cuacaSatelitJam.findMany({ where: { locationId: { in: titik.map((t) => t.id) }, tanggal } });
  const perLokasi = new Map<string, Map<number, BacaanSatelit>>();
  for (const b of bacaan) {
    const m = perLokasi.get(b.locationId) ?? new Map<number, BacaanSatelit>();
    m.set(b.jam, { awan: b.awanDiambil ? b.awanPersen : null, hujan: b.hujanDiambil ? b.hujanMm : null });
    perLokasi.set(b.locationId, m);
  }

  // 2–3. Per laporan: Open-Meteo segar (cadangan: isian otomatis yang ada), lalu gabung.
  let galatModel: string | null = null;
  let i = 0;
  const kerja = async () => {
    while (i < laporan.length) {
      const l = laporan[i++];
      let model: HourlyWeather[] = parseHourlyWeather(l.weatherHourly) ?? [];
      try {
        model = await fetchHourlyWeather({ lat: l.lat, lng: l.lng, dateKey, todayKey: jakartaDateKey(sekarang) });
      } catch (e) {
        galatModel ??= e instanceof Error ? e.message : String(e);
      }
      const gabung = gabungkanJam(model, perLokasi.get(l.locationId) ?? new Map());
      if (gabung.hours.length === 0) continue;
      // Isinya sudah sama (mis. putaran diulang) – tidak ditulis, tidak diaudit lagi.
      if (JSON.stringify(parseHourlyWeather(l.weatherHourly)) === JSON.stringify(gabung.hours)) continue;
      // Syaratnya diperiksa LAGI saat menulis: laporan bisa saja disetujui atau
      // diisi manual di antara pembacaan di atas dan penulisan ini.
      const kini = new Date();
      const hasil = await db.dailyReport.updateMany({
        where: {
          id: l.id,
          status: { in: [...FILLABLE_STATUSES] },
          OR: [{ weatherSource: null }, { weatherSource: "otomatis" }],
        },
        data: {
          weatherHourly: gabung.hours as unknown as Prisma.InputJsonValue,
          weather: dominantWeatherCode(gabung.hours),
          weatherSource: "otomatis",
          weatherFetchedAt: kini,
        },
      });
      if (hasil.count === 0) continue;
      await simpanObservasi(l.locationId, tanggal, GABUNGAN_PROVIDER, l.lat, l.lng, gabung.hours);
      await audit(null, "daily_report.weather_subuh", "daily_report", l.id, {
        tanggal: dateKey,
        jamSatelit: gabung.jamSatelit,
        jamModel: gabung.jamModel,
      });
      ringkas.diperbarui++;
      ringkas.jamSatelit += gabung.jamSatelit;
      ringkas.jamModel += gabung.jamModel;
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, laporan.length) }, kerja));
  if (galatModel) ringkas.catatan.push(`Open-Meteo sebagian gagal diambil ulang, isian lama dipakai: ${galatModel}`);
  return ringkas;
}

/** Tanggal (YYYY-MM-DD) sebelum `dateKey`. */
function sehariSebelum(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Satu putaran terjadwal: proses tanggal yang sudah waktunya dan belum
 * diproses. Pukul ≥ 04.00 WIB tanggal kemarin sudah waktunya; tanggal yang
 * sempat terlewat (penjadwal mati) disusul paling jauh 3 hari ke belakang.
 */
export async function perbaruiCuacaSubuh(
  sekarang = new Date(),
): Promise<{ dijalankan: false; alasan: string } | { dijalankan: true; tanggal: RingkasSubuh[] }> {
  if (!(await getSatelitSubuhAktif())) return { dijalankan: false, alasan: "pembaruan satelit dimatikan" };
  const hariIni = jakartaDateKey(sekarang);
  const batas = jakartaHour(sekarang) >= JAM_SUBUH_WIB ? sehariSebelum(hariIni) : sehariSebelum(sehariSebelum(hariIni));
  const terakhir = await getSubuhTanggalTerjadwal();

  const daftar: string[] = [];
  for (let d = batas, n = 0; n < SUSUL_MAKS_HARI && (!terakhir || d > terakhir); n++, d = sehariSebelum(d)) {
    daftar.unshift(d);
  }
  if (daftar.length === 0) return { dijalankan: false, alasan: `sudah diproses sampai ${terakhir}` };

  const hasil: RingkasSubuh[] = [];
  for (const d of daftar) {
    const r = await perbaruiCuacaTanggal(d, sekarang);
    await catatSubuhTerakhir(r);
    await catatSubuhTanggalTerjadwal(d);
    if (r.catatan.length) console.warn(`[cuaca-subuh] ${d}: ${r.catatan.join(" ")}`);
    hasil.push(r);
  }
  return { dijalankan: true, tanggal: hasil };
}

// ── Satu proses, satu putaran ───────────────────────────────────────────────

let berjalan: Promise<unknown> | null = null;

/**
 * Mulai di latar dan langsung pulang (penjadwal tidak menunggu). `tanggal`
 * diisi = paksa satu tanggal itu (tombol "Perbarui sekarang"), tanpa melihat
 * penanda tanggal terakhir.
 */
export function mulaiPerbaruiCuacaSubuh(tanggal?: string): { dimulai: boolean; alasan?: string } {
  if (berjalan) return { dimulai: false, alasan: "masih berjalan" };
  berjalan = (
    tanggal
      ? perbaruiCuacaTanggal(tanggal).then((r) => catatSubuhTerakhir({ ...r, manual: true }))
      : perbaruiCuacaSubuh()
  )
    .catch((e) => console.error("[cuaca-subuh] gagal:", e))
    .finally(() => {
      berjalan = null;
    });
  return { dimulai: true };
}

/** Tunggu putaran latar yang sedang berjalan (uji, dan pemanggil yang perlu). */
export async function tungguPerbaruiCuacaSubuh(): Promise<void> {
  await berjalan;
}
