import "server-only";
import { db } from "@/lib/db";
import { mingguKontrak } from "@/lib/mingguan/kirim";
import { getPeriodBounds } from "@/lib/periodic-report";
import { getGDriveConfigDisplay } from "./config";
import {
  adalahBatal,
  adalahTerhalang,
  refKeyHarian,
  refKeyPeriodik,
  unggahLaporanHarian,
  unggahLaporanPeriodik,
  type HasilUnggah,
} from "./kirim";
import {
  ANGGARAN_WAKTU_MS,
  BATAS_MENGGANTUNG_MS,
  JEDA_ANTAR_BERKAS_MS,
  MAKS_PEKERJAAN_PER_PUTARAN,
  hitungMundur,
  jenisGalat,
  masihAdaJatah,
  retryAfterMs,
} from "./laju";
import { publicOriginFromEnv } from "./origin";
import { getGDriveOtomatisAktif } from "./setelan";

/**
 * ANTREAN unggah otomatis ke Drive KKP (DECISIONS 313).
 *
 * Dua tahap yang sengaja dipisah:
 *
 *  1. **Pindai** — cari keluaran yang SEHARUSNYA sudah ada di Drive tapi belum
 *     pernah diantre, lalu buat barisnya. Murah (hanya tulis DB), dan inilah
 *     yang membuat "cek semua yang belum naik" bekerja untuk backlog: laporan
 *     yang difinalisasi sebelum fitur ini ada tetap terjaring.
 *  2. **Kerjakan** — tarik sedikit pekerjaan, unggah dengan jeda, catat hasil.
 *
 * Pemisahan itu penting karena tahap 1 boleh melihat SELURUH riwayat sedangkan
 * tahap 2 tidak boleh: kalau keduanya menyatu, satu putaran pertama akan
 * mencoba mengunggah ribuan berkas sekaligus — persis yang membuat Google
 * memblokir akun.
 *
 * Idempoten: kunci UNIQUE `(kind, refKey)` membuat pindai berulang tidak
 * menggandakan pekerjaan, dan unggah ulang di Drive tercatat sebagai REVISI,
 * bukan berkas kembar (DECISIONS 146).
 */

/** Batas baris baru yang dibuat satu putaran pindai — backlog dicicil. */
const MAKS_ANTRE_BARU_PER_PUTARAN = 300;

/**
 * Lokasi TIDAK dibatasi jumlahnya saat dipindai — yang dibatasi hanya CALON
 * yang dihasilkan.
 *
 * Membatasi lokasi per putaran ("120 teratas menurut nama") adalah cacat yang
 * sama dengan `pindaiHarian` versi pertama: daftarnya selalu itu-itu juga, jadi
 * pada 200+ lokasi (target arsitektur) lokasi ke-121 dan seterusnya TIDAK AKAN
 * PERNAH dipindai. Karena yang sudah diantre disaring lebih dulu, perulangan di
 * bawah melewati lokasi yang sudah beres tanpa memakan jatah, lalu berhenti
 * begitu jatah calon habis — jadi putaran berikutnya melanjutkan, bukan
 * mengulang.
 */

export type HasilPutaran = {
  /** false = sakelar otomatis mati; antrean tidak disentuh sama sekali. */
  aktif: boolean;
  /** false = akun Google belum terhubung; pekerjaan TIDAK dihanguskan. */
  terhubung: boolean;
  diantre: { harian: number; mingguan: number };
  dikerjakan: number;
  sukses: number;
  /** Tertahan laju oleh Google — akan dicoba lagi, bukan gagal. */
  ditahan: number;
  gagal: number;
  menyerah: number;
  batal: number;
  berkas: number;
  /** Pekerjaan yang masih menunggu SESUDAH putaran ini. */
  sisa: number;
  /** Kenapa putaran berhenti — null bila antreannya memang habis. */
  berhenti: string | null;
};

function putaranKosong(over: Partial<HasilPutaran> = {}): HasilPutaran {
  return {
    aktif: true,
    terhubung: true,
    diantre: { harian: 0, mingguan: 0 },
    dikerjakan: 0,
    sukses: 0,
    ditahan: 0,
    gagal: 0,
    menyerah: 0,
    batal: 0,
    berkas: 0,
    sisa: 0,
    berhenti: null,
    ...over,
  };
}

/* ── Tahap 1: pindai ─────────────────────────────────────────────────────── */

type Calon = {
  kind: "laporan_harian" | "laporan_mingguan";
  refKey: string;
  periode: string;
  packageId: string;
  locationId: string;
};

/**
 * Sisipkan calon yang belum punya baris. `createMany` + `skipDuplicates`
 * bersandar pada UNIQUE `(kind, refKey)`, jadi dua putaran yang berjalan
 * bersamaan tidak bisa menggandakan pekerjaan.
 *
 * Baris yang SUDAH ada sengaja tidak disentuh: pindai tidak boleh
 * menghidupkan kembali pekerjaan yang sudah menyerah atau dibatalkan — itu
 * urusan tombol "coba lagi", supaya kegagalan yang butuh tangan manusia tidak
 * berputar diam-diam selamanya.
 */
async function sisipkan(calon: Calon[]): Promise<number> {
  if (calon.length === 0) return 0;
  const r = await db.gDriveJob.createMany({ data: calon, skipDuplicates: true });
  return r.count;
}

/**
 * Laporan harian FINAL yang paketnya punya folder Drive tapi belum pernah
 * diantre. Terbaru dulu: kalau backlog-nya panjang, yang paling relevan bagi
 * KKP naik lebih dulu.
 *
 * `NOT EXISTS` ada di dalam SQL, dan itu BUKAN optimasi — tanpanya pemindai
 * tidak pernah konvergen. Mengambil "300 laporan final terbaru" lalu
 * mengandalkan `skipDuplicates` berarti begitu ke-300 itu sudah diantre, tiap
 * putaran berikutnya mengambil 300 yang sama dan menyisipkan nol: backlog yang
 * lebih tua tidak akan pernah tersentuh, tanpa satu pun tanda bahwa ada yang
 * tertinggal. Kunci pencocokannya sama persis dengan `refKeyHarian`.
 */
export async function pindaiHarian(batas = MAKS_ANTRE_BARU_PER_PUTARAN): Promise<number> {
  const laporan = await db.$queryRaw<
    { location_id: string; package_id: string; slug: string; periode: string }[]
  >`
    SELECT dr.location_id, l.package_id, l.slug,
           to_char(dr.report_date, 'YYYY-MM-DD') AS periode
    FROM daily_reports dr
    JOIN locations l ON l.id = dr.location_id
    JOIN packages  p ON p.id = l.package_id
    WHERE dr.status::text = 'final'
      AND p.drive_folder_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM gdrive_jobs j
        WHERE j.kind = 'laporan_harian'
          AND j.ref_key = l.slug || ':' || to_char(dr.report_date, 'YYYY-MM-DD')
      )
    ORDER BY dr.report_date DESC
    LIMIT ${batas}
  `;
  const calon: Calon[] = laporan.map((r) => ({
    kind: "laporan_harian",
    refKey: refKeyHarian(r.slug, r.periode),
    periode: r.periode,
    packageId: r.package_id,
    locationId: r.location_id,
  }));
  return sisipkan(calon);
}

/**
 * Minggu kontrak yang SUDAH TUNTAS untuk sebuah lokasi.
 *
 * Minggu ke-N baru layak dilaporkan setelah hari terakhirnya LEWAT, bukan pada
 * hari terakhirnya. Bedanya nyata: penjadwal berjalan sore (16:00 WIB) dan
 * laporan harian hari itu sering belum difinalisasi, jadi dokumen yang disusun
 * pada hari terakhir akan membekukan minggu yang datanya belum lengkap — ke
 * folder pemberi kerja pula.
 *
 * Ini juga membuat pemicu dan backlog memakai SATU aturan yang sama: tidak ada
 * cabang khusus "hari ini kebetulan hari terakhir".
 */
export function mingguRampung(startDate: Date, now: Date, totalWeeks: number): number {
  const berjalan = mingguKontrak(startDate, now);
  return Math.max(0, Math.min(berjalan - 1, totalWeeks));
}

/**
 * Laporan mingguan KKP per lokasi untuk semua minggu yang sudah tuntas dan
 * belum pernah diantre.
 *
 * Yang SUDAH punya baris disaring SEBELUM batas dikenakan, dan itu penting:
 * 83 lokasi × puluhan minggu jauh melewati batas satu putaran, jadi kalau
 * penyaringan diserahkan ke `skipDuplicates` di ujung, jatahnya habis
 * dipakai minggu-minggu yang sudah lama diantre dan lokasi di urutan belakang
 * tidak pernah kebagian — diam-diam, tanpa satu pun tanda.
 */
export async function pindaiMingguan(
  now = new Date(),
  batas = MAKS_ANTRE_BARU_PER_PUTARAN,
): Promise<number> {
  const lokasi = await db.location.findMany({
    where: {
      isActive: true,
      package: { driveFolderId: { not: null }, contract: { startDate: { not: null } } },
    },
    orderBy: { name: "asc" },
    select: { id: true, packageId: true, package: { select: { contract: { select: { startDate: true } } } } },
  });
  if (lokasi.length === 0) return 0;

  const sudah = new Set(
    (
      await db.gDriveJob.findMany({
        where: { kind: "laporan_mingguan", locationId: { in: lokasi.map((l) => l.id) } },
        select: { refKey: true },
      })
    ).map((j) => j.refKey),
  );

  const calon: Calon[] = [];
  for (const l of lokasi) {
    if (calon.length >= batas) break;
    const mulai = l.package.contract?.startDate;
    if (!mulai) continue;
    // Batas minggu diambil dari kontrak lokasi itu sendiri — kurva-S & durasi
    // bisa berbeda antar lokasi dalam satu paket.
    const bounds = await getPeriodBounds(l.id);
    if (!bounds) continue;
    const rampung = mingguRampung(mulai, now, bounds.totalWeeks);
    for (let n = 1; n <= rampung; n++) {
      if (calon.length >= batas) break;
      const refKey = refKeyPeriodik("mingguan", l.id, n);
      if (sudah.has(refKey)) continue;
      calon.push({
        kind: "laporan_mingguan",
        refKey,
        periode: String(n),
        packageId: l.packageId,
        locationId: l.id,
      });
    }
  }
  return sisipkan(calon);
}

/* ── Antre satu benda (dipanggil saat finalisasi) ────────────────────────── */

/**
 * Antrekan satu laporan harian yang BARU difinalisasi.
 *
 * Dipanggil dari `finalizeReport`. Sengaja hanya MENULIS BARIS, tidak
 * mengunggah: finalisasi tidak boleh gagal, tertahan, atau menunggu hanya
 * karena Google sedang lambat. Best-effort — kegagalan menulis antrean tidak
 * boleh membatalkan finalisasi yang sudah sah, dan pindai berikutnya akan
 * menjaring laporan itu lagi.
 *
 * `upsert` (bukan create) karena laporan yang dibuka kembali lalu difinalisasi
 * ulang HARUS naik lagi: isinya sudah berbeda dari yang terlanjur ada di Drive.
 */
export async function antrekanLaporanHarian(reportId: string): Promise<void> {
  try {
    const r = await db.dailyReport.findUnique({
      where: { id: reportId },
      select: {
        reportDate: true,
        locationId: true,
        location: { select: { slug: true, packageId: true, package: { select: { driveFolderId: true } } } },
      },
    });
    if (!r?.location.package.driveFolderId) return;
    const periode = r.reportDate.toISOString().slice(0, 10);
    const refKey = refKeyHarian(r.location.slug, periode);
    await db.gDriveJob.upsert({
      where: { kind_refKey: { kind: "laporan_harian", refKey } },
      create: {
        kind: "laporan_harian",
        refKey,
        periode,
        packageId: r.location.packageId,
        locationId: r.locationId,
      },
      update: {
        status: "menunggu",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        claimedAt: null,
        finishedAt: null,
      },
    });
  } catch (err) {
    console.error("[gdrive/antrean] gagal mengantre laporan harian:", err);
  }
}

/* ── Tahap 2: kerjakan ───────────────────────────────────────────────────── */

/** Penjaga satu proses: dua putaran bersamaan hanya menggandakan beban Drive. */
let sedangJalan = false;

type Pekerjaan = {
  id: string;
  kind: string;
  periode: string;
  locationId: string;
  attempts: number;
};

/**
 * Bebaskan pekerjaan yang tertinggal berstatus `jalan` karena prosesnya mati di
 * tengah putaran. Tanpa ini, satu restart di saat yang salah mengunci barisnya
 * selamanya dan laporan itu diam-diam tidak pernah sampai.
 */
async function bebaskanMenggantung(now: Date): Promise<void> {
  await db.gDriveJob.updateMany({
    where: { status: "jalan", claimedAt: { lt: new Date(now.getTime() - BATAS_MENGGANTUNG_MS) } },
    data: { status: "menunggu", claimedAt: null },
  });
}

/** Ambil satu pekerjaan secara atomik; null bila keburu diambil putaran lain. */
async function klaim(id: string, now: Date): Promise<boolean> {
  const r = await db.gDriveJob.updateMany({
    where: { id, status: "menunggu" },
    data: { status: "jalan", claimedAt: now },
  });
  return r.count > 0;
}

async function jalankanSatu(
  job: Pekerjaan,
  baseUrl: string | null,
): Promise<HasilUnggah | { error: string } | { batal: string }> {
  if (job.kind === "laporan_harian") {
    const loc = await db.location.findUnique({
      where: { id: job.locationId },
      select: { slug: true },
    });
    if (!loc) return { batal: "Lokasi sudah tidak ada." };
    return unggahLaporanHarian({
      slug: loc.slug,
      dateKey: job.periode,
      byId: null,
      baseUrl,
      jedaMs: JEDA_ANTAR_BERKAS_MS,
      // Jalur otomatis WAJIB memeriksa ulang — lihat catatan di `kirim.ts`.
      wajibFinal: true,
    });
  }
  const n = Number.parseInt(job.periode, 10);
  if (!Number.isInteger(n) || n < 1) return { batal: `Nomor minggu tidak valid: ${job.periode}` };
  return unggahLaporanPeriodik({
    locationId: job.locationId,
    kind: "mingguan",
    n,
    byId: null,
    jedaMs: JEDA_ANTAR_BERKAS_MS,
  });
}

/**
 * Satu putaran antrean: bebaskan yang menggantung → pindai → kerjakan sebagian.
 *
 * `pindai: false` dipakai pemanggil yang hanya ingin mendorong antrean yang
 * sudah ada (mis. sesudah satu finalisasi) tanpa menyapu seluruh riwayat.
 */
export async function jalankanAntreanDrive(
  opts: { now?: Date; pindai?: boolean; maksPekerjaan?: number } = {},
): Promise<HasilPutaran> {
  const now = opts.now ?? new Date();

  if (!(await getGDriveOtomatisAktif())) return putaranKosong({ aktif: false });

  // Akun belum terhubung bukan kegagalan pekerjaannya. Kalau tetap dijalankan,
  // setiap baris akan menabung satu percobaan gagal dan seluruh antrean bisa
  // MENYERAH hanya karena token belum dipasang.
  const konfig = await getGDriveConfigDisplay();
  if (!konfig.connected) return putaranKosong({ terhubung: false });

  if (sedangJalan) return putaranKosong({ berhenti: "Putaran lain sedang berjalan." });
  sedangJalan = true;
  const hasil = putaranKosong();

  try {
    await bebaskanMenggantung(now);

    if (opts.pindai !== false) {
      hasil.diantre.harian = await pindaiHarian();
      hasil.diantre.mingguan = await pindaiMingguan(now);
    }

    const baseUrl = publicOriginFromEnv();
    const mulai = Date.now();
    let berkas = 0;

    const antre = await db.gDriveJob.findMany({
      where: { status: "menunggu", nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: opts.maksPekerjaan ?? MAKS_PEKERJAAN_PER_PUTARAN,
      select: { id: true, kind: true, periode: true, locationId: true, attempts: true },
    });

    for (const job of antre) {
      if (!masihAdaJatah({ berkas, mulai, sekarang: Date.now() })) {
        hasil.berhenti = "Jatah satu putaran habis — sisanya lanjut putaran berikutnya.";
        break;
      }
      if (!(await klaim(job.id, new Date()))) continue;
      hasil.dikerjakan += 1;

      let r: Awaited<ReturnType<typeof jalankanSatu>>;
      try {
        r = await jalankanSatu(job, baseUrl);
      } catch (err) {
        r = { error: err instanceof Error ? err.message : "Gagal mengunggah." };
      }

      // Prasyarat hilang (laporan dibuka kembali, periode belum bisa disusun):
      // bukan kegagalan yang perlu ditindak orang, dan tidak boleh diulang.
      if (adalahBatal(r)) {
        hasil.batal += 1;
        await db.gDriveJob.update({
          where: { id: job.id },
          data: { status: "batal", lastError: r.batal, claimedAt: null, finishedAt: new Date() },
        });
        continue;
      }

      const galat = adalahTerhalang(r)
        ? { pesan: r.error, status: null as number | null, retryAfter: null as string | null }
        : r.galat;
      if (!adalahTerhalang(r)) berkas += r.berkas;

      if (!galat) {
        hasil.sukses += 1;
        await db.gDriveJob.update({
          where: { id: job.id },
          data: {
            status: "sukses",
            lastError: null,
            claimedAt: null,
            finishedAt: new Date(),
            attempts: job.attempts,
          },
        });
        continue;
      }

      const jenis = jenisGalat(galat.status, galat.pesan);
      const mundur = hitungMundur({
        jenis,
        attemptsSebelum: job.attempts,
        sekarang: new Date(),
        retryAfterMs: retryAfterMs(galat.retryAfter, Date.now()),
      });
      if (jenis === "laju") hasil.ditahan += 1;
      else hasil.gagal += 1;
      if (mundur.menyerah) hasil.menyerah += 1;

      await db.gDriveJob.update({
        where: { id: job.id },
        data: {
          status: mundur.menyerah ? "menyerah" : "menunggu",
          attempts: mundur.attempts,
          lastError: galat.pesan,
          nextAttemptAt: mundur.nextAttemptAt,
          claimedAt: null,
          finishedAt: mundur.menyerah ? new Date() : null,
        },
      });

      // Ditahan laju = Google sedang menyuruh berhenti. Meneruskan putaran ini
      // hanya menambah tekanan pada kuota yang sudah ditolak.
      if (jenis === "laju") {
        hasil.berhenti = "Google menahan laju — sisanya dijadwalkan mundur.";
        break;
      }
    }

    hasil.berkas = berkas;
    hasil.sisa = await db.gDriveJob.count({ where: { status: "menunggu" } });
    if (!hasil.berhenti && Date.now() - mulai >= ANGGARAN_WAKTU_MS) {
      hasil.berhenti = "Anggaran waktu satu putaran habis.";
    }
    return hasil;
  } finally {
    sedangJalan = false;
  }
}

/* ── Ringkasan untuk layar Sistem ────────────────────────────────────────── */

export type RingkasAntrean = {
  menunggu: number;
  jalan: number;
  sukses: number;
  menyerah: number;
  batal: number;
  /** Pekerjaan menyerah terbaru — yang perlu dilihat orang. */
  macet: { kind: string; periode: string; lokasi: string; error: string | null; pada: Date }[];
};

export async function ringkasAntrean(): Promise<RingkasAntrean> {
  const [grup, macet] = await Promise.all([
    db.gDriveJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.gDriveJob.findMany({
      where: { status: "menyerah" },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        kind: true,
        periode: true,
        lastError: true,
        updatedAt: true,
        location: { select: { name: true } },
      },
    }),
  ]);
  const hitung = (s: string) => grup.find((g) => g.status === s)?._count._all ?? 0;
  return {
    menunggu: hitung("menunggu"),
    jalan: hitung("jalan"),
    sukses: hitung("sukses"),
    menyerah: hitung("menyerah"),
    batal: hitung("batal"),
    macet: macet.map((m) => ({
      kind: m.kind,
      periode: m.periode,
      lokasi: m.location.name,
      error: m.lastError,
      pada: m.updatedAt,
    })),
  };
}

/** Kembalikan pekerjaan yang MENYERAH ke antrean (tombol "coba lagi"). */
export async function ulangiYangMenyerah(): Promise<number> {
  const r = await db.gDriveJob.updateMany({
    where: { status: "menyerah" },
    data: { status: "menunggu", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  return r.count;
}
