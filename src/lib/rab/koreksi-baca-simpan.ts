import "server-only";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { valueDone as hitungNilai } from "@/lib/money";
import type { PerubahanKoreksi } from "@/lib/rab/koreksi-baca";

export class KoreksiBacaError extends Error {}

/**
 * Terapkan perbaikan pembacaan ke revisi AKTIF, di tempat (DECISIONS 680).
 *
 * Node-nya tetap node yang sama – id, lineage, volume, jumlah, urutan tidak
 * disentuh – jadi laporan harian, rencana, kurva-S, dan baseline tetap
 * menunjuk barang yang sama dengan angka yang sama.
 *
 * Satu turunan IKUT dihitung ulang: `valueDone` baris laporan harian item
 * yang harga satuannya berubah. Nilai itu dibekukan memakai harga saat
 * dilaporkan, dan untuk harga yang dulu kosong ia tercatat Rp 0 – "nilai
 * terpasang hari ini" di layar harian akan terus nol kalau dibiarkan.
 * Progres TIDAK ikut bergerak: ia dihitung dari volume × bobot, bukan dari
 * `valueDone` (DECISIONS 151). Blanko harian FINAL dibangun ulang sejak
 * tanggal terawal yang berubah, polanya sama dengan aktivasi adendum.
 */
export async function terapkanKoreksiBaca(a: {
  revisionId: string;
  locationId: string;
  perubahan: PerubahanKoreksi[];
  userId: string;
  berkas: string;
  /** `harga_kosong`: hanya harga satuan yang kosong (DECISIONS 681). */
  cakupan: "penuh" | "harga_kosong";
}): Promise<{ node: number; barisHarian: number; snapshotDibangunUlang: number }> {
  const hasil = await db.$transaction(
    async (tx) => {
      const rev = await tx.rabRevision.findUnique({
        where: { id: a.revisionId },
        select: { status: true, revisionNo: true },
      });
      if (!rev || rev.status !== "aktif") {
        throw new KoreksiBacaError("RAB aktif sudah berganti sejak pratinjau. Pratinjau ulang, lalu simpan lagi.");
      }

      let barisHarian = 0;
      let tanggalTerawal: Date | null = null;
      for (const p of a.perubahan) {
        await tx.rabNode.update({
          where: { id: p.id, revisionId: a.revisionId },
          data: {
            ...(p.unitPrice ? { unitPrice: p.unitPrice.ke } : {}),
            ...(p.unit ? { unit: p.unit.ke } : {}),
            ...(p.name ? { name: p.name.ke } : {}),
            ...(p.code ? { code: p.code.ke } : {}),
            ...(p.jenis ? { kind: p.jenis.ke } : {}),
          },
        });
        if (!p.unitPrice || p.kind !== "item") continue;
        const harga = p.unitPrice.ke ?? 0;
        const baris = await tx.dailyReportItem.findMany({
          where: { rabNodeId: p.id },
          select: { id: true, volumeDone: true, valueDone: true, report: { select: { reportDate: true, status: true } } },
        });
        for (const b of baris) {
          const nilai = hitungNilai(Number(b.volumeDone), harga);
          if (nilai === b.valueDone) continue;
          await tx.dailyReportItem.update({ where: { id: b.id }, data: { valueDone: nilai } });
          barisHarian++;
          if (b.report.status === "final" && (tanggalTerawal === null || b.report.reportDate < tanggalTerawal)) {
            tanggalTerawal = b.report.reportDate;
          }
        }
      }

      await auditIn(tx, a.userId, "rab.koreksi_baca", "rab_revision", a.revisionId, {
        locationId: a.locationId,
        revisionNo: rev.revisionNo,
        berkas: a.berkas,
        cakupan: a.cakupan,
        barisHarian,
        // Angka sebelum dan sesudahnya, per node – jejak lengkap tanpa revisi baru.
        perubahan: a.perubahan.map(({ id: _id, ...p }) => p),
      });
      return { barisHarian, tanggalTerawal };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  const { bangunUlangSnapshotFinal } = await import("@/lib/daily-report/snapshot-rebuild");
  const snapshotDibangunUlang = hasil.tanggalTerawal
    ? await bangunUlangSnapshotFinal(a.locationId, { sejak: hasil.tanggalTerawal })
    : 0;
  if (snapshotDibangunUlang > 0) {
    await audit(a.userId, "rab.koreksi_baca_snapshot", "rab_revision", a.revisionId, { snapshotDibangunUlang });
  }
  return { node: a.perubahan.length, barisHarian: hasil.barisHarian, snapshotDibangunUlang };
}
