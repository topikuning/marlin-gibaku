import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * RESET LAPORAN HARIAN SATU LOKASI (DECISIONS 630).
 *
 * Permintaan user 2026-09-29: *"aku ingin satu fitur yang bisa menghapus semua
 * laporan harian dari satu lokasi, dan hanya ada di superadmin utama. jadi
 * semua foto dan data (otomatis progress) dari inputan harian di lokasi itu,
 * direset (data dihapus dan foto yang bertagging dihapus total)"*. Cakupan
 * yang dipilih user:
 *
 * - **Foto**: semua foto laporan harian (item, material, alat) + Foto Cepat
 *   lokasi itu yang belum dipasang ke laporan. Foto Kegiatan Lapangan TIDAK.
 * - **Temuan, verifikasi Wakil PPK, dan kendala** yang menempel ke
 *   laporan-laporan itu IKUT dihapus.
 *
 * Progres tidak perlu disentuh: ia TURUNAN dari item laporan harian
 * (prinsip 4), jadi kembali ke nol dengan sendirinya. RAB, baseline, kurva-S
 * rencana, keuangan, kegiatan lapangan, dan temuan yang tidak menempel ke
 * laporan tetap ada. Jejak audit TIDAK dihapus – reset itu sendiri dicatat.
 *
 * Berkas foto dihapus TOTAL: versi ber-cap, thumbnail, berkas asli di R2, dan
 * salinan berkas asli di arsip dingin. Berkas cap revisi lama yang tak lagi
 * dirujuk dibersihkan audit R2 (DECISIONS 620).
 */

export type RingkasResetHarian = {
  laporan: number;
  /** Foto yang menempel ke laporan harian. */
  fotoLaporan: number;
  /** Foto Cepat lokasi itu yang belum dipasang ke laporan. */
  fotoCepat: number;
  temuan: number;
  verifikasi: number;
  kendala: number;
  /** Tanggal laporan pertama & terakhir (YYYY-MM-DD), null bila tidak ada laporan. */
  dari: string | null;
  sampai: string | null;
};

export type HasilResetHarian = RingkasResetHarian & {
  /** Objek R2 yang gagal dihapus – dibersihkan audit R2 belakangan. */
  berkasGagal: number;
  /** Berkas asli di arsip dingin yang gagal dihapus. */
  arsipGagal: number;
};

const tgl = (d: Date | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function sasaran(locationId: string) {
  const laporan = await db.dailyReport.findMany({
    where: { locationId },
    select: { id: true, reportDate: true },
    orderBy: { reportDate: "asc" },
  });
  const ids = laporan.map((l) => l.id);
  const menempel: Prisma.PhotoWhereInput = {
    OR: [
      { reportId: { in: ids } },
      { reportItem: { reportId: { in: ids } } },
      { reportMaterial: { reportId: { in: ids } } },
      { reportEquipment: { reportId: { in: ids } } },
    ],
  };
  // Foto Cepat: foto lokasi itu tanpa induk apa pun (bukan laporan, bukan kegiatan).
  const cepat: Prisma.PhotoWhereInput = {
    locationId,
    reportId: null,
    reportItemId: null,
    reportMaterialId: null,
    reportEquipmentId: null,
    activityId: null,
  };
  return { laporan, ids, menempel, cepat };
}

export async function ringkasResetHarian(locationId: string): Promise<RingkasResetHarian> {
  const { laporan, ids, menempel, cepat } = await sasaran(locationId);
  const [fotoLaporan, fotoCepat, temuan, verifikasi, kendala] = await Promise.all([
    db.photo.count({ where: menempel }),
    db.photo.count({ where: cepat }),
    db.finding.count({ where: { reportId: { in: ids } } }),
    db.reportVerification.count({ where: { reportId: { in: ids } } }),
    db.issue.count({ where: { reportId: { in: ids } } }),
  ]);
  return {
    laporan: laporan.length,
    fotoLaporan,
    fotoCepat,
    temuan,
    verifikasi,
    kendala,
    dari: tgl(laporan[0]?.reportDate),
    sampai: tgl(laporan.at(-1)?.reportDate),
  };
}

/** Hapus seluruh laporan harian lokasi ini beserta semua yang menempel. */
export async function resetHarianLokasi(locationId: string): Promise<HasilResetHarian> {
  const ringkas = await ringkasResetHarian(locationId);
  const { ids, menempel, cepat } = await sasaran(locationId);
  const foto = await db.photo.findMany({
    where: { OR: [menempel, cepat] },
    select: { id: true, r2Key: true, thumbnailKey: true, originalKey: true, originalArchivedAt: true, sha256: true },
  });
  const idFoto = foto.map((f) => f.id);
  const idTemuan = (await db.finding.findMany({ where: { reportId: { in: ids } }, select: { id: true } })).map(
    (f) => f.id,
  );
  const idKendala = (await db.issue.findMany({ where: { reportId: { in: ids } }, select: { id: true } })).map(
    (i) => i.id,
  );

  /*
   * Urutan mengikuti kunci asing: yang merujuk dihapus lebih dulu. Riwayat
   * status laporan, riwayat status temuan, dan verifikasi append-only – mereka
   * TIDAK dihapus langsung, melainkan ikut terhapus bersama induknya (CASCADE +
   * pengaman "hanya bila induknya sudah tiada", migrasi 20260929110000).
   */
  await db.$transaction(
    async (tx) => {
      await tx.evidenceLink.deleteMany({
        where: { OR: [{ photoId: { in: idFoto } }, { findingId: { in: idTemuan } }] },
      });
      await tx.finding.deleteMany({ where: { id: { in: idTemuan } } });
      // Kendala lain yang pernah DIGABUNG ke kendala yang dihapus dilepas, tidak ikut hilang.
      await tx.issue.updateMany({
        where: { mergedIntoId: { in: idKendala }, id: { notIn: idKendala } },
        data: { mergedIntoId: null },
      });
      await tx.issue.updateMany({ where: { id: { in: idKendala } }, data: { mergedIntoId: null } });
      await tx.issue.deleteMany({ where: { id: { in: idKendala } } });
      await tx.photo.deleteMany({ where: { id: { in: idFoto } } });
      await tx.dailyReport.deleteMany({ where: { id: { in: ids } } });
    },
    { timeout: 120_000 },
  );

  // Berkas di R2 – sesudah baris terhapus: kegagalan di sini hanya menyisakan
  // berkas yatim (dibersihkan audit R2), tidak pernah baris tanpa berkas.
  let berkasGagal = 0;
  const kunci = foto.flatMap((f) => [f.r2Key, f.thumbnailKey, f.originalKey]).filter((k): k is string => !!k);
  const { isR2Configured, r2HapusBanyak } = await import("@/lib/r2");
  if (kunci.length > 0 && isR2Configured()) {
    berkasGagal = (await r2HapusBanyak([...new Set(kunci)])).gagal.length;
  }

  // Salinan berkas asli di arsip dingin.
  let arsipGagal = 0;
  const terarsip = foto.filter((f) => f.originalArchivedAt && f.originalKey);
  if (terarsip.length > 0) {
    const { setelanDingin, hapusDingin } = await import("@/lib/arsip-asli/dingin");
    const setelan = setelanDingin();
    if (!setelan) arsipGagal = terarsip.length;
    else
      for (const f of terarsip) {
        await hapusDingin(setelan, f.originalKey!, f.sha256.toLowerCase()).catch(() => {
          arsipGagal++;
        });
      }
  }

  return { ...ringkas, berkasGagal, arsipGagal };
}
