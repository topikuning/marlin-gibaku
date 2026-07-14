import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * Query layer modul Paket — dipakai halaman /paket/** (server components).
 * Semua uang BigInt; serialisasi ke client via bigintToString di boundary.
 */

/** Nilai kontrak berjalan = nilai awal + Σ delta adendum. */
export function runningContractValue(
  contractValue: bigint,
  amendments: { valueDelta: bigint }[],
): bigint {
  return amendments.reduce((sum, a) => sum + a.valueDelta, contractValue);
}

/** Tanggal selesai berjalan = endDate + Σ endDateDelta (hari). */
export function runningEndDate(endDate: Date, amendments: { endDateDelta: number }[]): Date {
  const days = amendments.reduce((sum, a) => sum + a.endDateDelta, 0);
  return new Date(endDate.getTime() + days * 86_400_000);
}

/** Filter daftar paket: satu stage, atau grup "berkontrak" (kontrak dst). */
export type PackageListFilter = PackageStage | "berkontrak";

export const BERKONTRAK_STAGES: PackageStage[] = [
  "kontrak",
  "pelaksanaan",
  "serah_terima",
  "selesai",
];

export async function listPackages(filter?: PackageListFilter) {
  return db.package.findMany({
    where: filter
      ? { stage: filter === "berkontrak" ? { in: BERKONTRAK_STAGES } : filter }
      : undefined,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      packageNumber: true,
      name: true,
      stage: true,
      province: true,
      hpsValue: true,
      candidateVendorName: true,
      updatedAt: true,
      contract: {
        select: {
          vendor: { select: { name: true } },
        },
      },
      _count: { select: { locations: true } },
    },
  });
}

export type PackageStats = {
  total: number;
  tender: number;
  berkontrak: number;
  totalHps: bigint;
};

/** KPI ringkas daftar paket. HPS total tidak menghitung paket batal. */
export async function getPackageStats(): Promise<PackageStats> {
  const [total, tender, berkontrak, hps] = await Promise.all([
    db.package.count(),
    db.package.count({ where: { stage: "tender" } }),
    db.package.count({ where: { stage: { in: BERKONTRAK_STAGES } } }),
    db.package.aggregate({
      where: { stage: { not: "batal" } },
      _sum: { hpsValue: true },
    }),
  ]);
  return { total, tender, berkontrak, totalHps: hps._sum.hpsValue ?? 0n };
}

/**
 * Workspace paket: header + kontrak (vendor, adendum) + lokasi.
 * Di-cache per request — dipakai layout DAN tab pages tanpa query ganda.
 */
export const getPackageWorkspace = cache(async (id: string) => {
  return db.package.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      packageNumber: true,
      ownerAgency: true,
      stage: true,
      province: true,
      hpsValue: true,
      candidateVendorName: true,
      note: true,
      cancelReason: true,
      createdAt: true,
      updatedAt: true,
      contract: {
        select: {
          id: true,
          contractNumber: true,
          contractValue: true,
          ppnPercent: true,
          advancePercent: true,
          retentionPercent: true,
          signedDate: true,
          startDate: true,
          endDate: true,
          vendor: { select: { id: true, name: true } },
          amendments: {
            orderBy: { effectiveDate: "asc" },
            select: {
              id: true,
              ccoNumber: true,
              valueDelta: true,
              endDateDelta: true,
              effectiveDate: true,
              reason: true,
              createdAt: true,
            },
          },
        },
      },
      locations: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          village: true,
          regency: true,
          province: true,
          status: true,
          isActive: true,
          _count: { select: { rabRevisions: true, statusHistory: true, dailyReports: true } },
        },
      },
    },
  });
});

/**
 * Σ RAB aktif paket (pra-PPN) = Σ amount node "kategori" pada revisi status
 * "aktif" semua lokasi paket. activeRevisions = 0 → belum ada RAB, jangan
 * bandingkan mismatch.
 */
export const getActiveRabSum = cache(
  async (packageId: string): Promise<{ sum: bigint; activeRevisions: number }> => {
    const [agg, activeRevisions] = await Promise.all([
      db.rabNode.aggregate({
        _sum: { amount: true },
        where: {
          kind: "kategori",
          revision: { status: "aktif", location: { packageId } },
        },
      }),
      db.rabRevision.count({
        where: { status: "aktif", location: { packageId } },
      }),
    ]);
    return { sum: agg._sum.amount ?? 0n, activeRevisions };
  },
);

/** Vendor untuk dropdown konversi kontrak. */
export async function listVendors() {
  return db.vendor.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Histori stage paket + nama pengubah (PackageStageHistory tak punya relasi user). */
export async function getStageHistory(packageId: string) {
  const rows = await db.packageStageHistory.findMany({
    where: { packageId },
    orderBy: { changedAt: "desc" },
    select: { id: true, fromStage: true, toStage: true, changedAt: true, note: true, changedById: true },
  });
  const userIds = [...new Set(rows.map((r) => r.changedById))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r, changedByName: nameById.get(r.changedById) ?? "—" }));
}

/** Audit log paket (resourceType "package") untuk tab Aktivitas. */
export async function getPackageAuditLogs(packageId: string) {
  return db.auditLog.findMany({
    where: { resourceType: "package", resourceId: packageId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      action: true,
      payload: true,
      createdAt: true,
      user: { select: { fullName: true } },
    },
  });
}
