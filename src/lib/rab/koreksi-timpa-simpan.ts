import "server-only";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { valueDone as hitungNilai } from "@/lib/money";
import { formatTanggal } from "@/lib/format";
import { grandTotal, type FlatNode } from "@/lib/rab/flatten";
import { sesuaikanRealisasiKeVolumeBaru } from "@/lib/rab/import";
import { rencanaKoreksiTimpa, type RencanaTimpa, type SimpulAktifTimpa } from "@/lib/rab/koreksi-timpa";

export class KoreksiTimpaError extends Error {}

/** Simpul revisi aktif dalam bentuk yang dibandingkan perencana koreksi. */
export async function simpulAktif(revisionId: string): Promise<SimpulAktifTimpa[]> {
  const rows = await db.rabNode.findMany({
    where: { revisionId },
    select: {
      id: true,
      parentId: true,
      lineageKey: true,
      kind: true,
      code: true,
      name: true,
      unit: true,
      volume: true,
      unitPrice: true,
      amount: true,
      sortOrder: true,
    },
  });
  const kunci = new Map(rows.map((r) => [r.id, r.lineageKey]));
  return rows.map((r) => ({
    id: r.id,
    lineageKey: r.lineageKey,
    parentLineageKey: r.parentId ? (kunci.get(r.parentId) ?? null) : null,
    kind: r.kind,
    code: r.code,
    name: r.name,
    unit: r.unit,
    volume: r.volume == null ? null : Number(r.volume),
    unitPrice: r.unitPrice == null ? null : Number(r.unitPrice),
    amount: r.amount,
    sortOrder: r.sortOrder,
  }));
}

/**
 * Baris yang TIDAK boleh hilang/berubah jadi judul karena masih dipakai
 * laporan harian atau rencana mingguan revisi aktif. `rabNodeId` keduanya FK
 * RESTRICT; yang lebih penting, menghapusnya membuang pekerjaan lapangan tanpa
 * ditanya. Disebut di pratinjau, dan diperiksa lagi saat menyimpan.
 */
export async function terhalangKoreksi(rencana: RencanaTimpa): Promise<string[]> {
  const ids = [...rencana.hapus.map((h) => h.id), ...rencana.jadiJudul.map((j) => j.id)];
  if (ids.length === 0) return [];
  const [harian, rencanaMingguan] = await Promise.all([
    db.dailyReportItem.findMany({
      where: { rabNodeId: { in: ids } },
      select: { rabNode: { select: { code: true, name: true } }, report: { select: { reportDate: true } } },
      orderBy: { report: { reportDate: "asc" } },
    }),
    db.weeklyPlanItem.findMany({
      where: { rabNodeId: { in: ids } },
      select: { rabNode: { select: { code: true, name: true } }, plan: { select: { weekNumber: true } } },
    }),
  ]);
  return [
    ...harian.map((h) => `${h.rabNode.code} ${h.rabNode.name} – laporan harian ${formatTanggal(h.report.reportDate)}`),
    ...rencanaMingguan.map((p) => `${p.rabNode.code} ${p.rabNode.name} – rencana minggu ke-${p.plan.weekNumber}`),
  ];
}

export function kalimatTerhalang(daftar: string[]): string {
  const contoh = daftar.slice(0, 8).join("; ");
  return (
    `Koreksi tidak bisa menghapus atau menjadikan judul ${daftar.length} baris yang sudah dipakai: ${contoh}` +
    `${daftar.length > 8 ? `; +${daftar.length - 8} lainnya` : ""}. Biarkan baris itu tetap ada di berkas ` +
    `(volumenya boleh dinolkan), atau pindahkan dulu laporannya.`
  );
}

export type HasilKoreksiTimpa = {
  revisionNo: number;
  ringkas: RencanaTimpa["ringkas"];
  barisHarian: number;
  dipindahDariDraft: number;
  disesuaikan: { item: string; dari: number; ke: number; adaFinal: boolean }[];
  snapshotDibangunUlang: number;
  /**
   * Kategori baru yang belum punya jadwal di kurva-S berjalan – diberi baris
   * nol, sama dengan aktivasi adendum (DECISIONS 698).
   */
  kategoriBaruTanpaKurva: string[];
};

/**
 * Timpa isi revisi AKTIF dengan `nodes` (DECISIONS 728) – satu transaksi.
 *
 * `dariDraftId`: isinya berasal dari draft (tombol "Aktifkan tanpa
 * persetujuan"). Laporan harian yang diinput terhadap draft itu ikut menjadi
 * resmi di RAB aktif (padanannya lewat lineage), lalu draftnya dihapus.
 */
export async function terapkanKoreksiTimpa(a: {
  revisionId: string;
  locationId: string;
  nodes: FlatNode[];
  userId: string;
  berkas: string | null;
  dariDraftId?: string;
}): Promise<HasilKoreksiTimpa> {
  if (a.nodes.length === 0) throw new KoreksiTimpaError("Tidak ada baris RAB untuk koreksi.");
  const aktif = await simpulAktif(a.revisionId);
  const rencana = rencanaKoreksiTimpa(aktif, a.nodes);
  const halang = await terhalangKoreksi(rencana);
  if (halang.length > 0) throw new KoreksiTimpaError(kalimatTerhalang(halang));

  const hasil = await db.$transaction(
    async (tx) => {
      const rev = await tx.rabRevision.findUnique({
        where: { id: a.revisionId },
        select: { status: true, revisionNo: true, locationId: true },
      });
      if (!rev || rev.status !== "aktif" || rev.locationId !== a.locationId) {
        throw new KoreksiTimpaError("RAB aktif sudah berganti sejak pratinjau. Pratinjau ulang, lalu simpan lagi.");
      }

      // 1. Baris baru, per jenjang – induknya bisa node lama atau node baru.
      const idByKey = new Map(aktif.map((n) => [n.lineageKey, n.id]));
      const sisa = [...rencana.tambah];
      while (sisa.length > 0) {
        const batch = sisa.filter((n) => n.parentLineageKey === null || idByKey.has(n.parentLineageKey));
        if (batch.length === 0) throw new KoreksiTimpaError("Struktur berkas tidak konsisten: ada baris yang induknya hilang.");
        const dibuat = await tx.rabNode.createManyAndReturn({
          data: batch.map((n) => ({
            revisionId: a.revisionId,
            parentId: n.parentLineageKey ? idByKey.get(n.parentLineageKey)! : null,
            kind: n.kind,
            code: n.code,
            name: n.name,
            volume: n.volume,
            unit: n.unit,
            unitPrice: n.unitPrice,
            amount: n.amount,
            lineageKey: n.lineageKey,
            sortOrder: n.sortOrder,
          })),
          select: { id: true, lineageKey: true },
        });
        for (const d of dibuat) idByKey.set(d.lineageKey, d.id);
        for (const b of batch) sisa.splice(sisa.indexOf(b), 1);
      }

      // 2. Baris yang sama diubah DI TEMPAT – id tetap.
      for (const u of rencana.ubah) {
        await tx.rabNode.update({
          where: { id: u.id, revisionId: a.revisionId },
          data: {
            ...(u.kind ? { kind: u.kind.ke as FlatNode["kind"] } : {}),
            ...(u.code ? { code: u.code.ke } : {}),
            ...(u.name ? { name: u.name.ke } : {}),
            ...(u.unit ? { unit: u.unit.ke } : {}),
            ...(u.volume ? { volume: u.volume.ke } : {}),
            ...(u.unitPrice ? { unitPrice: u.unitPrice.ke } : {}),
            ...(u.amount ? { amount: u.amount.ke } : {}),
            ...(u.sortOrder ? { sortOrder: u.sortOrder.ke } : {}),
            ...(u.induk ? { parentId: u.induk.ke ? idByKey.get(u.induk.ke)! : null } : {}),
          },
        });
      }

      // 3. Laporan & rencana yang diinput terhadap DRAFT ikut resmi, lalu draft dihapus.
      let dipindahDariDraft = 0;
      if (a.dariDraftId) {
        const diDraft = await tx.dailyReportItem.findMany({
          where: { rabNode: { revisionId: a.dariDraftId } },
          select: { id: true, lineageKey: true },
        });
        for (const d of diDraft) {
          const tujuan = idByKey.get(d.lineageKey);
          if (!tujuan) throw new KoreksiTimpaError(`Baris laporan harian draft (${d.lineageKey}) tidak berpadanan di RAB aktif.`);
          await tx.dailyReportItem.update({ where: { id: d.id }, data: { rabNodeId: tujuan, basis: "aktif" } });
        }
        dipindahDariDraft = diDraft.length;
        await tx.rabRevision.delete({ where: { id: a.dariDraftId } });
      }

      // 4. Baris yang tidak ada lagi di berkas dihapus (anak yang dipertahankan sudah dipindah induknya).
      if (rencana.hapus.length > 0) {
        await tx.rabNode.deleteMany({ where: { id: { in: rencana.hapus.map((h) => h.id) }, revisionId: a.revisionId } });
      }

      await tx.rabRevision.update({ where: { id: a.revisionId }, data: { totalValue: grandTotal(a.nodes) } });

      // 5. Nilai terpasang baris harian yang harga satuannya berubah (DECISIONS 680).
      let barisHarian = 0;
      let tanggalTerawal: Date | null = null;
      for (const u of rencana.ubah) {
        if (!u.unitPrice) continue;
        const baris = await tx.dailyReportItem.findMany({
          where: { rabNodeId: u.id },
          select: { id: true, volumeDone: true, valueDone: true, report: { select: { reportDate: true, status: true } } },
        });
        for (const b of baris) {
          const nilai = hitungNilai(Number(b.volumeDone), u.unitPrice.ke ?? 0);
          if (nilai === b.valueDone) continue;
          await tx.dailyReportItem.update({ where: { id: b.id }, data: { valueDone: nilai } });
          barisHarian++;
          if (b.report.status === "final" && (tanggalTerawal === null || b.report.reportDate < tanggalTerawal)) {
            tanggalTerawal = b.report.reportDate;
          }
        }
      }

      // 6. Realisasi di atas volume barunya diturunkan – aturan yang sama dengan aktivasi.
      const penyesuaian = await sesuaikanRealisasiKeVolumeBaru(tx, a.revisionId, a.locationId, a.userId);
      if (penyesuaian.tanggalTerawal && (tanggalTerawal === null || penyesuaian.tanggalTerawal < tanggalTerawal)) {
        tanggalTerawal = penyesuaian.tanggalTerawal;
      }

      await auditIn(tx, a.userId, "rab.koreksi", "rab_revision", a.revisionId, {
        locationId: a.locationId,
        revisionNo: rev.revisionNo,
        berkas: a.berkas,
        dariDraftId: a.dariDraftId ?? null,
        ringkas: rencana.ringkas,
        // Angka sebelum dan sesudahnya, per baris – jejak lengkap tanpa revisi baru.
        ubah: rencana.ubah.map(({ id: _id, amount, ...u }) => ({
          ...u,
          ...(amount ? { amount: { dari: amount.dari.toString(), ke: amount.ke.toString() } } : {}),
        })),
        tambah: rencana.tambah.map((n) => ({ lineageKey: n.lineageKey, label: [n.code, n.name].filter(Boolean).join(" ") })),
        hapus: rencana.hapus.map(({ id: _id, ...h }) => h),
        barisHarian,
        dipindahDariDraft,
        itemDisesuaikan: penyesuaian.jumlahItem,
      });
      return { revisionNo: rev.revisionNo, barisHarian, dipindahDariDraft, tanggalTerawal, penyesuaian };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  const { bangunUlangSnapshotFinal } = await import("@/lib/daily-report/snapshot-rebuild");
  const snapshotDibangunUlang = hasil.tanggalTerawal
    ? await bangunUlangSnapshotFinal(a.locationId, { sejak: hasil.tanggalTerawal })
    : 0;
  if (snapshotDibangunUlang > 0) {
    await audit(a.userId, "rab.koreksi_snapshot", "rab_revision", a.revisionId, { snapshotDibangunUlang });
  }

  // Kurva-S tidak diatur ulang (698). Kategori baru diberi baris nol di
  // matriks kurva-S berjalan – sama dengan `bawaBaselineKeRevisi`.
  const kategoriBaruTanpaKurva = await barisNolKategoriBaru(a.locationId, a.revisionId);

  return {
    revisionNo: hasil.revisionNo,
    ringkas: rencana.ringkas,
    barisHarian: hasil.barisHarian,
    dipindahDariDraft: hasil.dipindahDariDraft,
    disesuaikan: hasil.penyesuaian.rincian.map(({ item, dari, ke, adaFinal }) => ({ item, dari, ke, adaFinal })),
    snapshotDibangunUlang,
    kategoriBaruTanpaKurva,
  };
}

/** Kategori RAB aktif (bernilai) yang belum ada di matriks kurva-S berjalan → baris nol. */
async function barisNolKategoriBaru(locationId: string, revisionId: string): Promise<string[]> {
  const baseline = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true, points: { select: { weekNumber: true } }, scheduleItems: { select: { lineageKey: true, weekly: true } } },
  });
  // Baseline yang hanya punya titik (tanpa matriks) tetap hanya punya titik.
  if (!baseline || baseline.scheduleItems.length === 0) return [];
  const sudah = new Set(baseline.scheduleItems.map((x) => x.lineageKey));
  const baru = await db.rabNode.findMany({
    where: { revisionId, kind: "kategori", amount: { gt: 0n }, lineageKey: { notIn: [...sudah] } },
    select: { lineageKey: true, name: true },
    orderBy: { sortOrder: "asc" },
  });
  if (baru.length === 0) return [];
  const contoh = baseline.scheduleItems[0]?.weekly;
  const panjang = (Array.isArray(contoh) ? contoh.length : 0) || baseline.points.length;
  await db.baselineScheduleItem.createMany({
    data: baru.map((k) => ({
      baselineId: baseline.id,
      lineageKey: k.lineageKey,
      name: k.name,
      weightPct: 0,
      weekly: new Array<number>(panjang).fill(0),
    })),
    skipDuplicates: true,
  });
  return baru.map((k) => k.name);
}

/**
 * Isi DRAFT diterapkan sebagai KOREKSI RAB aktif (DECISIONS 728) – jalan
 * pintas super admin utama di tombol draft. Dulu (682) draft itu diaktifkan
 * sebagai revisi adendum tanpa persetujuan dan ikut terhitung CCO; kini isi
 * RAB aktif ditimpa di tempat dan draftnya habis terpakai.
 */
export async function koreksiDariDraft(a: { draftId: string; userId: string }): Promise<HasilKoreksiTimpa> {
  const draft = await db.rabRevision.findUnique({
    where: { id: a.draftId },
    select: { id: true, status: true, revisionNo: true, locationId: true },
  });
  if (!draft || draft.status !== "draft") throw new KoreksiTimpaError("Draft sudah tidak ada atau bukan draft lagi.");
  const aktif = await db.rabRevision.findFirst({
    where: { locationId: draft.locationId, status: "aktif" },
    select: { id: true },
  });
  if (!aktif) throw new KoreksiTimpaError("Lokasi ini belum punya RAB aktif untuk dikoreksi.");
  const isi = await simpulAktif(draft.id);
  const nodes: FlatNode[] = isi.map((n) => ({
    kind: n.kind as FlatNode["kind"],
    code: n.code,
    name: n.name,
    volume: n.volume,
    unit: n.unit,
    unitPrice: n.unitPrice,
    amount: n.amount,
    lineageKey: n.lineageKey,
    parentLineageKey: n.parentLineageKey,
    sortOrder: n.sortOrder,
    excelRow: null,
  }));
  // Induk lebih dulu: urutan dokumen draft, sama dengan saat ia dibuat.
  nodes.sort((x, y) => x.sortOrder - y.sortOrder);
  return terapkanKoreksiTimpa({
    revisionId: aktif.id,
    locationId: draft.locationId,
    nodes,
    userId: a.userId,
    berkas: `draft #${draft.revisionNo}`,
    dariDraftId: draft.id,
  });
}
