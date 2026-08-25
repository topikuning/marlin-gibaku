import "server-only";
import type { ReportVerifStatus } from "@/generated/prisma/enums";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { locationRelScopeWhere } from "@/lib/auth/scope";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";

/** Antrean & ringkasan workspace verifikasi Wakil PPK. Scope = penugasan. */

export type BarisAntreanVerifikasi = {
  reportId: string;
  reportDate: Date;
  dateKey: string;
  status: string;
  locationName: string;
  locationSlug: string;
  itemCount: number;
  photoCount: number;
  /** null = belum pernah diperiksa. */
  verif: { status: ReportVerifStatus; createdAt: Date } | null;
};

export async function antreanVerifikasi(user: SessionUser): Promise<{
  belumDiperiksa: BarisAntreanVerifikasi[];
  sudahDiperiksa: BarisAntreanVerifikasi[];
}> {
  const locIds = await accessibleLocationIds(user);
  const reports = await db.dailyReport.findMany({
    where: {
      ...locationRelScopeWhere(user, locIds),
      status: { in: [...COUNTED_REPORT_STATUSES] },
    },
    orderBy: { reportDate: "desc" },
    take: 300,
    select: {
      id: true,
      reportDate: true,
      status: true,
      location: { select: { name: true, slug: true } },
      _count: { select: { items: true, photos: true } },
      verifications: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } },
    },
  });

  const baris: BarisAntreanVerifikasi[] = reports.map((r) => ({
    reportId: r.id,
    reportDate: r.reportDate,
    dateKey: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    locationName: r.location.name,
    locationSlug: r.location.slug,
    itemCount: r._count.items,
    photoCount: r._count.photos,
    verif: r.verifications[0] ?? null,
  }));

  return {
    // Terlama dulu — yang paling lama menunggu diperiksa lebih dulu.
    belumDiperiksa: baris.filter((b) => !b.verif).sort((a, b) => a.reportDate.getTime() - b.reportDate.getTime()),
    sudahDiperiksa: baris.filter((b) => b.verif),
  };
}

export async function daftarInspeksi(user: SessionUser) {
  const locIds = await accessibleLocationIds(user);
  return db.inspection.findMany({
    where: locationRelScopeWhere(user, locIds),
    orderBy: { inspectionDate: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      inspectionDate: true,
      status: true,
      location: { select: { name: true, slug: true } },
      _count: { select: { findings: true, evidences: true } },
    },
  });
}
