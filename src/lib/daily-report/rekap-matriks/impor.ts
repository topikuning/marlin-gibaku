import "server-only";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { valueDone as hitungNilai } from "@/lib/money";
import { jalurNodeById } from "@/lib/rab/jalur";
import type { Prisma } from "@/generated/prisma/client";
import { bacaRekapMatriks } from "./baca";
import { cocokkanRekap } from "./cocok";
import { CATATAN_IMPOR, susunRencana, tujuanFoto, type Rencana } from "./rencana";
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
 * baru untuk tanggal yang belum punya laporan. Baris yang dinolkan DIBUANG
 * bila tidak membawa apa-apa lagi (tanpa foto, catatan, catatan luar RAB,
 * pemasangan – DECISIONS 786); yang masih membawa sesuatu tetap ada dengan
 * volume 0. Foto hanya dipindah bila diminta (783), sebelum barisnya dibuang.
 */

export class ImporRekapError extends Error {}

/** Tanggal jepret foto (Jakarta), atau tanggal laporannya bila foto tidak membawa waktu. */
const waktuJepret = (exif: Date | null, tanggalLaporan: string) => (exif ? jakartaDateKey(exif) : tanggalLaporan);

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
    select: { id: true, reportDate: true, status: true, noActivity: true, noActivityReason: true },
  });
  const laporan: Record<string, LaporanMarlin> = {};
  for (const r of reports) {
    laporan[jakartaDateKey(r.reportDate)] = { reportId: r.id, status: r.status, noActivity: r.noActivity, sebabNihil: r.noActivityReason };
  }
  const rows = await c.dailyReportItem.findMany({
    where: { report: { locationId }, lineageKey: { in: daunNode.map((n) => n.lineageKey) } },
    select: {
      id: true,
      reportId: true,
      lineageKey: true,
      basis: true,
      volumeDone: true,
      padananAktifId: true,
      notes: true,
      report: { select: { reportDate: true, status: true } },
      photos: { select: { exifTakenAt: true, luarRabId: true } },
      _count: { select: { luarRab: true } },
    },
  });
  const marlin: Record<string, Record<string, SelMarlin>> = {};
  for (const r of rows) {
    const tanggal = jakartaDateKey(r.report.reportDate);
    (marlin[r.lineageKey] ??= {})[tanggal] = {
      rowId: r.id,
      reportId: r.reportId,
      status: r.report.status,
      basis: r.basis,
      volume: Number(r.volumeDone),
      padanan: r.padananAktifId != null,
      foto: r.photos.length,
      fotoWaktu: r.photos.filter((f) => f.luarRabId == null).map((f) => waktuJepret(f.exifTakenAt, tanggal)),
      catatanBaris: r.notes,
      luarRab: r._count.luarRab > 0,
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
  /** Baris dinolkan yang dibuang karena tidak membawa apa-apa lagi (786). */
  hapus: number;
  fotoDipindah: number;
  /** Laporan yang pernyataan "tidak ada kegiatan"-nya dibatalkan karena Excel mencatat pekerjaan. */
  nihilDibatalkan: number;
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
      let hapus = 0;
      let fotoDipindah = 0;
      const nihilDibatalkan = new Set<string>();
      for (const it of rencana.item) {
        const tulis = it.perubahan.filter((p) => !p.ditahan);
        if (tulis.length === 0) continue;
        // Baris item ini per tanggal sesudah ditulis (yang lama + yang baru dibuat).
        const barisPer = new Map<string, { rowId: string; reportId: string }>(
          Object.entries(bahan.marlin[it.lineageKey] ?? {}).map(([t, x]) => [t, { rowId: x.rowId, reportId: x.reportId }]),
        );
        const node = bahan.nodeId[it.lineageKey];
        if (!node) throw new ImporRekapError(`Item "${it.nama}" tidak ada lagi di RAB aktif. Tekan Baca berkas lagi.`);
        for (const p of tulis) {
          if (p.status === "final") tanggalFinal.push(p.tanggal);
          // Excel mencatat pekerjaan di hari yang dinyatakan nihil: pernyataannya dibatalkan.
          const lap = bahan.laporan[p.tanggal];
          if (lap?.noActivity && p.ke > 0.0005 && !nihilDibatalkan.has(lap.reportId)) {
            const lama = await tx.dailyReport.update({
              where: { id: lap.reportId },
              data: { noActivity: false, noActivityReason: null, noActivityNote: null },
              select: { id: true },
            });
            nihilDibatalkan.add(lama.id);
            await auditIn(tx, o.userId, "daily_report.impor_rekap_batal_nihil", "daily_report", lap.reportId, {
              locationId: o.locationId,
              tanggal: p.tanggal,
              sebabSebelumnya: lap.sebabNihil ?? null,
            });
          }
          const basisLama = bahan.marlin[it.lineageKey]?.[p.tanggal]?.basis;
          if (p.rowId) {
            const row = await tx.dailyReportItem.findUniqueOrThrow({
              where: { id: p.rowId },
              select: { volumeDone: true, rabNode: { select: { unitPrice: true } } },
            });
            if (Math.abs(Number(row.volumeDone) - (p.dari ?? 0)) > 0.0005) {
              throw new ImporRekapError(`Laporan tanggal ${p.tanggal} berubah saat menyimpan. Tidak ada yang disimpan – tekan Baca berkas lagi.`);
            }
            // Baris yang dibuang: dihapus SESUDAH fotonya dipindah (bawah).
            if (p.aksi === "hapus") continue;
            await tx.dailyReportItem.update({
              where: { id: p.rowId },
              data: {
                volumeDone: p.ke,
                valueDone: hitungNilai(p.ke, Number(row.rabNode.unitPrice ?? 0)),
                // Baris draft adendum yang diikutkan Excel menjadi baris kontrak.
                ...(basisLama && basisLama !== "aktif" ? { basis: "aktif" } : {}),
              },
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
          const baru = await tx.dailyReportItem.create({
            data: {
              reportId,
              rabNodeId: node.id,
              lineageKey: it.lineageKey,
              basis: "aktif",
              volumeDone: p.ke,
              valueDone: hitungNilai(p.ke, node.harga),
              notes: CATATAN_IMPOR,
              reportedById: o.userId,
            },
            select: { id: true },
          });
          barisPer.set(p.tanggal, { rowId: baru.id, reportId });
          tambah++;
        }

        // Foto di baris yang dinolkan → tanggal Excel terdekat (DECISIONS 783).
        // Aturan tujuan yang SAMA dengan rencana; jumlahnya harus sama persis.
        const pindahan: { foto: string; dari: string; ke: string }[] = [];
        if (it.pindahFoto.length > 0) {
          for (const dari of [...new Set(it.pindahFoto.map((f) => f.dari))]) {
            const asal = barisPer.get(dari);
            if (!asal) throw new ImporRekapError(`Baris tanggal ${dari} tidak ditemukan saat memindah foto. Tekan Baca berkas lagi.`);
            const foto = await tx.photo.findMany({
              where: { reportItemId: asal.rowId, luarRabId: null },
              select: { id: true, exifTakenAt: true },
            });
            const hitung = new Map<string, number>();
            for (const f of foto) {
              const ke = tujuanFoto(waktuJepret(f.exifTakenAt, dari), it.tujuanFoto);
              if (!ke) continue;
              hitung.set(ke, (hitung.get(ke) ?? 0) + 1);
              pindahan.push({ foto: f.id, dari, ke });
            }
            const rencanaDari = it.pindahFoto.filter((x) => x.dari === dari);
            const sama =
              rencanaDari.length === hitung.size && rencanaDari.every((f) => (hitung.get(f.ke) ?? 0) === f.jumlah);
            if (!sama) {
              throw new ImporRekapError(`Foto tanggal ${dari} berubah sejak pratinjau. Tidak ada yang disimpan – tekan Baca berkas lagi.`);
            }
          }
          for (const x of pindahan) {
            const ke = barisPer.get(x.ke)!;
            await tx.photo.update({ where: { id: x.foto }, data: { reportId: ke.reportId, reportItemId: ke.rowId } });
            const st = (t: string) => bahan.laporan[t]?.status;
            if (st(x.dari) === "final") tanggalFinal.push(x.dari);
            if (st(x.ke) === "final") tanggalFinal.push(x.ke);
          }
          fotoDipindah += pindahan.length;
        }

        // Baris dinolkan yang tidak membawa apa-apa lagi → dibuang (786). Isinya
        // diperiksa ulang di sini: foto, catatan, atau tautan yang muncul sejak
        // pratinjau membatalkan seluruh impor, bukan ikut terbuang.
        for (const p of tulis) {
          if (p.aksi !== "hapus" || !p.rowId) continue;
          const row = await tx.dailyReportItem.findUnique({
            where: { id: p.rowId },
            select: {
              volumeDone: true,
              notes: true,
              padananAktifId: true,
              _count: { select: { photos: true, luarRab: true } },
            },
          });
          const catatan = row?.notes?.trim();
          const masihBerisi =
            !row ||
            Math.abs(Number(row.volumeDone) - (p.dari ?? 0)) > 0.0005 ||
            row._count.photos > 0 ||
            row._count.luarRab > 0 ||
            row.padananAktifId != null ||
            (catatan && catatan !== CATATAN_IMPOR);
          if (masihBerisi) {
            throw new ImporRekapError(`Baris tanggal ${p.tanggal} berubah sejak pratinjau. Tidak ada yang disimpan – tekan Baca berkas lagi.`);
          }
          await tx.dailyReportItem.delete({ where: { id: p.rowId } });
          hapus++;
        }
        await auditIn(tx, o.userId, "daily_report.impor_rekap_harian", "location", o.locationId, {
          mode: o.pilihan.mode,
          lineageKey: it.lineageKey,
          item: it.nama,
          barisExcel: it.excelRows,
          pilihan: it.pilihan,
          perubahan: tulis.map((p) => ({ tanggal: p.tanggal, aksi: p.aksi, dari: p.dari, ke: p.ke, status: p.status, foto: p.foto, rowId: p.rowId })),
          fotoDipindah: pindahan.map((x) => ({ photoId: x.foto, dari: x.dari, ke: x.ke })),
          totalSebelum: it.totalSekarang,
          totalSesudah: it.totalSesudah,
          diperbarui: sekarang.toISOString(),
        });
      }
      return { tambah, ubah, nolkan, hapus, fotoDipindah, nihilDibatalkan: nihilDibatalkan.size, laporanBaru, tanggalFinal, ringkas: rencana.ringkas };
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
    hapus: hasil.hapus,
    laporanBaru: hasil.laporanBaru.size,
    laporanBaruTetapDraft: tetapDraft,
    blankoDibangunUlang: blanko,
    ringkas: hasil.ringkas,
  });
  return {
    tambah: hasil.tambah,
    ubah: hasil.ubah,
    nolkan: hasil.nolkan,
    hapus: hasil.hapus,
    fotoDipindah: hasil.fotoDipindah,
    nihilDibatalkan: hasil.nihilDibatalkan,
    laporanBaru: hasil.laporanBaru.size,
    laporanBaruTetapDraft: tetapDraft,
    blankoDibangunUlang: blanko,
  };
}
