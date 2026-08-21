import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { accessibleLocationIds, requireUser, type SessionUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
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

/** Tanggal selesai berjalan = endDate + Σ endDateDelta (hari). null bila SPMK belum terbit. */
export function runningEndDate(
  endDate: Date | null,
  amendments: { endDateDelta: number }[],
): Date | null {
  if (!endDate) return null;
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

export async function listPackages(
  user: SessionUser,
  scopedLocationIds: string[] | null,
  filter?: PackageListFilter,
) {
  return db.package.findMany({
    where: {
      ...packageScopeWhere(user, scopedLocationIds),
      ...(filter
        ? { stage: filter === "berkontrak" ? { in: BERKONTRAK_STAGES } : filter }
        : {}),
    },
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
      waGroupId: true,
      waGroupName: true,
      driveFolderId: true,
      contract: {
        select: {
          // Cadangan kolom "Nomor" di daftar paket: paket yang sudah
          // berkontrak sering tidak punya nomor paket sendiri, sementara
          // nomor kontraknya justru nomor yang dipakai orang menyebut paket
          // itu (DECISIONS 248).
          contractNumber: true,
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
  /**
   * Jumlah paket PER TAHAP — bahan bilah funnel di daftar paket
   * (DECISIONS 368). Dihitung sekali di sini, bukan dari baris yang tampil di
   * layar: daftarnya bisa tersaring, dan funnel yang ikut menyusut saat orang
   * memilih satu tahap berhenti menjadi gambaran keseluruhan.
   */
  perStage: Record<PackageStage, number>;
};

/** KPI ringkas daftar paket (ter-scope sama dengan daftarnya). HPS total tidak menghitung paket batal. */
export async function getPackageStats(
  user: SessionUser,
  scopedLocationIds: string[] | null,
): Promise<PackageStats> {
  const scope = packageScopeWhere(user, scopedLocationIds);
  const [total, tender, berkontrak, hps, perStageRaw] = await Promise.all([
    db.package.count({ where: scope }),
    db.package.count({ where: { ...scope, stage: "tender" } }),
    db.package.count({ where: { ...scope, stage: { in: BERKONTRAK_STAGES } } }),
    db.package.aggregate({
      where: { ...scope, stage: { not: "batal" } },
      _sum: { hpsValue: true },
    }),
    db.package.groupBy({ by: ["stage"], where: scope, _count: { _all: true } }),
  ]);

  // Tahap yang TIDAK punya paket tetap muncul dengan nol. Funnel yang
  // melompati tahap kosong membuat orang mengira tahap itu tidak ada.
  const perStage = Object.fromEntries(
    (Object.keys(PACKAGE_STAGE_LABEL) as PackageStage[]).map((s) => [s, 0]),
  ) as Record<PackageStage, number>;
  for (const row of perStageRaw) perStage[row.stage] = row._count._all;

  return { total, tender, berkontrak, totalHps: hps._sum.hpsValue ?? 0n, perStage };
}

/**
 * Workspace paket: header + kontrak (vendor, adendum) + lokasi.
 * Di-cache per request — dipakai layout DAN tab pages tanpa query ganda.
 *
 * PENJAGA AKSES di sini, bukan di tiap halaman: sebelumnya siapa pun yang tahu
 * URL bisa membuka workspace paket mana pun (lintas penugasan, bahkan lintas
 * organisasi). Return null = halaman menampilkan notFound(), sama seperti
 * paket yang memang tidak ada — tidak membocorkan bahwa paketnya eksis.
 *
 * DAFTAR LOKASINYA juga ikut scope (DECISIONS 201). Dulu paket yang boleh
 * dibuka menampilkan SEMUA lokasinya: user yang ditugaskan ke B & C tetap
 * melihat A & D, dan baru tertahan saat mengkliknya (404). Penahanan di klik
 * memang mencegah akses datanya, tapi keberadaan & nama lokasi lain sudah
 * terlanjur bocor — dan daftar itu terbaca sebagai "ini semua tanggung
 * jawabmu", yang salah.
 *
 * Yang disembunyikan DISEBUT JUMLAHNYA (`locationsHidden`) supaya "tidak
 * muncul" tidak terbaca "tidak ada" — aturan yang sama dengan katalog lokasi.
 */
export const getPackageWorkspace = cache(async (id: string) => {
  const user = await requireUser();
  const scoped = await accessibleLocationIds(user);
  const pkg = await db.package.findUnique({
    where: { id, ...packageScopeWhere(user, scoped) },
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
      isBypass: true,
      cancelReason: true,
      // Pelaksana Lapangan – penanda tangan laporan harian & mingguan
      // (DECISIONS 402). Di paket, bukan kontrak: orangnya melekat pada
      // pelaksanaan pekerjaan dan bertahan saat kontraknya diganti.
      pelaksanaName: true,
      pelaksanaTitle: true,
      pelaksanaTtdKey: true,
      pelaksanaStempelKey: true,
      waGroupId: true,
      waGroupName: true,
      driveFolderId: true,
      createdAt: true,
      updatedAt: true,
      contract: {
        select: {
          id: true,
          contractNumber: true,
          workTitle: true,
          contractValue: true,
          ppnPercent: true,
          advancePercent: true,
          retentionPercent: true,
          signedDate: true,
          durationDays: true,
          startDate: true,
          endDate: true,
          ppkName: true,
          ppkNip: true,
          supervisorName: true,
          supervisorFirm: true,
          contractorSignerName: true,
          contractorSignerTitle: true,
          // Gambar tanda tangan & stempel utk laporan cetak (DECISIONS 328).
          ppkTtdKey: true,
          ppkStempelKey: true,
          supervisorTtdKey: true,
          supervisorStempelKey: true,
          contractorTtdKey: true,
          contractorStempelKey: true,
          vendor: { select: { id: true, name: true, stempelKey: true } },
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
              documents: {
                where: { status: "aktif" },
                orderBy: { uploadedAt: "asc" },
                select: { id: true, title: true },
              },
            },
          },
        },
      },
      locations: {
        where: scoped === null ? undefined : { id: { in: scoped } },
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
      _count: { select: { locations: true } },
    },
  });
  if (!pkg) return null;
  // Selisih total vs yang tampil = lokasi paket ini di luar penugasan user.
  // Untuk role lintas lokasi selalu 0.
  const locationsHidden = Math.max(0, pkg._count.locations - pkg.locations.length);
  return { ...pkg, locationsHidden };
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
  // changedById boleh null = tindakan SISTEM (aktivasi SPMK terjadwal,
  // DECISIONS 202) — jangan dicari namanya, dan jangan ditulis "—" seolah
  // pelakunya tidak diketahui.
  const userIds = [...new Set(rows.map((r) => r.changedById).filter((v): v is string => !!v))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    ...r,
    changedByName: r.changedById ? (nameById.get(r.changedById) ?? "–") : "Sistem (terjadwal)",
  }));
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
