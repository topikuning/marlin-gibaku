import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { Prisma } from "@/generated/prisma/client";
import {
  DailyReportError,
  alasanTakBolehFinalkan,
  buildFinalSnapshot,
  finalizeReport,
  unfinalizeReport,
} from "./service";
import {
  periksaPindah,
  rentangSnapshotBasi,
  ringkasAkibatFoto,
  type AkibatFoto,
} from "./pindah-tanggal";

/**
 * PINDAH TANGGAL LAPORAN HARIAN (DECISIONS 415) — pelaksananya.
 *
 * Aturan murninya di `pindah-tanggal.ts`; di sini urusan basis data dan akibat
 * yang harus ikut dibereskan. Otorisasi TIDAK di sini (pola file service):
 * pemanggil di `actions.ts` yang menggerbang `daily_report.move_date` +
 * `requireLocationAccess`.
 */

export type HasilPindah = {
  dari: string;
  ke: string;
  /** Laporan final dibuka & difinalkan ulang otomatis (pilihan user 2026-08-22). */
  lewatFinal: boolean;
  /** Cuaca otomatis dibuang – lihat alasannya di bawah. */
  cuacaDibuang: boolean;
  /** Penanda "sudah dikirim WA" dilepas – lihat alasannya di bawah. */
  waDilepas: boolean;
  foto: AkibatFoto;
  /** Laporan final LAIN yang snapshot cetaknya ikut dihitung ulang. */
  snapshotDibangunUlang: number;
};

/**
 * Pindahkan satu laporan harian ke tanggal lain.
 *
 * ### Yang ikut dibereskan, dan kenapa
 *
 * **Cuaca dibuang.** `weatherHourly` diambil mesin UNTUK TANGGAL ITU. Cuaca 21
 * Juli bukan fakta tentang 22 Juli, siapa pun yang mencatatnya, dan membiarkan
 * angka hujan per jam ikut pindah berarti MARLIN menyimpan bacaan alat tentang
 * hari yang salah — lalu memakainya untuk menghitung "berapa hari hujan", dasar
 * klaim perpanjangan waktu. Dibuang, dan dikatakan, supaya diambil ulang.
 *
 * **Penanda WA dilepas.** `waSentAt` berarti "laporan ini sudah diserahkan".
 * Yang terlanjur terkirim ke grup bertanggal LAMA, jadi sesudah pindah kalimat
 * itu tidak lagi benar. Kalau penandanya dibiarkan, laporan ini hilang dari
 * hitungan "belum dikirim" dan tidak akan pernah dikirim ulang oleh siapa pun.
 * Nilai lamanya disimpan di jejak audit, jadi fakta bahwa pengiriman pernah
 * terjadi tidak hilang — yang dilepas hanya klaim bahwa laporan INI sudah
 * diserahkan.
 *
 * **Cap foto TIDAK dicap ulang otomatis.** Hanya dihitung dan dilaporkan.
 * Mengecap ulang menulis bukti: butuh berkas asli yang diarsipkan, dan sudah
 * punya layarnya sendiri dengan alasan + riwayat revisi (DECISIONS 198).
 * Menjalankannya diam-diam sebagai efek samping pindah tanggal adalah cara
 * paling mudah membuat bukti berubah tanpa ada yang memutuskan.
 */
export async function pindahTanggalLaporan(input: {
  reportId: string;
  tanggalBaru: string;
  alasan: string;
  userId: string;
}): Promise<HasilPindah> {
  const alasan = input.alasan.trim();
  if (alasan.length < 10) {
    throw new DailyReportError("Alasan pemindahan wajib diisi (minimal 10 karakter).");
  }

  const report = await db.dailyReport.findUnique({
    where: { id: input.reportId },
    select: {
      id: true,
      locationId: true,
      reportDate: true,
      status: true,
      waSentAt: true,
      weatherHourly: true,
      weatherSource: true,
    },
  });
  if (!report) throw new DailyReportError("Laporan tidak ditemukan");

  const lama = jakartaDateKey(report.reportDate);
  const baru = input.tanggalBaru.trim();
  const tanggalBaru = parseDateKey(baru);

  const bentrok = tanggalBaru
    ? await db.dailyReport.findUnique({
        where: { locationId_reportDate: { locationId: report.locationId, reportDate: tanggalBaru } },
        select: { id: true },
      })
    : null;

  const tolak = periksaPindah({
    lama,
    baru,
    hariIni: jakartaDateKey(new Date()),
    adaDiTujuan: !!bentrok,
  });
  if (tolak || !tanggalBaru) {
    throw new DailyReportError(tolak?.pesan ?? "Tanggal tujuan tidak valid.");
  }

  /*
   * Rentang basi dihitung SEBELUM apa pun berubah — sesudah laporan pindah,
   * tanggal lamanya sudah tidak ada lagi di baris mana pun.
   */
  const basi = rentangSnapshotBasi({ lama, baru, status: report.status });

  const fotoLaporan = await db.photo.findMany({
    where: { reportId: report.id },
    select: { exifTakenAt: true, originalKey: true, originalPurgedAt: true },
  });
  const foto = ringkasAkibatFoto(fotoLaporan);

  /*
   * Laporan final dibuka dulu, dipindah, lalu difinalkan lagi (pilihan user
   * 2026-08-22). Snapshot cetaknya dengan begitu dibangun ULANG di tanggal yang
   * baru — termasuk nomor minggu dan angka kumulatif "s/d", yang dua-duanya
   * ikut berubah. Memindahkan laporan final tanpa langkah ini akan menyisakan
   * dokumen beku yang menyebut tanggal lama.
   */
  const lewatFinal = report.status === "final";
  if (lewatFinal) {
    /*
     * Pemisahan tugas diperiksa SEBELUM kuncinya dibuka, bukan saat memfinalkan
     * ulang. Kalau diperiksa belakangan, penolakannya datang ketika laporan
     * sudah terbuka DAN sudah pindah — tertinggal separuh jadi di tanggal baru,
     * dengan pesan yang seolah-olah cuma soal finalisasi. Diperiksa di sini,
     * pemindahannya batal utuh dan tidak ada yang berubah.
     */
    const terhalang = await alasanTakBolehFinalkan(report.id, input.userId);
    if (terhalang) {
      throw new DailyReportError(
        `Laporan final ini tidak bisa dipindah olehmu: ${terhalang} ` +
          "Pemindahan dibatalkan – tidak ada yang berubah.",
      );
    }
    await unfinalizeReport(report.id, input.userId, `Pindah tanggal: ${alasan}`);
  }

  const cuacaDibuang = report.weatherHourly != null || report.weatherSource != null;
  const waDilepas = report.waSentAt != null;

  await db.dailyReport.update({
    where: { id: report.id },
    data: {
      reportDate: tanggalBaru,
      weather: null,
      weatherHourly: Prisma.DbNull,
      weatherSource: null,
      weatherFetchedAt: null,
      waSentAt: null,
      waSentById: null,
    },
  });

  if (lewatFinal) {
    await finalizeReport(report.id, input.userId);
  }

  /*
   * Snapshot laporan final LAIN yang ikut bergeser, dibangun ulang dengan
   * fungsi yang sama yang dipakai perbaikan snapshot di menu Sistem
   * (DECISIONS 148) — bukan jalur baru. Dibiarkan basi berarti MARLIN sengaja
   * mencetak angka kumulatif yang ia tahu salah.
   */
  let snapshotDibangunUlang = 0;
  if (basi) {
    const terdampak = await db.dailyReport.findMany({
      where: {
        locationId: report.locationId,
        status: "final",
        id: { not: report.id },
        reportDate: { gte: parseDateKey(basi.dari)!, lt: parseDateKey(basi.sampaiSebelum)! },
      },
      orderBy: { reportDate: "asc" },
      select: { id: true },
    });
    for (const r of terdampak) {
      try {
        const snapshot = await buildFinalSnapshot(r.id);
        await db.dailyReport.update({
          where: { id: r.id },
          data: { finalSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
        snapshotDibangunUlang++;
      } catch {
        /* satu snapshot gagal tidak boleh membatalkan pemindahan yang sudah jadi */
      }
    }
  }

  await audit(input.userId, "daily_report.move_date", "daily_report", report.id, {
    dari: lama,
    ke: baru,
    alasan,
    status: report.status,
    lewatFinal,
    cuacaDibuang,
    // Nilai lama disimpan di sini supaya fakta "pernah dikirim WA" tidak hilang
    // bersama penandanya.
    waSentAtSebelumnya: report.waSentAt?.toISOString() ?? null,
    fotoPerluCapUlang: foto.perluCapUlang,
    fotoTakBisaDiperbaiki: foto.takBisaDiperbaiki,
    snapshotDibangunUlang,
  });

  return {
    dari: lama,
    ke: baru,
    lewatFinal,
    cuacaDibuang,
    waDilepas,
    foto,
    snapshotDibangunUlang,
  };
}
