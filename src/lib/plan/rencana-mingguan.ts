import "server-only";
import { db } from "@/lib/db";
import { bobotPct } from "@/lib/progress-calc";
import { cumulativeVolumeByLineage, getLocationProgress, planPctAtWeek } from "@/lib/progress";
import {
  HEADER_LOCATION_SELECT,
  buildPeriodHeader,
  getPeriodBounds,
  type PeriodHeader,
} from "@/lib/periodic-report";
import {
  hitungPpc,
  hitungProyeksi,
  statusDeviasi,
  type Ppc,
  type Proyeksi,
  type StatusRencana,
} from "./rencana-format";

/**
 * DATA FORMULIR RENCANA KERJA MINGGUAN (DECISIONS 258).
 *
 * Menyusun SATU bentuk data yang dipakai layar, berkas cetak A4, dan ekspor
 * Excel. Satu sumber, bukan tiga: kalau tiap keluaran menghitung sendiri, cepat
 * atau lambat berkas yang dicetak akan berbeda angka dari layar yang
 * menyetujuinya — dan yang beredar ke PPK adalah yang dicetak.
 *
 * TIDAK ADA rumus baru di sini. grandTotal, realisasi, dan rencana kurva-S
 * diambil dari `getLocationProgress` + `planPctAtWeek` — sumber yang sama persis
 * dengan dashboard dan blanko KKP. Bobot komitmen lewat `bobotPct`. Penilaian
 * rencana (proyeksi, PPC, status) di `rencana-format.ts` yang murni & teruji.
 */

export type BarisRencana = {
  code: string;
  name: string;
  categoryName: string;
  unit: string | null;
  /** Volume kontrak (RAB aktif). */
  volumeKontrak: number;
  /** Realisasi kumulatif s/d sekarang. */
  realisasi: number;
  sisa: number;
  /** Komitmen minggu ini. */
  target: number;
  /** Bobot komitmen terhadap nilai RAB lokasi (poin persen). */
  bobotTarget: number;
  nilaiTarget: number;
  picName: string | null;
  note: string | null;
  priority: number;
};

export type RencanaMingguan = {
  header: PeriodHeader;
  weekNumber: number;
  totalWeeks: number;
  /** Minggu yang sedang berjalan sekarang — untuk menandai formulir maju/mundur. */
  currentWeek: number;
  /** Kurva-S menuntut sekian % di akhir minggu ini. */
  targetPct: number;
  /** Realisasi kumulatif saat formulir disusun. */
  actualPct: number;
  deviationPct: number;
  status: StatusRencana;
  proyeksi: Proyeksi;
  /** Kredibilitas komitmen minggu LALU (Last Planner). */
  ppc: Ppc;
  /** Komitmen minggu lalu yang TIDAK tuntas — bahan pembahasan, bukan hiasan. */
  tidakTuntas: {
    code: string;
    name: string;
    unit: string | null;
    target: number;
    realisasi: number;
  }[];
  baris: BarisRencana[];
  totalNilai: number;
  totalBobot: number;
  catatan: string | null;
  disusunOleh: string | null;
  disusunPada: Date | null;
};

/** Item RAB daun, dipakai dua kali (komitmen minggu ini & minggu lalu). */
type Daun = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number;
  unitPrice: number;
  categoryName: string;
};

const DAY = 24 * 3600 * 1000;

/**
 * Susun formulir rencana minggu ke-`weekNumber` (default: minggu berjalan).
 * null bila prasyarat dokumen resmi belum ada (kontrak/SPMK/RAB aktif).
 *
 * Otorisasi TIDAK di sini — caller wajib requireUser + requireLocationAccess,
 * sama seperti `getPeriodReport`.
 */
export async function getRencanaMingguan(
  locationId: string,
  weekNumber?: number,
): Promise<RencanaMingguan | null> {
  const bounds = await getPeriodBounds(locationId);
  if (!bounds) return null;
  const { startDate, totalWeeks, currentWeek } = bounds;

  const minggu = weekNumber ?? currentWeek;
  if (!Number.isInteger(minggu) || minggu < 1 || minggu > totalWeeks) return null;
  const periodeStart = new Date(startDate.getTime() + (minggu - 1) * 7 * DAY);
  const periodeEnd = new Date(periodeStart.getTime() + 6 * DAY);

  // Angka pokok dari calculation layer — BUKAN dihitung ulang di sini.
  const progress = await getLocationProgress(locationId);
  if (!progress.activeRevisionId) return null;
  const grandTotal = Number(progress.grandTotal);
  const actualPct = progress.realizedPct;

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: HEADER_LOCATION_SELECT,
  });
  if (!location) return null;
  const header = buildPeriodHeader(location, { grandTotal, startDate, periodeStart, periodeEnd });
  if (!header) return null;

  // Tuntutan kurva-S di AKHIR minggu ini. `planPctAtWeek` = fungsi yang sama
  // dengan dashboard (clamp minggu terakhir, minggu 0 → 0).
  const baseline = progress.activeBaselineId
    ? await db.baseline.findUnique({
        where: { id: progress.activeBaselineId },
        select: { points: { orderBy: { weekNumber: "asc" }, select: { plannedPct: true } } },
      })
    : null;
  const points = (baseline?.points ?? []).map((p) => Number(p.plannedPct));
  const targetPct = planPctAtWeek(points, minggu);
  const deviationPct = actualPct - targetPct;

  // Item RAB daun revisi aktif + induknya (nama kategori untuk pengelompokan).
  const nodes = await db.rabNode.findMany({
    where: { revisionId: progress.activeRevisionId, kind: "item" },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      unit: true,
      volume: true,
      unitPrice: true,
      lineageKey: true,
      parent: { select: { name: true, parent: { select: { name: true } } } },
    },
  });
  const daunById = new Map<string, Daun>();
  for (const n of nodes) {
    daunById.set(n.id, {
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name,
      unit: n.unit,
      volume: n.volume != null ? Number(n.volume) : 0,
      unitPrice: n.unitPrice != null ? Number(n.unitPrice) : 0,
      categoryName: n.parent?.parent?.name ?? n.parent?.name ?? "–",
    });
  }

  const kumulatif = await cumulativeVolumeByLineage(locationId);

  // ── Komitmen minggu ini ──
  const plan = await db.weeklyPlan.findUnique({
    where: { locationId_weekNumber: { locationId, weekNumber: minggu } },
    select: {
      note: true,
      createdAt: true,
      createdById: true,
      items: {
        orderBy: [{ priority: "asc" }, { id: "asc" }],
        select: { rabNodeId: true, targetVolume: true, priority: true, picName: true, note: true },
      },
    },
  });

  const baris: BarisRencana[] = [];
  for (const it of plan?.items ?? []) {
    const d = daunById.get(it.rabNodeId);
    // Item dari revisi lain (mis. setelah adendum) — dilewati, bukan ditebak.
    if (!d) continue;
    const target = Number(it.targetVolume);
    const realisasi = kumulatif.get(d.lineageKey) ?? 0;
    const nilaiTarget = Math.round(target * d.unitPrice);
    baris.push({
      code: d.code,
      name: d.name,
      categoryName: d.categoryName,
      unit: d.unit,
      volumeKontrak: d.volume,
      realisasi,
      sisa: Math.max(0, d.volume - realisasi),
      target,
      bobotTarget: bobotPct(nilaiTarget, grandTotal),
      nilaiTarget,
      picName: it.picName,
      note: it.note,
      priority: it.priority,
    });
  }
  const totalNilai = baris.reduce((t, b) => t + b.nilaiTarget, 0);

  // ── PPC minggu LALU (Last Planner System) ──
  // Realisasi SELAMA minggu lalu = kumulatif s/d akhir minggu lalu dikurangi
  // kumulatif s/d sehari sebelum minggu itu mulai. Memakai kumulatif apa adanya
  // akan menghitung pekerjaan lama sebagai pemenuhan janji minggu lalu — PPC-nya
  // jadi tinggi justru untuk minggu yang tidak mengerjakan apa pun.
  let ppc: Ppc = hitungPpc([]);
  let tidakTuntas: RencanaMingguan["tidakTuntas"] = [];
  if (minggu > 1) {
    const planLalu = await db.weeklyPlan.findUnique({
      where: { locationId_weekNumber: { locationId, weekNumber: minggu - 1 } },
      select: {
        weekStart: true,
        weekEnd: true,
        items: { select: { rabNodeId: true, targetVolume: true } },
      },
    });
    if (planLalu && planLalu.items.length > 0) {
      const sebelum = new Date(planLalu.weekStart.getTime() - DAY);
      const [sdAkhir, sdSebelum] = await Promise.all([
        cumulativeVolumeByLineage(locationId, planLalu.weekEnd),
        cumulativeVolumeByLineage(locationId, sebelum),
      ]);
      const dipakai = planLalu.items.flatMap((it) => {
        const d = daunById.get(it.rabNodeId);
        if (!d) return [];
        const selamaMinggu = (sdAkhir.get(d.lineageKey) ?? 0) - (sdSebelum.get(d.lineageKey) ?? 0);
        return [{ d, target: Number(it.targetVolume), realisasi: Math.max(0, selamaMinggu) }];
      });
      ppc = hitungPpc(
        dipakai.map((x) => ({ targetVolume: x.target, realisasiVolume: x.realisasi })),
      );
      tidakTuntas = dipakai
        .filter((x) => x.realisasi + 1e-6 < x.target)
        .map((x) => ({
          code: x.d.code,
          name: x.d.name,
          unit: x.d.unit,
          target: x.target,
          realisasi: x.realisasi,
        }));
    }
  }

  const penyusun = plan?.createdById
    ? await db.user.findUnique({ where: { id: plan.createdById }, select: { fullName: true } })
    : null;

  return {
    header,
    weekNumber: minggu,
    totalWeeks,
    currentWeek,
    targetPct,
    actualPct,
    deviationPct,
    status: statusDeviasi(deviationPct),
    proyeksi: hitungProyeksi({ actualPct, targetPct, nilaiRencana: totalNilai, grandTotal }),
    ppc,
    tidakTuntas,
    baris,
    totalNilai,
    totalBobot: bobotPct(totalNilai, grandTotal),
    catatan: plan?.note ?? null,
    disusunOleh: penyusun?.fullName ?? null,
    disusunPada: plan?.createdAt ?? null,
  };
}
