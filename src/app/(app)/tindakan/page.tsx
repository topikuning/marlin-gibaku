import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileWarning,
  ShieldAlert,
} from "lucide-react";
import { EmptyState, PageHeader, StatusPill, type BadgeTone } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatTanggal, jakartaDateKey } from "@/lib/format";
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
} from "@/lib/lifecycle";
import {
  ISSUE_SEVERITY_LABEL,
  ISSUE_SEVERITY_TONE,
} from "@/app/(app)/lokasi/[slug]/issue-labels";

export const metadata: Metadata = { title: "Perlu Tindakan" };
export const dynamic = "force-dynamic";

const SEVERITY_ORDER = { kritis: 0, tinggi: 1, sedang: 2, rendah: 3 } as const;

function actionAge(date: Date | null): string {
  if (!date) return "waktu belum tercatat";
  const hours = Math.max(1, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  return hours < 24 ? `${hours} jam` : `${Math.floor(hours / 24)} hari`;
}

type ActionItem = {
  id: string;
  rank: number;
  kind: "Kendala" | "Verifikasi laporan" | "Koreksi laporan";
  title: string;
  context: string;
  href: string;
  age: string;
  tone: "danger" | "warning" | "info";
  statusLabel: string;
  statusTone: BadgeTone;
};

export default async function ActionCentrePage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "portfolio.view");
  const ids = await accessibleLocationIds(user);
  const locationWhere = locationScopeWhere(user, ids);

  const [issues, reportsToReview, reportsToCorrect] = await Promise.all([
    db.issue.findMany({
      where: { status: { not: "selesai" }, location: locationWhere },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        createdAt: true,
        location: { select: { name: true, slug: true } },
        actions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { dueDate: true, picName: true },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    can(user.role, "daily_report.review")
      ? db.dailyReport.findMany({
          where: { status: "dikirim", location: locationWhere },
          select: {
            id: true,
            reportDate: true,
            submittedAt: true,
            status: true,
            location: { select: { name: true, slug: true } },
          },
          orderBy: [{ submittedAt: "asc" }],
        })
      : Promise.resolve([]),
    can(user.role, "daily_report.create")
      ? db.dailyReport.findMany({
          where: { status: "perlu_koreksi", location: locationWhere },
          select: {
            id: true,
            reportDate: true,
            updatedAt: true,
            status: true,
            location: { select: { name: true, slug: true } },
            statusHistory: {
              where: { toStatus: "perlu_koreksi" },
              orderBy: { changedAt: "desc" },
              take: 1,
              select: { reason: true },
            },
          },
          orderBy: [{ updatedAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const items: ActionItem[] = [
    ...issues
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      .map((issue): ActionItem => ({
        id: `issue-${issue.id}`,
        rank: SEVERITY_ORDER[issue.severity],
        kind: "Kendala",
        title: issue.title,
        context: `${issue.location.name}${issue.actions[0]?.picName ? ` · PIC ${issue.actions[0].picName}` : " · PIC belum ditetapkan"}${issue.actions[0]?.dueDate ? ` · target ${formatTanggal(issue.actions[0].dueDate)}` : ""}`,
        href: `/lokasi/${issue.location.slug}/progress`,
        age: actionAge(issue.createdAt),
        tone: issue.severity === "kritis" ? "danger" : "warning",
        statusLabel: ISSUE_SEVERITY_LABEL[issue.severity],
        statusTone: ISSUE_SEVERITY_TONE[issue.severity],
      })),
    ...reportsToReview.map((report): ActionItem => ({
      id: `review-${report.id}`,
      rank: 4,
      kind: "Verifikasi laporan",
      title: `Tinjau laporan ${formatTanggal(report.reportDate)}`,
      context: `${report.location.name} · menunggu keputusan reviewer`,
      href: `/lokasi/${report.location.slug}/harian/${jakartaDateKey(report.reportDate)}`,
      age: actionAge(report.submittedAt),
      tone: "info",
      statusLabel: REPORT_STATUS_LABEL[report.status],
      statusTone: REPORT_STATUS_TONE[report.status],
    })),
    ...reportsToCorrect.map((report): ActionItem => ({
      id: `correction-${report.id}`,
      rank: 3,
      kind: "Koreksi laporan",
      title: `Perbaiki laporan ${formatTanggal(report.reportDate)}`,
      context: `${report.location.name} · ${report.statusHistory[0]?.reason ?? "catatan koreksi belum tersedia"}`,
      href: `/lokasi/${report.location.slug}/harian/${jakartaDateKey(report.reportDate)}`,
      age: actionAge(report.updatedAt),
      tone: "warning",
      statusLabel: REPORT_STATUS_LABEL[report.status],
      statusTone: REPORT_STATUS_TONE[report.status],
    })),
  ].sort((a, b) => a.rank - b.rank);

  const criticalCount = issues.filter((item) => item.severity === "kritis").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portfolio nasional · antrean lintas proyek"
        title="Perlu tindakan"
        description="Kendala, koreksi, dan verifikasi dalam satu urutan kerja berbasis urgensi."
      />

      <section aria-label="Ringkasan antrean" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <QueueMetric label="Total antrean" value={items.length} />
        <QueueMetric label="Kritis" value={criticalCount} tone="danger" />
        <QueueMetric label="Menunggu verifikasi" value={reportsToReview.length} tone="info" />
        <QueueMetric label="Perlu koreksi" value={reportsToCorrect.length} tone="warning" />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{items.length} item membutuhkan tindakan</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Urutan: keselamatan/kritis, koreksi, lalu verifikasi.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-xs font-medium text-ink-muted">
            <Clock3 aria-hidden className="size-3.5" /> data langsung
          </span>
        </header>

        {items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Tidak ada antrean tindakan"
            description="Semua kendala dan laporan dalam scope Anda sudah ditangani."
            className="py-14"
          />
        ) : (
          <ol className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group grid gap-3 px-4 py-4 hover:bg-surface-muted sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                >
                  <span className={`grid size-10 place-items-center rounded-lg ${
                    item.tone === "danger"
                      ? "bg-danger-soft text-danger"
                      : item.tone === "warning"
                        ? "bg-warning-soft text-warning"
                        : "bg-info-soft text-info"
                  }`}>
                    {item.kind === "Kendala" ? <ShieldAlert aria-hidden className="size-5" /> : item.kind === "Koreksi laporan" ? <FileWarning aria-hidden className="size-5" /> : <ClipboardCheck aria-hidden className="size-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={item.statusTone} label={item.statusLabel} />
                      <span className="text-xs font-medium text-ink-muted">{item.kind} · {item.age}</span>
                    </span>
                    <strong className="mt-1.5 block text-sm text-ink">{item.title}</strong>
                    <span className="mt-0.5 block text-sm text-ink-muted">{item.context}</span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-medium text-primary">
                    Buka konteks <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-ink">
        <p className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          Antrean ini tidak mengubah lifecycle atau permission. Setiap tindakan tetap diselesaikan melalui workspace sumbernya.
        </p>
      </aside>
    </div>
  );
}

function QueueMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "danger" | "warning" | "info";
}) {
  const valueTone = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-ink";
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className={`tabular mt-1 text-2xl font-semibold ${valueTone}`}>{value}</dd>
    </div>
  );
}
