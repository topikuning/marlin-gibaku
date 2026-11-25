import "server-only";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { valueDone as hitungNilai } from "@/lib/money";
import { jalurNodeById } from "@/lib/rab/jalur";
import type { Prisma } from "@/generated/prisma/client";
import { bacaRekapMatriks } from "./baca";
import { cocokkanRekap } from "./cocok";
import { susunRencana, type Rencana } from "./rencana";
import { masukanRencana, type BahanPratinjau, type PilihanImpor } from "./masukan";
import type { LaporanMarlin, NodeRab, RekapMatriks, SelMarlin } from "./jenis";

/**
 * IMPOR REKAP HARIAN (matriks pekerjaan × tanggal) – DECISIONS 782.
 *
 * Dua fase, berkas diunggah ulang saat menyimpan:
 * - pratinjau: baca, cocokkan, kirim bahan rencana ke layar (layar menyusun
 *   rencananya sendiri tiap kali orang mengubah pilihan);
 * - simpan: SEMUA dibaca ulang dan rencana disusun ulang di server di bawah
 *   kunci lokasi; bila sidiknya berbeda dari yang dilihat orang di pratinjau,
 *   tidak ada yang ditulis.
 *
 * Yang ditulis HANYA volume (dan nilai turunannya) baris laporan, dan laporan
 * baru untuk tanggal yang belum punya laporan. Baris tidak pernah dihapus –
 * "dinolkan" berarti volumenya 0 dan barisnya tetap, berikut fotonya. Foto
 * tidak disentuh sama sekali.
 */

export class ImporRekapError extends Error {}

type Tx = Prisma.TransactionClient;

type Bahan = BahanPratinjau & { nodeId: Record<string, { id: string; harga: number }> };

async function kumpulkanBahan(
  c: Tx | typeof db,
  locationId: string,
  rekap: RekapMatriks,
  izin: { ubahTerkirim: boolean; ubahFinal: boolean },
): Promise<Bahan> {
  const aktif = await c.rabRevision.findFirst({ where: { locationId, status: "aktif" }, select: { id: true } });
  if (!aktif) throw new ImporRekapError("Lokasi ini belum punya RAB aktif.");
  const nodes = await c.rabNode.findMany({
    where: { revisionId: aktif.id },
    select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, unitPrice: true, lineageKey: true },
    orderBy: [{ sortOrder: "asc" }, { lineageKey: "asc" }],
  });
  const beranak = new Set(nodes.map((n) => n.parentId).filter((x): x is string => !!x));
  const daunNode = nodes.filter((n) => (n.kind === "item" || n.kind === "grup") && !beranak.has(n.id));
  const jalur = await jalurNodeById(daunNode.map((n) => n.id));
  const nodeRab: NodeRab[] = nodes.map((n) => ({
    lineageKey: n.lineageKey,
    kind: n.kind,
    name: n.name,
    unit: n.unit,
    volume: n.volume == null ? null : Number(n.volume),
    daun: (n.kind === "item" || n.kind === "grup") && !beranak.has(n.id),
    jalur: jalur.get(n.id)?.kode ?? n.code,
  }));
  const berisi = rekap.baris.filter((b) => b.sel.length > 0);
  const cocok = cocokkanRekap(rekap.baris, nodeRab);

  // Laporan dan baris MARLIN lokasi ini (semua tanggal – total item dihitung utuh).
  const reports = await c.dailyReport.findMany({
    where: { locationId },
    select: { id: true, reportDate: true, status: true, noActivity: true },
  });
  const laporan: Record<string, LaporanMarlin> = {};
  for (const r of reports) laporan[jakartaDateKey(r.reportDate)] = { reportId: r.id, status: r.status, noActivity: r.noActivity };
  const rows = await c.dailyReportItem.findMany({
    where: { report: { locationId }, lineageKey: { in: daunNode.map((n) => n.lineageKey) } },
    select: {
      id: true,
      reportId: true,
      lineageKey: true,
      basis: true,
      volumeDone: true,
      padananAktifId: true,
      report: { select: { reportDate: true, status: true } },
      _count: { select: { photos: true } },
    },
  });
  const marlin: Record<string, Record<string, SelMarlin>> = {};
  for (const r of rows) {
    (marlin[r.lineageKey] ??= {})[jakartaDateKey(r.report.reportDate)] = {
      rowId: r.id,
      reportId: r.reportId,
      status: r.report.status,
      basis: r.basis,
      volume: Number(r.volumeDone),
      padanan: r.padananAktifId != null,
      foto: r._count.photos,
    };
  }

  // Tanggal Excel tanpa laporan: boleh dibuatkan laporan? (lokasi dicabut, DECISIONS 616)
  const { alasanLokasiTertutup } = await import("@/lib/package/lingkup-lokasi");
  const tertutup: Record<string, string> = {};
  for (const t of [...new Set(berisi.flatMap((b) => b.sel.map((s) => s.tanggal)))]) {
    if (laporan[t]) continue;
    const alasan = await alasanLokasiTertutup(locationId, t);
    if (alasan) tertutup[t] = alasan;
  }

  return {
    sheet: rekap.sheet,
    kolomTanggal: rekap.kolomTanggal.length,
    awalPeriode: rekap.awalPeriode,
    akhirPeriode: rekap.akhirPeriode,
    tersembunyi: rekap.tersembunyi,
    barisTersembunyi: rekap.barisTersembunyi,
    teksDiSelTanggal: rekap.teksDiSelTanggal,
    baris: berisi,
    cocok: Object.fromEntries([...cocok].filter(([row]) => berisi.some((b) => b.excelRow === row))),
    daun: nodeRab.filter((n) => n.daun).map((n) => ({ lineageKey: n.lineageKey, name: n.name, unit: n.unit, volume: n.volume, jalur: n.jalur })),
    marlin,
    laporan,
    tertutup,
    izin,
    hariIni: jakartaDateKey(new Date()),
    nodeId: Object.fromEntries(daunNode.map((n) => [n.lineageKey, { id: n.id, harga: Number(n.unitPrice ?? 0) }])),
  };
}

export async function pratinjauImporRekap(
  locationId: string,
  buf: Buffer,
  izin: { ubahTerkirim: boolean; ubahFinal: boolean },
): Promise<BahanPratinjau> {
  const rekap = await bacaRekapMatriks(buf);
  if (!rekap.baris.some((b) => b.sel.length > 0)) {
    throw new ImporRekapError(`Sheet "${rekap.sheet}" terbaca, tetapi tidak ada satu pun angka di kolom tanggal yang terlihat.`);
  }
  const bahan = await kumpulkanBahan(db, locationId, rekap, izin);
  const { nodeId: _abaikan, ...untukLayar } = bahan;
  return untukLayar;
}

export type HasilImpor = {
  tambah: number;
  ubah: number;
  nolkan: number;
  laporanBaru: number;
  laporanBaruTetapDraft: { tanggal: string; sebab: string }[];
  blankoDibangunUlang: number;
};

export async function terapkanImporRekap(o: {
  locationId: string;
  buf: Buffer;
  userId: string;
  izin: { ubahTerkirim: boolean; ubahFinal: boolean };
  pilihan: PilihanImpor;
  sidik: string;
}): Promise<HasilImpor> {
  const rekap = await bacaRekapMatriks(o.buf);
  const hasil = await db.$transaction(
    async (tx) => {
      // Antre dengan pengiriman laporan dan pemasangan di lokasi yang sama.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${o.locationId}::text, 0))`;
      const bahan = await kumpulkanBahan(tx, o.locationId, rekap, o.izin);
      const rencana: Rencana = susunRencana(masukanRencana(bahan, o.pilihan));
      if (rencana.sidik !== o.sidik) {
        throw new ImporRekapError(
          "Data laporan berubah sejak pratinjau (atau pilihan di layar tidak sama). Tidak ada yang disimpan – tekan Baca berkas lagi.",
        );
      }
      const sekarang = new Date();
      const laporanBaru = new Map<string, string>();
      const tanggalFinal: string[] = [];
      let tambah = 0;
      let ubah = 0;
      let nolkan = 0;
      for (const it of rencana.item) {
        const tulis = it.perubahan.filter((p) => !p.ditahan);
        if (tulis.length === 0) continue;
        const node = bahan.nodeId[it.lineageKey];
        if (!node) throw new ImporRekapError(`Item "${it.nama}" tidak ada lagi di RAB aktif. Tekan Baca berkas lagi.`);
        for (const p of tulis) {
          if (p.status === "final") tanggalFinal.push(p.tanggal);
          if (p.rowId) {
            const row = await tx.dailyReportItem.findUniqueOrThrow({
              where: { id: p.rowId },
              select: { volumeDone: true, rabNode: { select: { unitPrice: true } } },
            });
            if (Math.abs(Number(row.volumeDone) - (p.dari ?? 0)) > 0.0005) {
              throw new ImporRekapError(`Laporan tanggal ${p.tanggal} berubah saat menyimpan. Tidak ada yang disimpan – tekan Baca berkas lagi.`);
            }
            await tx.dailyReportItem.update({
              where: { id: p.rowId },
              data: { volumeDone: p.ke, valueDone: hitungNilai(p.ke, Number(row.rabNode.unitPrice ?? 0)) },
            });
            if (p.aksi === "nolkan") nolkan++;
            else ubah++;
            continue;
          }
          let reportId = p.reportId ?? laporanBaru.get(p.tanggal) ?? null;
          if (!reportId) {
            const tgl = parseDateKey(p.tanggal);
            if (!tgl) throw new ImporRekapError(`Tanggal ${p.tanggal} tidak valid.`);
            const r = await tx.dailyReport.create({
              data: { locationId: o.locationId, reportDate: tgl, status: "draft", createdById: o.userId },
              select: { id: true },
            });
            await tx.dailyReportStatusHistory.create({
              data: { reportId: r.id, fromStatus: null, toStatus: "draft", changedById: o.userId, reason: "Dibuat dari impor rekap harian" },
            });
            reportId = r.id;
            laporanBaru.set(p.tanggal, r.id);
          }
          await tx.dailyReportItem.create({
            data: {
              reportId,
              rabNodeId: node.id,
              lineageKey: it.lineageKey,
              basis: "aktif",
              volumeDone: p.ke,
              valueDone: hitungNilai(p.ke, node.harga),
              notes: "Dari impor rekap harian",
              reportedById: o.userId,
            },
          });
          tambah++;
        }
        await auditIn(tx, o.userId, "daily_report.impor_rekap_harian", "location", o.locationId, {
          mode: o.pilihan.mode,
          lineageKey: it.lineageKey,
          item: it.nama,
          barisExcel: it.excelRows,
          pilihan: it.pilihan,
          perubahan: tulis.map((p) => ({ tanggal: p.tanggal, aksi: p.aksi, dari: p.dari, ke: p.ke, status: p.status, foto: p.foto })),
          totalSebelum: it.totalSekarang,
          totalSesudah: it.totalSesudah,
          diperbarui: sekarang.toISOString(),
        });
      }
      return { tambah, ubah, nolkan, laporanBaru, tanggalFinal, ringkas: rencana.ringkas };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  // Laporan baru dikirim lewat jalur biasa (mesin transisi + histori); yang gagal tetap draft dan disebut.
  const { submitReport } = await import("@/lib/daily-report/service");
  const tetapDraft: { tanggal: string; sebab: string }[] = [];
  for (const [tanggal, reportId] of hasil.laporanBaru) {
    try {
      await submitReport(reportId, o.userId);
    } catch (e) {
      tetapDraft.push({ tanggal, sebab: e instanceof Error ? e.message : "gagal dikirim" });
    }
  }
  let blanko = 0;
  const awalFinal = hasil.tanggalFinal.sort()[0];
  if (awalFinal) {
    const { bangunUlangSnapshotFinal } = await import("@/lib/daily-report/snapshot-rebuild");
    blanko = await bangunUlangSnapshotFinal(o.locationId, { sejak: new Date(`${awalFinal}T00:00:00.000Z`) });
  }
  await audit(o.userId, "daily_report.impor_rekap_harian_selesai", "location", o.locationId, {
    mode: o.pilihan.mode,
    tambah: hasil.tambah,
    ubah: hasil.ubah,
    nolkan: hasil.nolkan,
    laporanBaru: hasil.laporanBaru.size,
    laporanBaruTetapDraft: tetapDraft,
    blankoDibangunUlang: blanko,
    ringkas: hasil.ringkas,
  });
  return {
    tambah: hasil.tambah,
    ubah: hasil.ubah,
    nolkan: hasil.nolkan,
    laporanBaru: hasil.laporanBaru.size,
    laporanBaruTetapDraft: tetapDraft,
    blankoDibangunUlang: blanko,
  };
}
