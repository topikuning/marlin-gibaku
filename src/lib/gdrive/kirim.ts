import "server-only";
import { db } from "@/lib/db";
import {
  dailyPhotoPath,
  dailyReportPath,
  periodReportPath,
  safeFileName,
} from "./folders";
import { photoItems, summarize, uploadBatch, type UploadTarget } from "./upload";
import type { UploadOutcome } from "./parse";
import type { PeriodKind } from "@/lib/periodic-report";

/**
 * INTI unggah laporan ke Drive KKP — dipakai DUA jalur: tombol manual (server
 * action, dengan sesi & capability) dan antrean otomatis (penjadwal, tanpa
 * sesi). DECISIONS 313.
 *
 * Keduanya memanggil fungsi yang SAMA supaya isi yang naik ke folder KKP tidak
 * pernah bisa berbeda antara yang ditekan orang dan yang berjalan sendiri —
 * pola yang sama dengan laporan mingguan WhatsApp (DECISIONS 311). Kalau
 * otomatis menaruh PDF saja sementara tombol menaruh PDF + foto, folder KKP
 * jadi berisi dua macam "laporan harian" yang berbeda isi tanpa ada yang bisa
 * menjelaskan kenapa.
 *
 * Otorisasi TIDAK ada di sini. Jalur manual wajib `requireCapability` +
 * `requireLocationAccess` sebelum memanggil; jalur otomatis memang berjalan
 * sebagai sistem.
 */

export const PDF_MIME = "application/pdf";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type KonteksUnggah = { target: UploadTarget; locationName: string; slug: string };

/** Rincian galat pertama sebuah unggahan — dipakai antrean untuk menggolongkan. */
export type GalatUnggah = { pesan: string; status: number | null; retryAfter: string | null };

export type HasilUnggah = {
  /** Kalimat siap tampil ("Laporan harian: 1 file baru, 8 file diperbarui…"). */
  ringkas: string;
  outcomes: UploadOutcome[];
  /** Berkas yang benar-benar dicoba — dipakai anggaran laju satu putaran. */
  berkas: number;
  /** Foto yang tak terbaca dari R2 dan dilewati. */
  skipped: number;
  galat: GalatUnggah | null;
};

/** Prasyaratnya hilang (laporan dibuka kembali, periode di luar kontrak, dst). */
export type TidakBerlaku = { batal: string };

/** Prasyarat teknis belum siap (lokasi/folder) — bukan kesalahan isi laporan. */
export type Terhalang = { error: string };

export function adalahBatal(v: unknown): v is TidakBerlaku {
  return typeof v === "object" && v !== null && "batal" in v;
}

export function adalahTerhalang(v: unknown): v is Terhalang {
  return typeof v === "object" && v !== null && "error" in v;
}

/** Rangkum beberapa batch jadi satu hasil + galat pertamanya. */
function rangkum(label: string, outcomes: UploadOutcome[], skipped: number): HasilUnggah {
  const gagal = outcomes.find((o) => o.firstError);
  return {
    ringkas: summarize(label, outcomes, skipped),
    outcomes,
    berkas: outcomes.reduce((s, o) => s + o.ok + o.failed, 0),
    skipped,
    galat: gagal
      ? {
          pesan: gagal.firstError!,
          status: gagal.firstErrorStatus ?? null,
          retryAfter: gagal.firstRetryAfter ?? null,
        }
      : null,
  };
}

/**
 * Resolusi lokasi + folder Drive paket. TANPA guard akses — pemanggil manual
 * yang wajib memasangnya (lihat catatan di kepala berkas).
 */
export async function konteksUnggah(
  by: { slug?: string; locationId?: string },
  kind: UploadTarget["kind"],
  refKey: string,
  byId: string | null,
): Promise<KonteksUnggah | Terhalang> {
  const loc = await db.location.findFirst({
    where: by.slug ? { slug: by.slug } : { id: by.locationId },
    select: {
      id: true,
      slug: true,
      name: true,
      package: { select: { id: true, driveFolderId: true } },
    },
  });
  if (!loc) return { error: "Lokasi tidak ditemukan." };
  if (!loc.package.driveFolderId)
    return { error: "Paket ini belum punya folder Google Drive – atur di halaman paket." };
  return {
    locationName: loc.name,
    slug: loc.slug,
    target: {
      packageId: loc.package.id,
      locationId: loc.id,
      rootFolderId: loc.package.driveFolderId,
      kind,
      refKey,
      byId: byId ?? "",
    },
  };
}

/** refKey laporan harian — SAMA di `GDriveJob` dan `GDriveUpload`. */
export function refKeyHarian(slug: string, dateKey: string): string {
  return `${slug}:${dateKey}`;
}

/** refKey laporan periodik KKP per lokasi. */
export function refKeyPeriodik(kind: PeriodKind, locationId: string, n: number): string {
  return `${locationId}:${kind}-${n}`;
}

/**
 * Laporan harian → "3. LAPORAN HARIAN/<Lokasi>/<bulan>": PDF blanko KKP + semua
 * fotonya di subfolder "Foto". DECISIONS 145.
 *
 * `wajibFinal` dipakai jalur OTOMATIS: antrean bisa saja baru sempat menaikkan
 * laporan beberapa jam setelah difinalisasi, dan dalam sela itu laporannya bisa
 * dibuka kembali untuk dikoreksi (DECISIONS 149). Menaikkan angka yang sudah
 * dicabut ke folder pemberi kerja lebih buruk daripada terlambat, jadi statusnya
 * diperiksa ULANG tepat sebelum naik — bukan hanya saat diantre.
 */
export async function unggahLaporanHarian(input: {
  slug: string;
  dateKey: string;
  byId: string | null;
  baseUrl: string | null;
  jedaMs?: number;
  wajibFinal?: boolean;
}): Promise<HasilUnggah | Terhalang | TidakBerlaku> {
  const { slug, dateKey } = input;
  const c = await konteksUnggah({ slug }, "laporan_harian", refKeyHarian(slug, dateKey), input.byId);
  if (adalahTerhalang(c)) return c;

  const report = await db.dailyReport.findUnique({
    where: {
      locationId_reportDate: {
        locationId: c.target.locationId!,
        reportDate: new Date(`${dateKey}T00:00:00.000Z`),
      },
    },
    select: { status: true, photos: { select: { r2Key: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!report) return { batal: "Laporan harian tidak ditemukan." };
  if (input.wajibFinal && report.status !== "final") {
    return { batal: `Laporan tidak lagi berstatus final (sekarang: ${report.status}).` };
  }

  const { renderHarianKkpPdf } = await import("@/lib/pdf/harian-kkp");
  const pdf = await renderHarianKkpPdf(slug, dateKey, { baseUrl: input.baseUrl });
  if (!pdf) return { batal: "Laporan harian tidak bisa dirender." };

  const jedaMs = input.jedaMs;
  const outcomes = [
    await uploadBatch(
      c.target,
      dailyReportPath({ locationName: c.locationName, dateKey }),
      [
        {
          fileName: safeFileName(`Laporan Harian - ${c.locationName} - ${dateKey}.pdf`),
          mime: PDF_MIME,
          data: pdf.buffer,
        },
      ],
      { jedaMs },
    ),
  ];

  let skipped = 0;
  if (report.photos.length > 0) {
    const got = await photoItems(report.photos, { dateKey, locationName: c.locationName });
    skipped = got.skipped;
    outcomes.push(
      await uploadBatch(
        c.target,
        dailyPhotoPath({ locationName: c.locationName, dateKey }),
        got.items,
        { jedaMs },
      ),
    );
  }
  return rangkum("Laporan harian", outcomes, skipped);
}

/**
 * Laporan periodik KKP satu lokasi → "4./5. …/<Lokasi>": PDF blanko resmi +
 * Excel. PDF-nya WAJIB blanko KKP (halaman kurva-S + rincian), sama dengan yang
 * keluar dari layar cetak — bukan ringkasan yang dipakai kiriman WhatsApp
 * (DECISIONS 161).
 *
 * Yang diunggah OTOMATIS hanya `mingguan` (DECISIONS 313); `bulanan` tetap
 * lewat tombol, dan memakai fungsi yang sama ini.
 */
/**
 * BERKAS MINGGUAN (sampul + tujuh laporan harian) ke Drive — DECISIONS 335.
 *
 * Metodenya sama persis dengan laporan periodik; yang berbeda hanya berkasnya.
 * Karena itu ia memakai `konteksUnggah` + `uploadBatch` yang sama, dan tidak
 * ada satu pun jalur unggah baru.
 *
 * Dua hal yang SENGAJA dibedakan:
 *
 * 1. `refKey` berbeda dari laporan mingguan periodik. Keduanya "mingguan
 *    ke-n" untuk lokasi yang sama, dan refKey itulah kunci idempotensi
 *    unggahannya — kalau disamakan, mengunggah salah satu akan terbaca sebagai
 *    unggahan yang lain sudah selesai.
 * 2. Namanya diawali "Laporan Harian" karena isinya memang tujuh laporan
 *    HARIAN, bukan laporan mingguan. Menaruh dua berkas berbeda dengan nama
 *    mirip di satu folder adalah cara tercepat membuat orang mengirim yang
 *    salah ke PPK.
 */
export async function unggahBerkasMingguan(input: {
  locationId: string;
  minggu: number;
  byId: string | null;
  jedaMs?: number;
}): Promise<HasilUnggah | Terhalang | TidakBerlaku> {
  const { locationId, minggu } = input;
  const c = await konteksUnggah(
    { locationId },
    "laporan_mingguan",
    `${locationId}:berkas-harian-minggu-${minggu}`,
    input.byId,
  );
  if (adalahTerhalang(c)) return c;

  const { renderMingguanKkpPdf } = await import("@/lib/pdf/mingguan-kkp");
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { slug: true } });
  if (!loc) return { batal: "Lokasi tidak ditemukan." };

  const hasil = await renderMingguanKkpPdf(loc.slug, minggu);
  if (!hasil) {
    return { batal: `Berkas mingguan ke-${minggu} belum bisa disusun – lokasi ini belum punya tanggal SPMK.` };
  }

  const nama = safeFileName(`Laporan Harian Minggu ke-${minggu} - ${c.locationName}.pdf`);
  const outcome = await uploadBatch(
    c.target,
    periodReportPath("mingguan", c.locationName),
    [{ fileName: nama, mime: PDF_MIME, data: hasil.buffer }],
    { jedaMs: input.jedaMs },
  );
  return rangkum(`Berkas harian minggu ke-${minggu}`, [outcome], 0);
}

export async function unggahLaporanPeriodik(input: {
  locationId: string;
  kind: PeriodKind;
  n: number;
  byId: string | null;
  jedaMs?: number;
}): Promise<HasilUnggah | Terhalang | TidakBerlaku> {
  const { locationId, kind, n } = input;
  const c = await konteksUnggah(
    { locationId },
    kind === "mingguan" ? "laporan_mingguan" : "laporan_bulanan",
    refKeyPeriodik(kind, locationId, n),
    input.byId,
  );
  if (adalahTerhalang(c)) return c;

  const [{ renderPeriodikKkpPdf }, { getPeriodReport }, { buildPeriodReportXlsx }, { muatLogoLaporan }] =
    await Promise.all([
      import("@/lib/pdf/periodik-kkp"),
      import("@/lib/periodic-report"),
      import("@/lib/export/xlsx"),
      import("@/lib/export/logo-laporan"),
    ]);
  const [pdf, report] = await Promise.all([
    renderPeriodikKkpPdf(locationId, kind, n),
    getPeriodReport(locationId, kind, n),
  ]);
  const label = kind === "mingguan" ? `Minggu ke-${n}` : `Bulan ke-${n}`;
  if (!pdf || !report) return { batal: `Laporan ${kind} ${label} belum bisa disusun.` };
  const xlsx = await buildPeriodReportXlsx(report, { logo: await muatLogoLaporan(locationId) });

  const namaJenis = kind === "mingguan" ? "Mingguan" : "Bulanan";
  const base = `Laporan ${namaJenis} ${label} - ${c.locationName}`;
  const outcome = await uploadBatch(
    c.target,
    periodReportPath(kind, c.locationName),
    [
      { fileName: safeFileName(`${base}.pdf`), mime: PDF_MIME, data: pdf.buffer },
      { fileName: safeFileName(`${base}.xlsx`), mime: XLSX_MIME, data: xlsx },
    ],
    { jedaMs: input.jedaMs },
  );
  return rangkum(`Laporan ${kind} ${label}`, [outcome], 0);
}
