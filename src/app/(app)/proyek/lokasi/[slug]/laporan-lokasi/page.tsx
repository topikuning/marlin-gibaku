import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, FileText, Sheet } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, LinkTabs } from "@/components/ui";
import { subTabAdministrasi } from "../tabs";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { PeriodFilter } from "./period-filter";
import { SendPeriodReportWaButton, SendDailyReportWaButton } from "./laporan-wa";
import { UploadDailyToDriveButton, UploadPeriodToDriveButton } from "./laporan-drive";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { isWahaConfigured } from "@/lib/waha/client";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { jakartaDateKey, formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { withBackTo } from "@/lib/print-back";

export const dynamic = "force-dynamic";

/** Tab Laporan lokasi: harian final + mingguan/bulanan KKP + export. */
export default async function LaporanLokasiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; n?: string; show?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      package: { select: { id: true, waGroupId: true, driveFolderId: true } },
    },
  });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const wahaOn = await isWahaConfigured();
  const hasGroup = !!location.package?.waGroupId;
  const hasDrive = !!location.package?.driveFolderId;
  const driveOn = (await getGDriveConfigDisplay()).connected;

  // scheduleBounds: real bila SPMK ada, else asumsi mulai hari ini — utk tombol Jadwal
  // (kurva-S rencana tetap bisa dilihat sebelum SPMK). bounds REAL: hanya utk laporan
  // periodik (butuh SPMK sungguhan).
  const scheduleBounds = await getPeriodBounds(location.id, { assume: true });
  const bounds = scheduleBounds && !scheduleBounds.assumed ? scheduleBounds : null;
  const kind: PeriodKind = sp.kind === "bulanan" ? "bulanan" : "mingguan";
  const maxN = bounds ? (kind === "mingguan" ? bounds.totalWeeks : bounds.totalMonths) : 0;
  const currentN = bounds ? (kind === "mingguan" ? bounds.currentWeek : bounds.currentMonth) : 1;
  const n = Math.min(Math.max(Number.parseInt(sp.n ?? String(currentN), 10) || currentN, 1), Math.max(maxN, 1));
  // Generate eksplisit (audit UX #7): laporan hanya dihitung setelah "Tampilkan".
  const shown = sp.show === "1" && !!bounds;

  const [report, finalReports, driveLogs] = await Promise.all([
    shown ? getPeriodReport(location.id, kind, n) : Promise.resolve(null),
    db.dailyReport.findMany({
      where: { locationId: location.id, status: "final" },
      orderBy: { reportDate: "desc" },
      take: 30,
      select: { id: true, reportDate: true, waSentAt: true, _count: { select: { items: true } } },
    }),
    // Upload Drive sukses terakhir per laporan harian (log append-only).
    hasDrive
      ? db.gDriveUpload.findMany({
          where: { locationId: location.id, kind: "laporan_harian", status: "sukses" },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: { refKey: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);
  const driveUploadedAt = new Map<string, Date>();
  for (const l of driveLogs) if (!driveUploadedAt.has(l.refKey)) driveUploadedAt.set(l.refKey, l.createdAt);

  return (
    <div className="space-y-6">
      <LinkTabs items={subTabAdministrasi(slug)} />
      <Card>
        <CardHeader
          title="Laporan Periodik KKP"
          subtitle="Mingguan / bulanan — dihitung dari laporan harian terkirim (satu calculation layer)."
          action={
            scheduleBounds ? (
              <div className="flex items-center gap-2">
                <Link
                  href={withBackTo(`/cetak/jadwal/${slug}`, `/proyek/lokasi/${slug}/laporan-lokasi`)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-muted hover:border-border-strong"
                >
                  <CalendarClock aria-hidden className="size-4" /> Cetak Jadwal
                </Link>
                <a
                  href={`/proyek/lokasi/${slug}/jadwal/export`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-muted hover:border-border-strong"
                >
                  <Sheet aria-hidden className="size-4" /> Unduh Excel
                </a>
              </div>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          {!bounds ? (
            <EmptyState icon={FileText} title="Kontrak belum ada" description="Laporan periodik butuh periode kontrak." />
          ) : (
            <>
              <PeriodFilter slug={slug} kind={kind} n={n} maxN={maxN} shown={shown} />
              {!shown ? (
                <EmptyState
                  icon={FileText}
                  title="Laporan belum ditampilkan"
                  description="Pilih jenis laporan dan periode di atas, lalu klik Tampilkan untuk membuat laporan."
                />
              ) : report ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {wahaOn ? (
                      <SendPeriodReportWaButton slug={slug} locationId={location.id} kind={kind} n={n} hasGroup={hasGroup} />
                    ) : null}
                    {driveOn ? (
                      <UploadPeriodToDriveButton locationId={location.id} kind={kind} n={n} hasDrive={hasDrive} />
                    ) : null}
                  </div>
                  {/* Hal-1: KURVA S (grafik) */}
                  <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                    <ScurveKkpSheet r={report} />
                  </div>
                  {/* Hal-2+: tabel detail item */}
                  <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                    <KkpPeriodReport r={report} />
                  </div>
                </div>
              ) : (
                <EmptyState icon={FileText} title="Periode tidak valid" description="Periode di luar rentang kontrak." />
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Laporan harian final" subtitle="Snapshot beku — siap cetak KKP" />
        <CardBody>
          {finalReports.length === 0 ? (
            <EmptyState icon={FileText} title="Belum ada laporan final" description="Finalisasi dilakukan dari workspace harian setelah disetujui." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {finalReports.map((r) => {
                const key = jakartaDateKey(r.reportDate);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {formatTanggal(r.reportDate, "EEEE, d MMM yyyy")}
                      <span className="ml-2 text-ink-muted">{r._count.items} item</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3">
                      {wahaOn ? (
                        <SendDailyReportWaButton
                          slug={slug}
                          dateKey={key}
                          hasGroup={hasGroup}
                          sentAt={r.waSentAt ? r.waSentAt.toISOString() : null}
                        />
                      ) : null}
                      {driveOn ? (
                        <UploadDailyToDriveButton
                          slug={slug}
                          dateKey={key}
                          hasDrive={hasDrive}
                          uploadedAt={
                            driveUploadedAt.has(`${slug}:${key}`)
                              ? formatTanggalWaktu(driveUploadedAt.get(`${slug}:${key}`)!)
                              : null
                          }
                        />
                      ) : null}
                      <Link href={withBackTo(`/cetak/harian/${slug}/${key}`, `/proyek/lokasi/${slug}/laporan-lokasi`)} className="font-medium text-primary hover:underline">
                        Cetak
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
