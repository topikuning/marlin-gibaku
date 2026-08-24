import "server-only";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationScopeWhere, packageScopeWhere } from "@/lib/auth/scope";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { COUNTED_REPORT_STATUSES, OPEN_FINDING_STATUSES } from "@/lib/lifecycle";
import { getLocationsProgress } from "@/lib/progress";
import {
  AMBANG,
  evaluasiEwsLokasi,
  evaluasiEwsPaket,
  urutkanWarning,
  type EwsWarning,
} from "./rules";

/**
 * PENGUMPUL FAKTA EWS (DECISIONS 426). Semua angka progres dari calculation
 * layer; modul ini hanya menghitung selisih hari & jumlah baris. Hasilnya
 * TIDAK disimpan (derived on-the-fly) — model `Alert` lama sengaja tetap mati.
 */

const HARI_MS = 24 * 3600 * 1000;

function selisihHari(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / HARI_MS);
}

export async function bangunEws(user: SessionUser): Promise<EwsWarning[]> {
  const locIds = await accessibleLocationIds(user);
  const today = jakartaToday();

  const locations = await db.location.findMany({
    where: {
      ...locationScopeWhere(user, locIds),
      status: { in: ["persiapan", "berjalan", "terhenti", "selesai", "pho", "pemeliharaan"] },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      package: {
        select: {
          id: true,
          contract: {
            select: {
              startDate: true,
              endDate: true,
              amendments: { select: { endDateDelta: true } },
            },
          },
        },
      },
    },
  });
  if (locations.length === 0) return [];
  const ids = locations.map((l) => l.id);

  const [progress, lastReport, perluKoreksi, temuanTerbuka, kendalaTelat] = await Promise.all([
    getLocationsProgress(ids),
    db.dailyReport.groupBy({
      by: ["locationId"],
      where: { locationId: { in: ids }, status: { in: [...COUNTED_REPORT_STATUSES] } },
      _max: { reportDate: true },
    }),
    db.dailyReport.groupBy({
      by: ["locationId"],
      where: { locationId: { in: ids }, status: "perlu_koreksi" },
      _count: { _all: true },
    }),
    db.finding.findMany({
      where: { locationId: { in: ids }, status: { in: [...OPEN_FINDING_STATUSES] } },
      select: { locationId: true, severity: true, status: true, dueDate: true },
    }),
    // Catatan: tenggat kendala di papan /kendala juga menimbang dueDate aksi
    // pemulihan; EWS memakai tenggat kendalanya sendiri saja — cukup untuk
    // peringatan, papannya yang jadi sumber lengkap.
    db.issue.findMany({
      where: {
        locationId: { in: ids },
        status: { in: ["terbuka", "ditangani"] },
        mergedIntoId: null,
        dueDate: { lt: today },
      },
      select: { locationId: true },
    }),
  ]);

  const lastByLoc = new Map(lastReport.map((r) => [r.locationId, r._max.reportDate]));
  const koreksiByLoc = new Map(perluKoreksi.map((r) => [r.locationId, r._count._all]));

  const warnings: EwsWarning[] = [];
  for (const loc of locations) {
    const p = progress.get(loc.id);
    if (!p) continue;
    const contract = loc.package.contract;
    const start = contract?.startDate ?? null;
    let endEfektif: Date | null = contract?.endDate ?? null;
    if (endEfektif && contract) {
      const deltaHari = contract.amendments.reduce((acc, a) => acc + a.endDateDelta, 0);
      if (deltaHari !== 0) endEfektif = new Date(endEfektif.getTime() + deltaHari * HARI_MS);
    }
    const last = lastByLoc.get(loc.id) ?? null;
    const temuanLoc = temuanTerbuka.filter((t) => t.locationId === loc.id);

    warnings.push(
      ...evaluasiEwsLokasi({
        locationName: loc.name,
        locationSlug: loc.slug,
        status: loc.status,
        weekNumber: p.weekNumber,
        totalWeeks: p.totalWeeks,
        deviationPct: p.deviationPct,
        realizedPct: p.realizedPct,
        hariTanpaLaporan: last ? Math.max(0, selisihHari(today, last)) : null,
        laporanPerluKoreksi: koreksiByLoc.get(loc.id) ?? 0,
        sisaHariKontrak: endEfektif ? selisihHari(endEfektif, today) : null,
        waktuTerpakaiPct:
          start && endEfektif && endEfektif > start
            ? (selisihHari(today, start) / selisihHari(endEfektif, start)) * 100
            : null,
        temuanKritisTerbuka: temuanLoc.filter((t) => t.severity === "kritis").length,
        temuanLewatTenggat: temuanLoc.filter((t) => t.dueDate !== null && t.dueDate < today).length,
        temuanDibukaKembali: temuanLoc.filter((t) => t.status === "dibuka_kembali").length,
        kendalaLewatTenggat: kendalaTelat.filter((k) => k.locationId === loc.id).length,
      }),
    );
  }

  /* Fakta level paket: dokumen & milestone. */
  const packages = await db.package.findMany({
    where: { ...packageScopeWhere(user, locIds), stage: { in: ["kontrak", "pelaksanaan", "serah_terima"] } },
    select: { id: true, name: true },
  });
  if (packages.length > 0) {
    const pkgIds = packages.map((p) => p.id);
    const batasSegera = new Date(today.getTime() + AMBANG.dokKadaluarsaSegeraHari * HARI_MS);
    const [dokumen, milestoneTelat] = await Promise.all([
      db.document.findMany({
        where: { packageId: { in: pkgIds }, status: "aktif", expiryDate: { not: null, lt: batasSegera } },
        select: { packageId: true, title: true, expiryDate: true },
      }),
      db.adminMilestone.groupBy({
        by: ["packageId"],
        where: {
          packageId: { in: pkgIds },
          dueDate: { lt: today },
          status: { notIn: ["selesai", "tidak_berlaku"] },
        },
        _count: { _all: true },
      }),
    ]);
    const telatByPkg = new Map(milestoneTelat.map((m) => [m.packageId, m._count._all]));
    for (const pkg of packages) {
      const dok = dokumen.filter((d) => d.packageId === pkg.id);
      const sudah = dok.filter((d) => d.expiryDate! < today);
      const segera = dok
        .filter((d) => d.expiryDate! >= today)
        .map((d) => ({ title: d.title, hariLagi: selisihHari(d.expiryDate!, today) }))
        .sort((a, b) => a.hariLagi - b.hariLagi);
      warnings.push(
        ...evaluasiEwsPaket({
          packageId: pkg.id,
          packageName: pkg.name,
          dokSudahKadaluarsa: sudah.map((d) => ({ title: d.title })),
          dokSegeraKadaluarsa: segera,
          milestoneTerlambat: telatByPkg.get(pkg.id) ?? 0,
        }),
      );
    }
  }

  return urutkanWarning(warnings);
}
