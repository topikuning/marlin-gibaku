import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarRange, ClipboardList } from "lucide-react";
import {
  Banner,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  KpiCard,
  StatusPill,
} from "@/components/ui";
import { DeltaBadge, deviationTone } from "@/components/ui/stat-delta";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { getLocationProgress } from "@/lib/progress";
import { getScurveSeries } from "@/lib/baseline";
import { contractMismatch, withPpn } from "@/lib/money";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort, formatTanggal } from "@/lib/format";
import {
  LOCATION_STATUS_LABEL,
  LOCATION_STATUS_TONE,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
  canTransitionLocation,
} from "@/lib/lifecycle";
import type { LocationStatus } from "@/generated/prisma/enums";
import { requireLocationPage } from "./get-location";
import { LocationStatusForm } from "./status-form";
import { ISSUE_SEVERITY_LABEL, ISSUE_SEVERITY_TONE, ISSUE_STATUS_LABEL, ISSUE_STATUS_TONE } from "./issue-labels";

export const metadata: Metadata = { title: "Ringkasan Lokasi" };
export const dynamic = "force-dynamic";

export default async function LokasiRingkasanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  const contract = location.package.contract;

  const [progress, series, packageLocationCount] = await Promise.all([
    getLocationProgress(location.id),
    getScurveSeries(location.id),
    db.location.count({ where: { packageId: location.package.id } }),
  ]);

  const [weeklyPlan, openIssues, lastReport, statusHistory] = await Promise.all([
    db.weeklyPlan.findUnique({
      where: { locationId_weekNumber: { locationId: location.id, weekNumber: progress.weekNumber } },
      select: {
        weekNumber: true,
        items: {
          orderBy: { priority: "asc" },
          take: 8,
          select: {
            id: true,
            targetVolume: true,
            picName: true,
            rabNode: { select: { code: true, name: true, unit: true } },
          },
        },
      },
    }),
    db.issue.findMany({
      where: { locationId: location.id, status: { not: "selesai" } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, title: true, severity: true, status: true, createdAt: true },
    }),
    db.dailyReport.findFirst({
      where: { locationId: location.id },
      orderBy: { reportDate: "desc" },
      select: { id: true, reportDate: true, status: true },
    }),
    db.locationStatusHistory.findMany({
      where: { locationId: location.id },
      orderBy: { changedAt: "desc" },
      take: 5,
      select: { id: true, fromStatus: true, toStatus: true, changedAt: true, note: true },
    }),
  ]);

  const ppnPercent = contract ? Number(contract.ppnPercent) : 11;
  const rabWithPpn = withPpn(progress.grandTotal, ppnPercent);
  // Nilai kontrak bersifat PAKET (bisa mencakup banyak lokasi). Perbandingan
  // kontrak vs RAB+PPN hanya sahih bila paket = 1 lokasi. Untuk paket multi-
  // lokasi, rekonsiliasi dilakukan di level paket (halaman paket), bukan per-lokasi.
  const singleLocationPackage = packageLocationCount <= 1;
  const mismatch =
    singleLocationPackage && contract && progress.grandTotal > 0n
      ? contractMismatch(contract.contractValue, progress.grandTotal, ppnPercent)
      : false;

  const canManageLocation = can(user.role, "location.manage");
  const targets = (Object.keys(LOCATION_STATUS_LABEL) as LocationStatus[])
    .filter((s) => canTransitionLocation(location.status, s))
    .map((s): [LocationStatus, string] => [s, LOCATION_STATUS_LABEL[s]]);

  return (
    <div className="space-y-4">
      {mismatch && contract ? (
        <Banner
          tone="warning"
          title="Nilai kontrak tidak cocok dengan RAB + PPN"
          description={`Kontrak ${formatRupiah(contract.contractValue)} vs RAB ${formatRupiah(progress.grandTotal)} + PPN ${formatPct(ppnPercent, 0)} = ${formatRupiah(rabWithPpn)}. Cek adendum / revisi RAB.`}
        />
      ) : null}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Nilai RAB aktif" value={formatRupiahShort(progress.grandTotal)} sub="pra-PPN" />
        <KpiCard
          label="RAB + PPN"
          value={formatRupiahShort(rabWithPpn)}
          sub={
            !contract
              ? "belum ada kontrak"
              : singleLocationPackage
                ? `kontrak ${formatRupiahShort(contract.contractValue)}`
                : `paket ${packageLocationCount} lokasi`
          }
          tone={mismatch ? "warning" : "default"}
        />
        <KpiCard
          label="Terpasang"
          value={formatRupiahShort(progress.realizedValue)}
          sub={formatPct(progress.realizedPct)}
        />
        <KpiCard
          label="Deviasi"
          value={formatPct(progress.deviationPct)}
          tone={deviationTone(progress.deviationPct)}
          sub={`rencana ${formatPct(progress.planPct)} · minggu ${progress.weekNumber}/${progress.totalWeeks}`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Kurva-S"
            subtitle="Rencana (baseline aktif) vs realisasi (laporan harian terkirim)"
            action={
              <Link href={`/lokasi/${slug}/progress`} className="text-[13px] text-primary hover:underline">
                Detail progress
              </Link>
            }
          />
          <CardBody>
            <ScurveChart series={series} />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Rencana minggu ${progress.weekNumber}`}
              action={
                <Link href={`/lokasi/${slug}/rab`} className="text-[13px] text-primary hover:underline">
                  Kelola
                </Link>
              }
            />
            <CardBody>
              {!weeklyPlan || weeklyPlan.items.length === 0 ? (
                <EmptyState
                  icon={CalendarRange}
                  title="Belum ada rencana minggu ini"
                  description="Susun rencana mingguan di tab Rencana & RAB."
                  className="py-6"
                />
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {weeklyPlan.items.map((it) => (
                    <li key={it.id} className="flex items-baseline justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate text-ink" title={it.rabNode.name}>
                        <span className="mr-1.5 text-xs text-ink-faint">{it.rabNode.code}</span>
                        {it.rabNode.name}
                      </span>
                      <span className="tabular shrink-0 text-ink-muted">
                        {formatNumber(Number(it.targetVolume))} {it.rabNode.unit ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Laporan terakhir" />
            <CardBody>
              {lastReport ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/lokasi/${slug}/harian`} className="text-primary hover:underline">
                    {formatTanggal(lastReport.reportDate)}
                  </Link>
                  <StatusPill
                    tone={REPORT_STATUS_TONE[lastReport.status]}
                    label={REPORT_STATUS_LABEL[lastReport.status]}
                  />
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Belum ada laporan harian.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Kendala terbuka"
            action={
              <Link href={`/lokasi/${slug}/progress`} className="text-[13px] text-primary hover:underline">
                Kelola kendala
              </Link>
            }
          />
          <CardBody>
            {openIssues.length === 0 ? (
              <EmptyState icon={AlertTriangle} title="Tidak ada kendala terbuka" className="py-6" />
            ) : (
              <ul className="divide-y divide-border">
                {openIssues.map((issue) => (
                  <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{issue.title}</p>
                      <p className="text-xs text-ink-muted">{formatTanggal(issue.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <StatusPill tone={ISSUE_SEVERITY_TONE[issue.severity]} label={ISSUE_SEVERITY_LABEL[issue.severity]} />
                      <StatusPill tone={ISSUE_STATUS_TONE[issue.status]} label={ISSUE_STATUS_LABEL[issue.status]} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Status lokasi"
            subtitle={canManageLocation ? "Ubah status mengikuti lifecycle proyek" : "Riwayat perubahan status"}
          />
          <CardBody className="space-y-4">
            {canManageLocation ? (
              <LocationStatusForm locationId={location.id} targets={targets} />
            ) : null}
            {statusHistory.length === 0 ? (
              <EmptyState icon={ClipboardList} title="Belum ada riwayat status" className="py-6" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {statusHistory.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {h.fromStatus ? (
                        <>
                          <StatusPill tone={LOCATION_STATUS_TONE[h.fromStatus]} label={LOCATION_STATUS_LABEL[h.fromStatus]} />
                          <span aria-hidden className="text-ink-faint">→</span>
                        </>
                      ) : null}
                      <StatusPill tone={LOCATION_STATUS_TONE[h.toStatus]} label={LOCATION_STATUS_LABEL[h.toStatus]} />
                    </span>
                    <span className="text-xs text-ink-muted">
                      {formatTanggal(h.changedAt)}
                      {h.note ? ` — ${h.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
