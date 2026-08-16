import "server-only";
import { db } from "@/lib/db";
import { deriveCategorySchedule } from "@/lib/baseline";
import { buildKurvaSheet, type KurvaSheet } from "@/lib/scurve/kkp-sheet";
import type { PeriodReport } from "@/lib/periodic-report";
import {
  sebarMingguan,
  susunRincian,
  type BarisRincian,
  type SimpulRab,
} from "@/lib/export/rincian-jadwal";

/**
 * Pemuat data TIME SCHEDULE RINCI (DECISIONS 316) — menyatukan pohon RAB aktif
 * dengan profil mingguan per kategori.
 *
 * Yang menyentuh database cuma berkas ini; penyusun barisnya
 * (`export/rincian-jadwal.ts`) murni, penulis Excel-nya tidak tahu apa-apa soal
 * db.
 */

export type RincianJadwal = {
  rows: BarisRincian[];
  /** Sebaran mingguan per baris, sejajar `rows`. */
  mingguan: number[][];
  sheet: KurvaSheet;
  origin: "tersimpan" | "otomatis";
};

export async function muatRincianJadwal(
  locationId: string,
  report: PeriodReport,
): Promise<RincianJadwal | null> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return null;

  const jadwal = await deriveCategorySchedule(locationId);
  if (!jadwal) return null;

  const nodes = await db.rabNode.findMany({
    where: { revisionId: revision.id },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      parentId: true,
      kind: true,
      code: true,
      name: true,
      volume: true,
      unit: true,
      unitPrice: true,
      amount: true,
      lineageKey: true,
    },
  });
  if (nodes.length === 0) return null;

  const simpul: SimpulRab[] = nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    kind: n.kind,
    code: n.code,
    name: n.name,
    volume: n.volume === null ? null : Number(n.volume),
    unit: n.unit,
    unitPrice: n.unitPrice === null ? null : Number(n.unitPrice),
    amount: Number(n.amount),
    lineageKey: n.lineageKey,
  }));

  // Pembagi bobot = Σ KATEGORI, definisi yang sama dengan `lib/progress.ts`.
  const grand = simpul.filter((n) => n.kind === "kategori").reduce((s, n) => s + n.amount, 0);
  if (grand <= 0) return null;

  /*
   * Kurva & kelompok bulan diambil dari `buildKurvaSheet` — lapisan yang SAMA
   * dengan sheet Time Schedule resmi. Kalau berkas ini menghitung kurvanya
   * sendiri, satu paket bisa punya dua cerita tentang minggu yang sama.
   */
  const sheet = buildKurvaSheet({
    categories: report.kurvaSchedule,
    totalWeeks: report.totalWeeks,
    contractStart: report.header.contractStart,
    actualCum: report.scurve.actualPct,
    currentWeek: report.scurve.currentWeek,
    planCumOfficial: report.scurve.planPct,
  });

  const rows = susunRincian(
    simpul,
    grand,
    jadwal.rows.map((r) => ({ lineageKey: r.lineageKey, segments: r.segments })),
  );

  // Profil mingguan yang DIPAKAI untuk menyebar = `weeklyShown` milik sheet
  // resmi (bukan `jadwal.rows[].weekly`), supaya Σ kolom item persis sama
  // dengan baris rencana di sheet Time Schedule.
  const weeklyKategori = new Map<string, number[]>();
  report.kurvaSchedule.forEach((k) => {
    const cat = sheet.categories.find((c) => c.name === k.name && c.code === k.code);
    weeklyKategori.set(k.lineageKey, cat?.weeklyShown ?? k.weekly);
  });

  return {
    rows,
    mingguan: sebarMingguan(rows, weeklyKategori, sheet.totalWeeks),
    sheet,
    origin: jadwal.origin,
  };
}
