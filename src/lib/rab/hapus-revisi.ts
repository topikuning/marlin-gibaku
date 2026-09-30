import "server-only";
import { db } from "@/lib/db";
import { valueDone as hitungNilai } from "@/lib/money";
import { sesuaikanRealisasiKeVolumeBaru } from "@/lib/rab/import";

/**
 * HAPUS REVISI RAB KELIRU (DECISIONS 636).
 *
 * Permintaan user 2026-09-30: adendum yang terlanjur diaktifkan padahal bukan
 * adendum yang benar dihapus dari riwayat lokasi – *"ini penting untuk nanti
 * memastikan historynya clear"* – supaya perbandingan RAB aktif dengan RAB
 * sebelumnya tidak membandingkan dengan kekeliruan. Hanya super admin UTAMA.
 *
 * Keputusan user (2026-09-30):
 * - **Hapus total**: revisi, itemnya, persetujuannya, dan kurva-S yang lahir
 *   darinya. Ringkasannya ke audit.
 * - **Laporan harian dipindah**: baris laporan yang menunjuk item revisi ini
 *   dipindah ke item BERKODE SAMA (lineageKey) di revisi yang menggantikannya.
 *   Volume & isi laporan tidak disentuh. Item tanpa padanan → DITOLAK.
 * - **Pemangkasan dikembalikan, lalu dicek ulang**: aktivasi revisi keliru
 *   memangkas volume laporan yang melebihi volume barunya (tercatat per baris
 *   di audit `rab.adendum_sesuaikan_realisasi`). Baris yang volumenya MASIH
 *   sama dengan hasil pangkasan dikembalikan ke angka sebelum dipangkas, lalu
 *   batas volume RAB aktif diterapkan ulang dengan fungsi yang sama dengan
 *   aktivasi – tidak ada rumus baru.
 * - **CCO ditolak**: revisi yang sudah dicatat sebagai CCO/adendum kontrak
 *   tidak dihapus; CCO-nya dibereskan dulu di Kontrak & Adendum.
 *
 * Yang TIDAK boleh dihapus: revisi aktif, draft (punya tombol buang sendiri),
 * dan RAB kontrak awal (`hps_awal`) – ia dasar kontrak, bukan adendum.
 */

type BarisPangkas = { tanggal: string; dari: number; ke: number };

export type RingkasHapusRevisi = {
  revisi: {
    id: string;
    revisionNo: number;
    locationId: string;
    totalValue: string;
    dibuat: Date;
    digantikan: Date | null;
  };
  pengganti: { id: string; revisionNo: number } | null;
  /** Baris laporan harian yang dipindah ke item revisi pengganti. */
  laporanDipindah: number;
  /** Baris rencana mingguan yang dipindah. */
  rencanaDipindah: number;
  /** Kurva-S (baseline) yang lahir dari revisi ini dan ikut dihapus. */
  kurvaS: number;
  /** Volume laporan yang dikembalikan ke angka sebelum dipangkas revisi ini. */
  pemulihan: { idBaris: string; tanggal: string; item: string; sekarang: number; kembaliKe: number }[];
  /** Baris yang sudah diubah orang sesudah dipangkas – tidak disentuh. */
  pemulihanDilewati: number;
  /** Kosong = boleh dihapus. */
  alasanTolak: string[];
};

export async function ringkasHapusRevisi(revisionId: string): Promise<RingkasHapusRevisi> {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      id: true,
      locationId: true,
      revisionNo: true,
      source: true,
      status: true,
      totalValue: true,
      createdAt: true,
      supersededAt: true,
      amendment: { select: { ccoNumber: true } },
    },
  });
  const alasanTolak: string[] = [];
  if (rev.status === "aktif") alasanTolak.push("Revisi ini sedang AKTIF – hanya revisi yang sudah digantikan yang bisa dihapus.");
  if (rev.status === "draft") alasanTolak.push("Revisi ini masih draft – pakai tombol Buang draft.");
  if (rev.source === "hps_awal") alasanTolak.push("RAB kontrak awal tidak bisa dihapus – ia dasar kontrak, bukan adendum.");
  if (rev.amendment) {
    alasanTolak.push(
      `Revisi ini sudah dicatat sebagai ${rev.amendment.ccoNumber} di Kontrak & Adendum – batalkan CCO itu dulu.`,
    );
  }

  const pengganti = await db.rabRevision.findFirst({
    where: { locationId: rev.locationId, revisionNo: { gt: rev.revisionNo }, status: { in: ["aktif", "digantikan"] } },
    orderBy: { revisionNo: "asc" },
    select: { id: true, revisionNo: true },
  });
  if (!pengganti && rev.status === "digantikan") alasanTolak.push("Revisi pengganti tidak ditemukan.");

  // Laporan & rencana yang menunjuk item revisi ini – harus punya padanan di pengganti.
  const [laporan, rencana, kurvaS, kurvaAktif] = await Promise.all([
    db.dailyReportItem.findMany({
      where: { rabNode: { revisionId: rev.id } },
      select: { lineageKey: true, rabNode: { select: { code: true, name: true } } },
    }),
    db.weeklyPlanItem.findMany({
      where: { rabNode: { revisionId: rev.id } },
      select: { weeklyPlanId: true, rabNode: { select: { lineageKey: true, code: true, name: true } } },
    }),
    db.baseline.count({ where: { rabRevisionId: rev.id } }),
    db.baseline.count({ where: { rabRevisionId: rev.id, status: "aktif" } }),
  ]);
  if (kurvaAktif > 0) alasanTolak.push("Kurva-S yang sedang AKTIF lahir dari revisi ini – pulihkan/buat kurva-S lain dulu.");

  if (pengganti) {
    const kunciPengganti = new Map(
      (
        await db.rabNode.findMany({
          where: { revisionId: pengganti.id, kind: "item" },
          select: { id: true, lineageKey: true },
        })
      ).map((n) => [n.lineageKey, n.id]),
    );
    const tanpa = new Set<string>();
    for (const l of laporan) if (!kunciPengganti.has(l.lineageKey)) tanpa.add(`${l.rabNode.code} ${l.rabNode.name}`);
    for (const r of rencana) if (!kunciPengganti.has(r.rabNode.lineageKey)) tanpa.add(`${r.rabNode.code} ${r.rabNode.name}`);
    if (tanpa.size > 0) {
      alasanTolak.push(
        `Laporan/rencana memakai item yang tidak ada di revisi #${pengganti.revisionNo}: ${[...tanpa].slice(0, 5).join(", ")}` +
          (tanpa.size > 5 ? ` dan ${tanpa.size - 5} lainnya` : "") +
          ".",
      );
    }
    // Rencana mingguan yang sudah memuat item padanannya akan bertabrakan (satu item sekali per rencana).
    const bentrok = await db.weeklyPlanItem.count({
      where: {
        OR: rencana
          .filter((r) => kunciPengganti.has(r.rabNode.lineageKey))
          .map((r) => ({ weeklyPlanId: r.weeklyPlanId, rabNodeId: kunciPengganti.get(r.rabNode.lineageKey)! })),
      },
    });
    if (rencana.length > 0 && bentrok > 0) {
      alasanTolak.push(`${bentrok} rencana mingguan sudah memuat item yang sama dari revisi #${pengganti.revisionNo}.`);
    }
  }

  // Pemangkasan yang dipicu aktivasi revisi ini (audit per item, per baris laporan).
  const jejak = await db.auditLog.findMany({
    where: { action: "rab.adendum_sesuaikan_realisasi", resourceType: "rab_revision", resourceId: rev.id },
    select: { payload: true },
  });
  const pemulihan: RingkasHapusRevisi["pemulihan"] = [];
  let pemulihanDilewati = 0;
  for (const j of jejak) {
    const p = (j.payload ?? {}) as { lineageKey?: string; item?: string; baris?: BarisPangkas[] };
    if (!p.lineageKey || !Array.isArray(p.baris)) continue;
    for (const b of p.baris) {
      if (b.dari === b.ke) continue;
      const baris = await db.dailyReportItem.findMany({
        where: {
          lineageKey: p.lineageKey,
          report: { locationId: rev.locationId, reportDate: new Date(`${b.tanggal}T00:00:00.000Z`) },
        },
        select: { id: true, volumeDone: true },
      });
      // Hanya baris yang MASIH bernilai hasil pangkasan – yang sudah diubah orang sesudahnya tidak disentuh.
      const cocok = baris.find((r) => Number(r.volumeDone) === b.ke && !pemulihan.some((x) => x.idBaris === r.id));
      if (!cocok) {
        pemulihanDilewati++;
        continue;
      }
      pemulihan.push({ idBaris: cocok.id, tanggal: b.tanggal, item: p.item ?? p.lineageKey, sekarang: b.ke, kembaliKe: b.dari });
    }
  }

  return {
    revisi: {
      id: rev.id,
      revisionNo: rev.revisionNo,
      locationId: rev.locationId,
      totalValue: rev.totalValue.toString(),
      dibuat: rev.createdAt,
      digantikan: rev.supersededAt,
    },
    pengganti,
    laporanDipindah: laporan.length,
    rencanaDipindah: rencana.length,
    kurvaS,
    pemulihan,
    pemulihanDilewati,
    alasanTolak,
  };
}

export type HasilHapusRevisi = RingkasHapusRevisi & {
  /** Baris yang dipangkas ulang oleh batas volume RAB aktif sesudah pemulihan. */
  dipangkasUlang: number;
  snapshotDibangunUlang: number;
};

export class HapusRevisiDitolak extends Error {}

/** Jalankan penghapusan. Pemanggil WAJIB sudah memeriksa hak super admin utama. */
export async function hapusRevisiKeliru(revisionId: string, userId: string): Promise<HasilHapusRevisi> {
  const ringkas = await ringkasHapusRevisi(revisionId);
  if (ringkas.alasanTolak.length > 0 || !ringkas.pengganti) {
    throw new HapusRevisiDitolak(ringkas.alasanTolak.join(" ") || "Revisi ini tidak bisa dihapus.");
  }
  const { revisi, pengganti } = ringkas;

  const hasil = await db.$transaction(
    async (tx) => {
      // Diperiksa ulang DI DALAM transaksi: status bisa berubah sejak ringkasan dibaca.
      const kini = await tx.rabRevision.findUniqueOrThrow({
        where: { id: revisi.id },
        select: { status: true, amendmentId: true },
      });
      if (kini.status !== "digantikan" || kini.amendmentId) {
        throw new HapusRevisiDitolak("Status revisi berubah sejak ringkasan dibaca – muat ulang halaman.");
      }

      const nodePengganti = await tx.rabNode.findMany({
        where: { revisionId: pengganti.id, kind: "item" },
        select: { id: true, lineageKey: true },
      });
      const idPengganti = new Map(nodePengganti.map((n) => [n.lineageKey, n.id]));
      const kunciDipakai = await tx.rabNode.findMany({
        where: {
          revisionId: revisi.id,
          OR: [{ reportItems: { some: {} } }, { planItems: { some: {} } }],
        },
        select: { id: true, lineageKey: true },
      });
      for (const n of kunciDipakai) {
        const tujuan = idPengganti.get(n.lineageKey);
        if (!tujuan) throw new HapusRevisiDitolak(`Item ${n.lineageKey} tidak ada di revisi #${pengganti.revisionNo}.`);
        await tx.dailyReportItem.updateMany({ where: { rabNodeId: n.id }, data: { rabNodeId: tujuan } });
        await tx.weeklyPlanItem.updateMany({ where: { rabNodeId: n.id }, data: { rabNodeId: tujuan } });
      }

      // Pemulihan volume – harga dari item yang kini ditunjuk baris itu.
      let tanggalTerawal: Date | null = null;
      for (const p of ringkas.pemulihan) {
        const baris = await tx.dailyReportItem.findUniqueOrThrow({
          where: { id: p.idBaris },
          select: { volumeDone: true, rabNode: { select: { unitPrice: true } }, report: { select: { reportDate: true } } },
        });
        if (Number(baris.volumeDone) !== p.sekarang) continue; // berubah sejak ringkasan – tidak disentuh
        await tx.dailyReportItem.update({
          where: { id: p.idBaris },
          data: { volumeDone: p.kembaliKe, valueDone: hitungNilai(p.kembaliKe, Number(baris.rabNode.unitPrice ?? 0)) },
        });
        if (!tanggalTerawal || baris.report.reportDate < tanggalTerawal) tanggalTerawal = baris.report.reportDate;
      }

      // Batas volume RAB AKTIF diterapkan ulang – fungsi yang sama dengan aktivasi.
      const aktif = await tx.rabRevision.findFirst({
        where: { locationId: revisi.locationId, status: "aktif" },
        select: { id: true },
      });
      const ulang = aktif
        ? await sesuaikanRealisasiKeVolumeBaru(tx, aktif.id, revisi.locationId, userId)
        : { jumlahItem: 0, tanggalTerawal: null, rincian: [] };
      if (ulang.tanggalTerawal && (!tanggalTerawal || ulang.tanggalTerawal < tanggalTerawal)) {
        tanggalTerawal = ulang.tanggalTerawal;
      }

      await tx.baseline.deleteMany({ where: { rabRevisionId: revisi.id } });
      await tx.rabRevision.delete({ where: { id: revisi.id } });
      return { tanggalTerawal, dipangkasUlang: ulang.rincian.reduce((t, r) => t + r.baris, 0) };
    },
    { timeout: 60_000 },
  );

  // Angka "s/d" laporan final sesudah tanggal terawal yang berubah ikut bergeser.
  let snapshotDibangunUlang = 0;
  if (hasil.tanggalTerawal) {
    const { bangunUlangSnapshotFinal } = await import("@/lib/daily-report/snapshot-rebuild");
    snapshotDibangunUlang = await bangunUlangSnapshotFinal(revisi.locationId, { sejak: hasil.tanggalTerawal });
  }
  return { ...ringkas, dipangkasUlang: hasil.dipangkasUlang, snapshotDibangunUlang };
}
