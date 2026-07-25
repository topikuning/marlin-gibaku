import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  LayoutDashboard,
  MapPin,
  Search,
  TrendingUp,
} from "lucide-react";
import { Card, StatusPill } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getDashboardData, getActivityCentre } from "@/lib/dashboard";
import { formatPct, formatTanggal } from "@/lib/format";
import { FIELD_ACTIVITY_TYPE_LABEL } from "@/lib/field-activity/labels";
import { ISSUE_SEVERITY_LABEL, ISSUE_SEVERITY_TONE, RECOVERY_STATUS_LABEL, RECOVERY_STATUS_TONE } from "@/app/(app)/lokasi/[slug]/issue-labels";
import { DashboardMap } from "./dashboard-map";

export const dynamic = "force-dynamic";

/**
 * Dashboard Eksekutif — pantau laporan harian, deviasi progres, kendala, solusi,
 * dan foto lapangan seluruh proyek dalam satu layar. Data nyata, dibatasi ke
 * lokasi yang boleh dilihat user (peran manajemen; cross-location = semua).
 */
export default async function DashboardEksekutifPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "portfolio.view");
  const locIds = await accessibleLocationIds(user);

  const [data, activity] = await Promise.all([getDashboardData(locIds), getActivityCentre(locIds, 4)]);
  const { kpi } = data;

  const jamWIB = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(data.updatedAt);

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Dashboard Eksekutif</h1>
          <p className="text-sm text-ink-muted">
            Pantau laporan harian, deviasi progres, kendala, solusi, dan foto lapangan seluruh proyek.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-muted sm:flex">
            <Search aria-hidden className="size-4" />
            <span>Cari lokasi / proyek…</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-ink-muted">
            <Clock aria-hidden className="size-3.5" />
            <span>
              Terakhir diperbarui <span className="font-medium text-ink">{jamWIB} WIB</span>
            </span>
          </div>
        </div>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard icon={<MapPin aria-hidden />} tone="info" label="Total Lokasi" value={kpi.totalLokasi} sub="Aktif dipantau" />
        <StatCard
          icon={<CheckCircle2 aria-hidden />}
          tone="success"
          label="Sudah Submit Hari Ini"
          value={kpi.submittedToday}
          sub={
            <>
              <Delta value={kpi.submittedDelta} pct={kpi.submittedDeltaPct} goodWhenUp />
              <Bar value={kpi.submittedPct} tone="success" />
            </>
          }
        />
        <StatCard
          icon={<Clock aria-hidden />}
          tone="warning"
          label="Belum Submit Hari Ini"
          value={kpi.notSubmittedToday}
          sub={
            <>
              <Delta value={kpi.notSubmittedDelta} pct={kpi.notSubmittedDeltaPct} goodWhenUp={false} />
              <Bar value={kpi.notSubmittedPct} tone="warning" />
            </>
          }
        />
        <StatCard icon={<FileText aria-hidden />} tone="primary" label="Total Laporan Hari Ini" value={kpi.totalReportsToday} sub="Laporan harian + kegiatan lapangan" />
        <StatCard
          icon={<AlertTriangle aria-hidden />}
          tone="danger"
          label="Deviasi Negatif Kritis"
          value={kpi.deviasiKritis}
          sub={<span className="text-danger">Butuh tindakan segera</span>}
        />
      </div>

      {/* Peta + Status submit */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Peta Monitoring Lokasi</h2>
          </div>
          <div className="p-4">
            <DashboardMap markers={data.markers} markerTone={data.markerTone} />
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {data.regions.map((r) => (
                <div key={r.region} className="rounded-md border border-border bg-surface-muted px-2 py-1.5 text-center">
                  <div className="truncate text-[11px] text-ink-muted">{r.region}</div>
                  <div className="tabular text-sm font-semibold text-ink">{r.count}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Status Submit Lokasi Hari Ini</h2>
          </div>
          <div className="space-y-4 p-4">
            <div className="flex h-7 w-full overflow-hidden rounded-md text-[11px] font-semibold text-white">
              <div className="flex items-center justify-center bg-success" style={{ width: `${Math.max(kpi.submittedPct, 6)}%` }}>
                {kpi.submittedToday} ({formatPct(kpi.submittedPct)})
              </div>
              <div className="flex items-center justify-center bg-warning" style={{ width: `${Math.max(kpi.notSubmittedPct, 6)}%` }}>
                {kpi.notSubmittedToday} ({formatPct(kpi.notSubmittedPct)})
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <MiniList
                dot="bg-ink-faint"
                title="Lokasi Belum Submit"
                right="Update Terakhir"
                rows={data.belumSubmit.slice(0, 5).map((l, i) => ({
                  key: l.id,
                  href: `/lokasi/${l.slug}`,
                  rank: i + 1,
                  label: l.name,
                  value: l.lastReportDate ? formatTanggal(l.lastReportDate) : "Belum ada laporan",
                  muted: true,
                }))}
              />
              <MiniList
                dot="bg-warning"
                title="Perlu Perhatian"
                right="Deviasi"
                rows={data.perluPerhatian.slice(0, 5).map((l, i) => ({
                  key: l.id,
                  href: `/lokasi/${l.slug}`,
                  rank: i + 1,
                  label: l.name,
                  value: `${l.deviationPct.toFixed(1)} pp`,
                  danger: true,
                }))}
              />
            </div>
            <Link href="/lokasi" className="flex items-center justify-center gap-1 text-xs font-medium text-primary hover:underline">
              Lihat semua lokasi <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* Activity Centre + Deviasi + Kendala */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Activity Centre */}
        <Card>
          <PanelHeader title="Activity Centre" href="/hari-ini" hrefLabel="Lihat semua aktivitas" />
          <div className="divide-y divide-border">
            {activity.length === 0 ? (
              <Empty icon={<Activity aria-hidden />} text="Belum ada kegiatan lapangan." />
            ) : (
              activity.map((a) => (
                <div key={a.id} className="flex gap-3 px-4 py-3">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${toneDot(a.deviationPct)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/lokasi/${a.locationSlug}`} className="truncate text-sm font-medium text-ink hover:underline">
                        {a.locationName}
                      </Link>
                      <span className="shrink-0 text-xs text-ink-faint">
                        {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(a.at)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-ink-muted">{a.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <StatusPill tone="info" label={FIELD_ACTIVITY_TYPE_LABEL[a.type]} />
                      {a.hasKendala ? <StatusPill tone="danger" label="Kendala" /> : null}
                      {a.hasSolusi ? <StatusPill tone="success" label="Solusi" /> : null}
                      {a.photoCount > 0 ? <StatusPill tone="neutral" label={`Foto ${a.photoCount}`} /> : null}
                      {a.deviationPct != null ? <DeltaBadge value={a.deviationPct} /> : null}
                    </div>
                  </div>
                  {a.thumbs.length > 0 ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {a.thumbs.slice(0, 2).map((t) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={t.id} src={t.thumbUrl} alt="" loading="lazy" className="size-11 rounded-md border border-border object-cover" />
                      ))}
                      {a.photoCount > 2 ? (
                        <div className="flex size-11 items-center justify-center rounded-md border border-border bg-surface-inset text-xs font-medium text-ink-muted">
                          +{a.photoCount - 2}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Ringkasan Deviasi */}
        <Card>
          <PanelHeader title="Ringkasan Deviasi Proyek" href="/progress" hrefLabel="Lihat ranking lengkap" />
          <div className="px-2 py-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-ink-muted">
                  <th className="px-2 py-1.5">Lokasi</th>
                  <th className="px-2 py-1.5 text-right">Rencana</th>
                  <th className="px-2 py-1.5 text-right">Aktual</th>
                  <th className="px-2 py-1.5 text-right">Deviasi</th>
                </tr>
              </thead>
              <tbody>
                {data.deviasiRanking.slice(0, 5).map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="max-w-40 truncate px-2 py-2">
                      <Link href={`/lokasi/${r.slug}`} className="hover:underline">{r.name}</Link>
                    </td>
                    <td className="tabular px-2 py-2 text-right text-ink-muted">{formatPct(r.planPct)}</td>
                    <td className="tabular px-2 py-2 text-right">{formatPct(r.realizedPct)}</td>
                    <td className="px-2 py-2 text-right"><DeltaBadge value={r.deviationPct} /></td>
                  </tr>
                ))}
                {data.deviasiRanking.length === 0 ? (
                  <tr><td colSpan={4} className="px-2 py-6 text-center text-xs text-ink-muted">Belum ada baseline/realisasi.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Kendala & Solusi */}
        <Card>
          <PanelHeader
            title="Kendala & Solusi Tertunda"
            href="/lokasi"
            hrefLabel="Lihat semua kendala"
            meta={`${data.kendalaOpen} terbuka · ${data.kendalaKritis} kritis`}
          />
          <div className="divide-y divide-border">
            {data.kendala.length === 0 ? (
              <Empty icon={<CheckCircle2 aria-hidden />} text="Tak ada kendala tertunda." />
            ) : (
              data.kendala.slice(0, 4).map((k) => (
                <div key={k.id} className="flex gap-3 px-4 py-3">
                  <AlertTriangle aria-hidden className={`mt-0.5 size-4 shrink-0 ${k.late || k.severity === "kritis" ? "text-danger" : "text-warning"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{k.title}</p>
                      <StatusPill tone={ISSUE_SEVERITY_TONE[k.severity]} label={ISSUE_SEVERITY_LABEL[k.severity]} />
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      Lokasi: <Link href={`/lokasi/${k.locationSlug}`} className="hover:underline">{k.locationName}</Link>
                      {k.pic ? <> · PIC: {k.pic}</> : null}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      {k.recoveryStatus ? (
                        <StatusPill tone={RECOVERY_STATUS_TONE[k.recoveryStatus]} label={RECOVERY_STATUS_LABEL[k.recoveryStatus]} />
                      ) : (
                        <StatusPill tone="warning" label="Belum ada tindakan" />
                      )}
                      {k.dueDate ? (
                        <span className={k.late ? "font-medium text-danger" : "text-ink-muted"}>
                          Target: {formatTanggal(k.dueDate)}
                          {k.late ? " (terlambat)" : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Arah Navigasi */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NavCard icon={<MapPin aria-hidden />} tone="success" title="Monitoring Lokasi" sub="daftar & detail proyek" href="/lokasi" />
        <NavCard icon={<TrendingUp aria-hidden />} tone="info" title="Analitik Progres" sub="kurva-S & deviasi" href="/progress" />
        <NavCard icon={<LayoutDashboard aria-hidden />} tone="primary" title="Peta Sebaran" sub="monitoring geografis" href="/peta" />
        <NavCard icon={<FileText aria-hidden />} tone="warning" title="Laporan & Export" sub="rekap & unduhan" href="/laporan" />
      </div>
    </div>
  );
}

// ── Komponen lokal (server) ───────────────────────────────────────────────────

type Tone = "info" | "success" | "warning" | "danger" | "primary";
const TONE_ICON: Record<Tone, string> = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  primary: "bg-primary-50 text-primary",
};

function StatCard({ icon, tone, label, value, sub }: { icon: ReactNode; tone: Tone; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5 ${TONE_ICON[tone]}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
          <div className="tabular text-2xl font-semibold leading-tight text-ink">{value}</div>
          {sub ? <div className="mt-1 text-xs text-ink-muted">{sub}</div> : null}
        </div>
      </div>
    </Card>
  );
}

function Delta({ value, pct, goodWhenUp }: { value: number; pct: number; goodWhenUp: boolean }) {
  const up = value >= 0;
  const good = goodWhenUp ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${good ? "text-success" : "text-danger"}`}>
      <Icon aria-hidden className="size-3.5" />
      {Math.abs(value)} ({formatPct(Math.abs(pct))}) dari kemarin
    </span>
  );
}

function Bar({ value, tone }: { value: number; tone: "success" | "warning" }) {
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
      <div className={tone === "success" ? "h-full rounded-full bg-success" : "h-full rounded-full bg-warning"} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function MiniList({
  title,
  right,
  dot,
  rows,
}: {
  title: string;
  right: string;
  dot: string;
  rows: { key: string; href: string; rank: number; label: string; value: string; muted?: boolean; danger?: boolean }[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <span className={`size-2 rounded-full ${dot}`} />
          {title}
        </div>
        <span className="text-[10px] uppercase text-ink-faint">{right}</span>
      </div>
      <ul className="space-y-0.5">
        {rows.length === 0 ? (
          <li className="py-2 text-xs text-ink-muted">—</li>
        ) : (
          rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 text-xs">
              <Link href={r.href} className="flex min-w-0 items-center gap-1.5 hover:underline">
                <span className="w-4 text-ink-faint">{r.rank}</span>
                <span className="truncate text-ink">{r.label}</span>
              </Link>
              <span className={`shrink-0 tabular ${r.danger ? "font-medium text-danger" : "text-ink-muted"}`}>{r.value}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function PanelHeader({ title, href, hrefLabel, meta }: { title: string; href: string; hrefLabel: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {meta ? <span className="text-[11px] text-ink-muted">{meta}</span> : (
        <Link href={href} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {hrefLabel} <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function NavCard({ icon, tone, title, sub, href }: { icon: ReactNode; tone: Tone; title: string; sub: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition hover:border-border-strong hover:shadow-sm">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5 ${TONE_ICON[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="truncate text-xs text-ink-muted">{sub}</div>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
    </Link>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-ink-muted [&>svg]:size-6 [&>svg]:text-ink-faint">
      {icon}
      <p className="text-xs">{text}</p>
    </div>
  );
}

function toneDot(dev: number | null): string {
  if (dev == null) return "bg-ink-faint";
  if (dev < -10) return "bg-danger";
  if (dev < 0) return "bg-warning";
  return "bg-success";
}
