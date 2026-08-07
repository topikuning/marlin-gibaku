import "server-only";
import type { DailyReportStatus, WeatherCode, WorkerRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { formatTanggal, parseDateKey } from "@/lib/format";
import { jamTakDiketahui } from "@/lib/photo-stamp/format";
import { bobotPct } from "@/lib/progress-calc";
import { getLocationProgress } from "@/lib/progress";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "./constants";

/**
 * RANGKUMAN HARIAN per lokasi — sumber data untuk PDF ringkas yang dikirim ke
 * grup WhatsApp (DECISIONS 261).
 *
 * Permintaan user 2026-08-05: *"aku butuh format laporan harian dalam satu file
 * format pdf untuk langsung kamu kirim ke group WA … berisi rangkuman pekerjaan
 * hari ini baik pekerjaan harian maupun kegiatan lapangan, khusus di hari itu
 * beserta foto pendukungnya. summary saja, bukan format blanko kkp. per lokasi."*
 *
 * ### Bedanya dengan blanko KKP (`getKkpDailyData`)
 *
 * Blanko KKP adalah **formulir resmi**: kotaknya tetap, barisnya dicetak walau
 * kosong, dan susunannya ditentukan pemberi kerja. Yang ini **dokumen bacaan**:
 * hanya memuat yang benar-benar terjadi hari itu, dengan ringkasan kinerja di
 * muka. Keduanya sengaja hidup berdampingan — mengganti blanko dengan ringkasan
 * akan membuat setoran resmi tidak sah.
 *
 * ### Aturan angka
 *
 * TIDAK ADA formula baru di sini (CLAUDE.md butir 7). Posisi kemajuan diambil
 * dari `getLocationProgress` dengan `asOf` = tanggal laporan — supaya dokumen
 * bertanggal 1 Juli tidak memuat realisasi 20 Juli hanya karena dicetak
 * terlambat. Bobot hari ini memakai `bobotPct` dari `progress-calc`.
 *
 * Hanya baris ber-`basis: "aktif"` yang masuk angka. Baris atas usulan adendum
 * TIDAK dihitung — belum ada dasar kontraknya — tetapi JUMLAHNYA disebut, supaya
 * penghilangannya tidak diam-diam (DECISIONS 210/215).
 */

export type RingkasPekerjaan = {
  code: string;
  name: string;
  unit: string | null;
  /** Volume yang dikerjakan HARI ITU (bukan kumulatif). */
  volumeToday: number;
  /** Kontribusi nilai hari itu terhadap grand total, dalam persen. */
  bobotToday: number;
  valueToday: bigint;
  notes: string | null;
};

export type RingkasKegiatan = {
  kindLabel: string;
  title: string;
  participants: string | null;
  notes: string | null;
  kendala: string | null;
  solusi: string | null;
  isFinal: boolean;
};

export type RingkasFoto = {
  id: string;
  r2Key: string;
  /**
   * Bukti INI untuk pekerjaan apa — nama item RAB-nya, bukan label seragam.
   *
   * Dulu SELURUH foto laporan diberi judul mati "Pekerjaan harian" padahal
   * tiap foto sudah tertaut ke item RAB lewat `reportItemId`. Akibatnya
   * halaman dokumentasi berisi belasan foto berjudul sama persis, dan
   * pemeriksa PPK tidak bisa tahu foto mana membuktikan pekerjaan mana —
   * padahal itulah satu-satunya guna lampiran foto.
   */
  sumber: string;
  takenAt: Date | null;
  /**
   * Jam jepretnya TIDAK DIKETAHUI; `takenAt` cuma membawa tanggal kerjanya.
   *
   * Kolom tanggal kerja berjenis DATE = tengah malam UTC; diformat lengkap ia
   * berbunyi "07.00" WIB — angka yang tidak pernah ada di dunia nyata. Cap di
   * gambar sudah menghormati ini sejak DECISIONS 197; PDF-nya tertinggal dan
   * tetap mencetak jam palsu. Bukti yang menyebut jam yang tidak diketahui
   * lebih buruk daripada bukti yang diam soal jam.
   */
  jamTidakDiketahui: boolean;
  lat: number | null;
  lng: number | null;
  /**
   * Koordinat yang dicap BUKAN dari perangkat, melainkan titik proyek sebagai
   * cadangan. Wajib ditandai — mengakuinya sebagai bukti GPS adalah kebohongan
   * yang tidak kelihatan (DECISIONS 197).
   */
  gpsCadangan: boolean;
};

export type RingkasHarian = {
  /* Identitas */
  appName: string;
  slug: string;
  locationId: string;
  locationName: string;
  regency: string;
  province: string;
  packageName: string;
  workTitle: string | null;
  vendorName: string | null;
  /** Key R2 logo perusahaan pelaksana — kop laporan dipimpin logo MEREKA. */
  vendorLogoKey: string | null;
  contractNumber: string | null;
  dateKey: string;
  hari: string;
  tanggalFull: string;

  /* Keadaan dokumen — DICETAK, bukan disembunyikan. Tanpa gerbang status
     (keputusan user 2026-08-05), pembaca di grup pejabat harus bisa melihat
     sendiri bahwa yang ia baca belum diverifikasi. */
  status: DailyReportStatus | null;

  /* Posisi kemajuan — semuanya dari getLocationProgress(asOf) */
  weekNumber: number;
  totalWeeks: number;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  grandTotal: bigint;

  /* Hari ini */
  bobotHariIni: number;
  nilaiHariIni: bigint;
  pekerjaan: RingkasPekerjaan[];
  /** Baris berbasis draft adendum yang SENGAJA tidak dihitung. */
  draftItemCount: number;

  kegiatan: RingkasKegiatan[];

  /* Konteks kerja */
  cuaca: WeatherCode | null;
  workStart: string | null;
  workEnd: string | null;
  catatan: string | null;
  tenaga: { label: string; count: number }[];
  totalTenaga: number;
  material: { name: string; unit: string | null; qty: number | null }[];
  peralatan: { name: string; count: number }[];
  kendala: { title: string; severity: string; status: string }[];

  foto: RingkasFoto[];
  /** Foto yang ada di hari itu tapi TIDAK dimuat karena batas halaman. */
  fotoDisembunyikan: number;
};

/** Batas foto yang ditanam. Sisanya disebut jumlahnya, tidak dihilangkan diam-diam. */
export const MAKS_FOTO_RINGKAS = 12;

/**
 * Kumpulkan rangkuman satu lokasi untuk satu hari.
 *
 * Mengembalikan null bila lokasinya tidak ada. Laporan harian yang BELUM DIBUAT
 * tetap menghasilkan dokumen: kegiatan lapangan hari itu bisa saja ada, dan
 * "belum ada laporan harian" adalah keterangan yang berguna — bukan alasan
 * menolak mencetak.
 */
export async function getRingkasHarian(
  slug: string,
  dateKey: string,
): Promise<RingkasHarian | null> {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return null;

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      package: {
        select: {
          name: true,
          candidateVendorName: true,
          contract: {
            select: {
              workTitle: true,
              contractNumber: true,
              vendor: { select: { name: true, logoKey: true } },
            },
          },
        },
      },
    },
  });
  if (!location) return null;

  const [branding, kindLabels, progress, report, kegiatanRows] = await Promise.all([
    getBranding(),
    getActivityKindLabelMap(),
    // `asOf` = tanggal laporan. Tanpa ini, dokumen bertanggal 1 Juli yang
    // dicetak 20 Juli akan menampilkan posisi 20 Juli (CALC-01).
    getLocationProgress(location.id, { asOf: reportDate }),
    db.dailyReport.findUnique({
      where: { locationId_reportDate: { locationId: location.id, reportDate } },
      select: {
        status: true,
        weather: true,
        workStart: true,
        workEnd: true,
        notes: true,
        workers: { select: { role: true, count: true } },
        materials: { select: { name: true, unit: true, qtyReceived: true } },
        equipment: { select: { name: true, count: true } },
        issues: { select: { title: true, severity: true, status: true } },
        items: {
          select: {
            basis: true,
            volumeDone: true,
            valueDone: true,
            notes: true,
            rabNode: { select: { code: true, name: true, unit: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        photos: {
          select: {
            id: true,
            r2Key: true,
            exifTakenAt: true,
            exifGpsLat: true,
            exifGpsLng: true,
            gpsSource: true,
            metadataSource: true,
            // Foto SUDAH tertaut ke item RAB-nya; judulnya tinggal dibaca dari
            // sini, tidak perlu ditebak dan tidak boleh diseragamkan.
            reportItem: { select: { rabNode: { select: { code: true, name: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.fieldActivity.findMany({
      where: { locationId: location.id, activityDate: reportDate },
      select: {
        type: true,
        title: true,
        participants: true,
        notes: true,
        kendala: true,
        solusi: true,
        status: true,
        photos: {
          select: {
            id: true,
            r2Key: true,
            exifTakenAt: true,
            exifGpsLat: true,
            exifGpsLng: true,
            gpsSource: true,
            metadataSource: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Hanya basis `aktif` yang masuk angka resmi (DECISIONS 210).
  const semuaItem = report?.items ?? [];
  const itemAktif = semuaItem.filter((i) => i.basis === "aktif");
  const nilaiHariIni = itemAktif.reduce((s, i) => s + i.valueDone, 0n);
  const grandTotal = progress?.grandTotal ?? 0n;

  const pekerjaan: RingkasPekerjaan[] = itemAktif.map((i) => ({
    code: i.rabNode.code,
    name: i.rabNode.name,
    unit: i.rabNode.unit,
    volumeToday: Number(i.volumeDone),
    // Formula bobot dari progress-calc — tidak dihitung ulang di sini.
    bobotToday: bobotPct(Number(i.valueDone), Number(grandTotal)),
    valueToday: i.valueDone,
    notes: i.notes,
  }));

  const perRole = new Map<WorkerRole, number>();
  for (const w of report?.workers ?? []) {
    perRole.set(w.role, (perRole.get(w.role) ?? 0) + w.count);
  }
  const tenaga = WORKER_ROLE_ORDER.filter((r) => (perRole.get(r) ?? 0) > 0).map((r) => ({
    label: WORKER_ROLE_LABEL[r],
    count: perRole.get(r)!,
  }));

  const kegiatan: RingkasKegiatan[] = kegiatanRows.map((k) => ({
    kindLabel: kindLabels.get(k.type) ?? k.type,
    title: k.title,
    participants: k.participants,
    notes: k.notes,
    kendala: k.kendala,
    solusi: k.solusi,
    isFinal: k.status === "final",
  }));

  // Foto laporan lebih dulu, lalu foto kegiatan — urutan bacaan yang sama
  // dengan urutan bagian di dokumennya.
  const semuaFoto: RingkasFoto[] = [
    ...(report?.photos ?? []).map((p) => {
      const node = p.reportItem?.rabNode;
      return {
        id: p.id,
        r2Key: p.r2Key,
        // Nama pekerjaan yang SEBENARNYA. "Pekerjaan harian" hanya tersisa
        // untuk foto yang memang tidak tertaut item mana pun — di sana label
        // umum itu jujur, sedangkan menebak pekerjaannya tidak.
        sumber: node ? [node.code, node.name].filter(Boolean).join(" · ") : "Pekerjaan harian",
        takenAt: p.exifTakenAt,
        jamTidakDiketahui: jamTakDiketahui(p.metadataSource, p.exifTakenAt),
        lat: p.exifGpsLat != null ? Number(p.exifGpsLat) : null,
        lng: p.exifGpsLng != null ? Number(p.exifGpsLng) : null,
        gpsCadangan: p.gpsSource === "project",
      };
    }),
    ...kegiatanRows.flatMap((k) =>
      k.photos.map((p) => ({
        id: p.id,
        r2Key: p.r2Key,
        sumber: `Kegiatan: ${k.title}`,
        takenAt: p.exifTakenAt,
        jamTidakDiketahui: jamTakDiketahui(p.metadataSource, p.exifTakenAt),
        lat: p.exifGpsLat != null ? Number(p.exifGpsLat) : null,
        lng: p.exifGpsLng != null ? Number(p.exifGpsLng) : null,
        gpsCadangan: p.gpsSource === "project",
      })),
    ),
  ];

  return {
    appName: branding.appName,
    slug,
    locationId: location.id,
    locationName: location.name,
    regency: location.regency,
    province: location.province,
    packageName: location.package.name,
    workTitle: location.package.contract?.workTitle?.trim() || null,
    vendorName:
      location.package.contract?.vendor?.name?.trim() ||
      location.package.candidateVendorName?.trim() ||
      null,
    vendorLogoKey: location.package.contract?.vendor?.logoKey ?? null,
    contractNumber: location.package.contract?.contractNumber ?? null,
    dateKey,
    hari: formatTanggal(reportDate, "EEEE"),
    tanggalFull: formatTanggal(reportDate, "d MMMM yyyy"),

    status: report?.status ?? null,

    weekNumber: progress?.weekNumber ?? 0,
    totalWeeks: progress?.totalWeeks ?? 0,
    realizedPct: progress?.realizedPct ?? 0,
    planPct: progress?.planPct ?? 0,
    deviationPct: progress?.deviationPct ?? 0,
    grandTotal,

    bobotHariIni: bobotPct(Number(nilaiHariIni), Number(grandTotal)),
    nilaiHariIni,
    pekerjaan,
    draftItemCount: semuaItem.length - itemAktif.length,

    kegiatan,

    cuaca: report?.weather ?? null,
    workStart: report?.workStart ?? null,
    workEnd: report?.workEnd ?? null,
    catatan: report?.notes ?? null,
    tenaga,
    totalTenaga: [...perRole.values()].reduce((s, n) => s + n, 0),
    material: (report?.materials ?? []).map((m) => ({
      name: m.name,
      unit: m.unit,
      qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
    })),
    peralatan: (report?.equipment ?? []).map((e) => ({ name: e.name, count: e.count })),
    kendala: (report?.issues ?? []).map((i) => ({
      title: i.title,
      severity: i.severity,
      status: i.status,
    })),

    foto: semuaFoto.slice(0, MAKS_FOTO_RINGKAS),
    fotoDisembunyikan: Math.max(0, semuaFoto.length - MAKS_FOTO_RINGKAS),
  };
}
