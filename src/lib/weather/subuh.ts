import "server-only";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { jakartaDateKey, jakartaHour, parseDateKey } from "@/lib/format";
import { dominantWeatherCode, parseHourlyWeather, type HourlyWeather } from "@/lib/weather/hourly";
import { fetchHourlyWeather } from "@/lib/weather/open-meteo";
import { isiCuacaSatelit } from "@/lib/weather/satelit";
import { gabungkanJam, type BacaanSatelit } from "@/lib/weather/satelit-murni";
import { GABUNGAN_PROVIDER, simpanObservasi } from "@/lib/weather/service";
import { gsmapSiap } from "@/lib/weather/gsmap";
import { catatSubuhTerakhir, getSatelitSubuhAktif, type RingkasSubuh } from "@/lib/weather/setelan";
import type { Prisma } from "@/generated/prisma/client";
import type { DailyReportStatus, WeatherCode } from "@/generated/prisma/enums";

/**
 * PEMBARUAN CUACA SENYAP DARI SATELIT (DECISIONS 657, 659).
 *
 * Permintaan user: *"saat user klik di inputan laporan harian, datanya
 * sementara diambil dari meteo. tapi saat 4 dini hari WIB, data diperbarui
 * dengan data dari gsmap dan himawari kalau memang data dari dua sumber ini
 * lebih valid, senyap tapi data tetap terisi dengan valid"*, lalu: *"meskipun
 * difinalkan, cuaca harus ikut data satelit terbaru. prinsipnya data yang
 * lebih valid!"*.
 *
 * Per laporan yang cuacanya otomatis atau masih kosong – APA PUN statusnya:
 *   1. bacaan satelit seluruh lokasi diambil sekali (satu berkas per jam untuk
 *      semua lokasi);
 *   2. Open-Meteo diambil ulang saat laporan pertama kali digabung – semua
 *      jamnya sudah lewat, jadi jam sore yang dulu berupa prakiraan ikut
 *      terganti;
 *   3. per jam: satelit bila kategorinya bisa disimpulkan, selain itu
 *      Open-Meteo (`gabungkanJam`).
 *
 * Laporan FINAL ikut diperbarui: bagian cuaca snapshot-nya diganti (hanya
 * bagian itu – angka lain yang dibekukan tetap), lalu PDF-nya di Google Drive
 * diganti tanpa mengirim ulang foto. Laporan mingguan yang sudah di Drive
 * diganti bila kode cuaca dominan salah satu harinya berubah – ringkasan
 * cuacanya dihitung dari situ. Yang tidak pernah disentuh hanya cuaca
 * yang diisi MANUAL dari lapangan: pengamatan orang di lokasi menang.
 *
 * Penjadwal memanggil tiap jam (pukul 04.02 WIB, lalu putaran per jam). Tiap
 * putaran memeriksa laporan tujuh hari terakhir, jadi laporan yang baru dibuat
 * sesudah pukul 04.00 dan data satelit yang terlambat terbit ikut tersusul.
 * Laporan yang isinya sudah sama tidak ditulis ulang.
 */

/** Jam WIB paling awal laporan kemarin diperbarui: data GSMaP hari itu sudah terbit. */
export const JAM_SUBUH_WIB = 4;
/**
 * Berapa hari ke belakang putaran terjadwal memeriksa laporan. Laporan sering
 * baru dibuat besok atau lusa, dan data satelit kadang terbit terlambat.
 */
export const JENDELA_HARI = 7;

type Calon = {
  id: string;
  locationId: string;
  status: DailyReportStatus;
  /** Kode cuaca dominan yang tersimpan – ringkasan mingguan memakai ini. */
  weather: WeatherCode | null;
  weatherHourly: Prisma.JsonValue;
  /** Laporan final yang punya snapshot. */
  adaSnapshot: boolean;
  /** `finalSnapshot.weatherHourly` – hanya bagian itu yang dibaca. */
  snapJam: Prisma.JsonValue;
  lat: number;
  lng: number;
};

/**
 * Laporan pada satu tanggal yang cuacanya otomatis atau kosong, di lokasi
 * ber-GPS. Snapshot final dibaca bagian cuacanya saja: putaran tiap jam
 * memeriksa ratusan laporan, dan snapshot utuh memuat seluruh item dan foto.
 */
async function calonLaporan(dateKey: string): Promise<Calon[]> {
  const baris = await db.$queryRaw<
    {
      id: string;
      location_id: string;
      status: DailyReportStatus;
      weather: WeatherCode | null;
      weather_hourly: Prisma.JsonValue;
      ada_snapshot: boolean;
      snap_jam: Prisma.JsonValue;
      gps_lat: unknown;
      gps_lng: unknown;
    }[]
  >`
    SELECT dr.id, dr.location_id, dr.status::text AS status, dr.weather::text AS weather, dr.weather_hourly,
           (dr.status::text = 'final' AND jsonb_typeof(dr.final_snapshot) = 'object') AS ada_snapshot,
           dr.final_snapshot -> 'weatherHourly' AS snap_jam,
           l.gps_lat, l.gps_lng
    FROM daily_reports dr
    JOIN locations l ON l.id = dr.location_id
    WHERE dr.report_date = ${dateKey}::date
      AND (dr.weather_source IS NULL OR dr.weather_source::text = 'otomatis')
      AND l.gps_lat IS NOT NULL AND l.gps_lng IS NOT NULL
  `;
  return baris.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    status: r.status,
    weather: r.weather,
    weatherHourly: r.weather_hourly,
    adaSnapshot: r.ada_snapshot === true,
    snapJam: r.snap_jam,
    lat: Number(r.gps_lat),
    lng: Number(r.gps_lng),
  }));
}

/**
 * Tulis cuaca gabungan ke satu laporan. Pada laporan final, bagian cuaca
 * snapshot ikut diganti.
 *
 * Barisnya DIKUNCI selama membaca dan menulis: finalisasi atau buka kunci yang
 * bersamaan menunggu sampai tulisan ini selesai, jadi snapshot yang baru
 * dibangun tidak pernah tertimpa versi lama. Status dan sumber cuaca dibaca
 * ulang di dalam kunci – laporan bisa saja diisi manual di antara pembacaan
 * awal dan penulisan ini.
 */
async function tulisCuaca(
  id: string,
  hours: HourlyWeather[],
): Promise<{ status: DailyReportStatus; snapshot: boolean } | null> {
  const weather = dominantWeatherCode(hours);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM daily_reports WHERE id = ${id}::uuid FOR UPDATE`;
    const kini = await tx.dailyReport.findUnique({
      where: { id },
      select: { status: true, weatherSource: true, finalSnapshot: true },
    });
    if (!kini || kini.weatherSource === "manual") return null;
    const snap =
      kini.status === "final" &&
      kini.finalSnapshot != null &&
      typeof kini.finalSnapshot === "object" &&
      !Array.isArray(kini.finalSnapshot)
        ? (kini.finalSnapshot as Prisma.JsonObject)
        : null;
    await tx.dailyReport.update({
      where: { id },
      data: {
        weatherHourly: hours as unknown as Prisma.InputJsonValue,
        weather,
        weatherSource: "otomatis",
        weatherFetchedAt: new Date(),
        ...(snap
          ? { finalSnapshot: { ...snap, weather, weatherHourly: hours } as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return { status: kini.status, snapshot: snap != null };
  });
}

/** Jalankan `fn` untuk tiap item dengan paling banyak `n` sekaligus. */
async function berbatas<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

function ringkasKosong(sekarang: Date): RingkasSubuh {
  return {
    tanggal: [],
    pada: sekarang.toISOString(),
    laporan: 0,
    diperbarui: 0,
    final: 0,
    drive: 0,
    mingguan: 0,
    jamSatelit: 0,
    jamModel: 0,
    catatan: [],
  };
}

/**
 * Proses semua laporan yang memenuhi syarat pada SATU tanggal.
 *
 * `paksa` (tombol di layar Sistem): Open-Meteo diambil ulang untuk semua
 * laporan. `terjadwal`: hanya untuk laporan yang belum pernah digabung – jam
 * model laporan yang sudah digabung diambil sesudah harinya lewat, jadi yang
 * masih bisa berubah hanya data satelit yang terlambat terbit, dan itu sudah
 * ada di `cuaca_satelit_jam`.
 */
async function prosesTanggal(dateKey: string, sekarang: Date, mode: "paksa" | "terjadwal"): Promise<RingkasSubuh> {
  const ringkas = ringkasKosong(sekarang);
  const tanggal = parseDateKey(dateKey);
  if (!tanggal) return ringkas;

  const laporan = await calonLaporan(dateKey);
  ringkas.laporan = laporan.length;
  if (laporan.length === 0) return ringkas;

  if (!(await gsmapSiap())) {
    ringkas.catatan.push("Akun GSMaP belum diisi, jadi data hujan satelit tidak dipakai – hanya data awan.");
  }

  // 1. Satelit: semua lokasi sekaligus; hanya jam yang belum terbaca yang diambil.
  const titik = [...new Map(laporan.map((l) => [l.locationId, { id: l.locationId, lat: l.lat, lng: l.lng }])).values()];
  ringkas.catatan.push(...(await isiCuacaSatelit(titik, dateKey, sekarang)));
  const bacaan = await db.cuacaSatelitJam.findMany({ where: { locationId: { in: titik.map((t) => t.id) }, tanggal } });
  const perLokasi = new Map<string, Map<number, BacaanSatelit>>();
  for (const b of bacaan) {
    const m = perLokasi.get(b.locationId) ?? new Map<number, BacaanSatelit>();
    m.set(b.jam, { awan: b.awanDiambil ? b.awanPersen : null, hujan: b.hujanDiambil ? b.hujanMm : null });
    perLokasi.set(b.locationId, m);
  }

  // 2–3. Per laporan: dasar model, gabung, tulis bila berubah.
  let galatModel: string | null = null;
  const { antrekanPdfHarian, antrekanUlangMingguan } = await import("@/lib/gdrive/antrean");
  await berbatas(laporan, 5, async (l) => {
    const lama = parseHourlyWeather(l.weatherHourly) ?? [];
    let dasar = lama;
    if (mode === "paksa" || !lama.some((h) => h.sumber)) {
      try {
        dasar = await fetchHourlyWeather({ lat: l.lat, lng: l.lng, dateKey, todayKey: jakartaDateKey(sekarang) });
      } catch (e) {
        galatModel ??= e instanceof Error ? e.message : String(e);
      }
    }
    const gabung = gabungkanJam(dasar, perLokasi.get(l.locationId) ?? new Map());
    if (gabung.hours.length === 0) return;

    // Isinya sudah sama – di laporan DAN, bila final, di snapshot-nya – tidak
    // ditulis, tidak diaudit, PDF tidak diganti. Snapshot diperiksa terpisah:
    // finalisasi yang berjalan bersamaan bisa membekukan cuaca lama, dan
    // putaran berikutnya yang membetulkannya.
    const isi = JSON.stringify(gabung.hours);
    const snapSama = !l.adaSnapshot || JSON.stringify(parseHourlyWeather(l.snapJam)) === isi;
    if (JSON.stringify(lama) === isi && snapSama) return;

    const tulis = await tulisCuaca(l.id, gabung.hours);
    if (!tulis) return;
    const drivePdf = tulis.snapshot ? await antrekanPdfHarian(l.id) : false;
    // Ringkasan cuaca laporan mingguan memakai kode dominan harian; berkas
    // mingguan yang sudah di Drive hanya perlu diganti bila kode itu berubah.
    const mingguan =
      dominantWeatherCode(gabung.hours) !== l.weather ? await antrekanUlangMingguan(l.id) : false;
    await simpanObservasi(l.locationId, tanggal, GABUNGAN_PROVIDER, l.lat, l.lng, gabung.hours);
    await audit(null, "daily_report.weather_subuh", "daily_report", l.id, {
      tanggal: dateKey,
      status: tulis.status,
      jamSatelit: gabung.jamSatelit,
      jamModel: gabung.jamModel,
      ...(tulis.snapshot ? { snapshot: true, drivePdf } : {}),
      ...(mingguan ? { driveMingguan: true } : {}),
    });
    ringkas.diperbarui++;
    if (tulis.status === "final") ringkas.final++;
    if (drivePdf) ringkas.drive++;
    if (mingguan) ringkas.mingguan++;
    ringkas.jamSatelit += gabung.jamSatelit;
    ringkas.jamModel += gabung.jamModel;
  });
  if (galatModel) ringkas.catatan.push(`Open-Meteo sebagian gagal diambil ulang, isian lama dipakai: ${galatModel}`);
  if (ringkas.diperbarui > 0) ringkas.tanggal.push(dateKey);
  return ringkas;
}

/** Perbarui semua laporan yang memenuhi syarat pada SATU tanggal (tombol). Aman diulang. */
export async function perbaruiCuacaTanggal(dateKey: string, sekarang = new Date()): Promise<RingkasSubuh> {
  const r = await prosesTanggal(dateKey, sekarang, "paksa");
  return { ...r, tanggal: [dateKey] };
}

/** Tanggal (YYYY-MM-DD) sebelum `dateKey`. */
function sehariSebelum(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Satu putaran terjadwal: laporan tujuh hari terakhir yang harinya sudah
 * tuntas. Pukul ≥ 04.00 WIB tanggal kemarin sudah tuntas; sebelum itu baru
 * sampai kemarin lusa.
 */
export async function perbaruiCuacaSubuh(
  sekarang = new Date(),
): Promise<{ dijalankan: false; alasan: string } | { dijalankan: true; ringkas: RingkasSubuh }> {
  if (!(await getSatelitSubuhAktif())) return { dijalankan: false, alasan: "pembaruan satelit dimatikan" };
  const hariIni = jakartaDateKey(sekarang);
  const batas = jakartaHour(sekarang) >= JAM_SUBUH_WIB ? sehariSebelum(hariIni) : sehariSebelum(sehariSebelum(hariIni));
  const daftar: string[] = [];
  for (let d = batas, n = 0; n < JENDELA_HARI; n++, d = sehariSebelum(d)) daftar.unshift(d);

  const ringkas = ringkasKosong(sekarang);
  const catatan = new Set<string>();
  for (const d of daftar) {
    const r = await prosesTanggal(d, sekarang, "terjadwal");
    ringkas.tanggal.push(...r.tanggal);
    ringkas.laporan += r.laporan;
    ringkas.diperbarui += r.diperbarui;
    ringkas.final += r.final;
    ringkas.drive += r.drive;
    ringkas.mingguan += r.mingguan;
    ringkas.jamSatelit += r.jamSatelit;
    ringkas.jamModel += r.jamModel;
    for (const c of r.catatan) catatan.add(c);
  }
  ringkas.catatan = [...catatan];
  if (ringkas.catatan.length) console.warn(`[cuaca-subuh] ${ringkas.catatan.join(" ")}`);
  // Putaran yang tidak mengubah apa pun tidak menimpa ringkasan terakhir yang
  // berarti di layar Sistem – kalau tidak, tiap jam ia tertimpa "0 laporan".
  if (ringkas.diperbarui > 0) await catatSubuhTerakhir(ringkas);
  return { dijalankan: true, ringkas };
}

// ── Satu proses, satu putaran ───────────────────────────────────────────────

let berjalan: Promise<unknown> | null = null;

/**
 * Mulai di latar dan langsung pulang (penjadwal tidak menunggu). `tanggal`
 * diisi = paksa satu tanggal itu (tombol "Perbarui sekarang").
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
