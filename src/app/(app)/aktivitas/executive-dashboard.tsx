import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  FileWarning,
  LayoutDashboard,
  MapPin,
  Package as PackageIcon,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card, StatusPill } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { getDashboardData, getActivityCentre } from "@/lib/dashboard";
import { formatPct, formatRupiahShort, formatTanggal } from "@/lib/format";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { ISSUE_SEVERITY_LABEL, ISSUE_SEVERITY_TONE, RECOVERY_STATUS_LABEL, RECOVERY_STATUS_TONE } from "@/app/(app)/lokasi/[slug]/issue-labels";
import { DashboardMap } from "./dashboard-map";
import { DashboardSearch } from "./dashboard-search";

/**
 * Dashboard Eksekutif — pantau laporan harian, deviasi progres, kendala, solusi,
 * foto lapangan, dan ringkasan portofolio (nilai kontrak/terpasang, antrean
 * verifikasi) seluruh proyek dalam satu layar. Data nyata, dibatasi ke lokasi
 * yang boleh dilihat user (peran manajemen; cross-location = semua).
 */
export async function ExecutiveDashboard({ user }: { user: SessionUser }) {
  const locIds = await accessibleLocationIds(user);

  const [data, activity] = await Promise.all([getDashboardData(locIds, user.orgId), getActivityCentre(locIds, 4)]);
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
          <DashboardSearch locations={data.locationsIndex} />
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-ink-muted">
            <Clock aria-hidden className="size-3.5" />
            <span>
              Diperbarui <span className="font-medium text-ink">{jamWIB} WIB</span>
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

      {/* Portofolio & administrasi (gabungan Command Center) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          icon={<Wallet aria-hidden />}
          tone="primary"
          label="Nilai Kontrak"
          value={formatRupiahShort(data.finance.totalContract)}
          sub="RAB aktif · pra-PPN"
          href="/progress"
        />
        <StatCard
          icon={<TrendingUp aria-hidden />}
          tone="success"
          label="Nilai Terpasang"
          value={formatRupiahShort(data.finance.totalRealized)}
          sub={
            <>
              <span>{formatPct(data.finance.realizedPct)} dari kontrak</span>
              <Bar value={data.finance.realizedPct} tone="success" />
            </>
          }
          href="/progress"
        />
        <StatCard icon={<PackageIcon aria-hidden />} tone="info" label="Paket Aktif" value={data.paketAktif} sub="sedang berjalan" href="/paket" />
        <StatCard icon={<ClipboardCheck aria-hidden />} tone="warning" label="Menunggu Verifikasi" value={data.menungguVerifikasi} sub="laporan dikirim" href="/laporan" />
        <StatCard icon={<FileWarning aria-hidden />} tone="danger" label="Perlu Koreksi" value={data.perluKoreksi} sub="dikembalikan" href="/laporan" />
      </div>

      {/* Peta + Status submit */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Peta Monitoring Lokasi</h2>
          </div>
          <div className="flex flex-1 flex-col p-4">
            <div className="min-h-[300px] flex-1">
              <DashboardMap markers={data.markers} markerTone={data.markerTone} />
            </div>
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
          <div className="space-y-5 p-4">
            <div>
              <div className="flex h-7 w-full overflow-hidden rounded-md bg-surface-inset">
                {kpi.submittedPct > 0 ? <div className="h-full bg-success" style={{ width: `${kpi.submittedPct}%` }} /> : null}
                {kpi.notSubmittedPct > 0 ? <div className="h-full bg-warning" style={{ width: `${kpi.notSubmittedPct}%` }} /> : null}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <span className="size-2 rounded-full bg-success" /> Sudah{" "}
                  <span className="tabular font-semibold text-ink">{kpi.submittedToday}</span>
                  <span className="text-ink-faint">({formatPct(kpi.submittedPct)})</span>
                </span>
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <span className="size-2 rounded-full bg-warning" /> Belum{" "}
                  <span className="tabular font-semibold text-ink">{kpi.notSubmittedToday}</span>
                  <span className="text-ink-faint">({formatPct(kpi.notSubmittedPct)})</span>
                </span>
              </div>
            </div>

            <MiniList
              dot="bg-ink-faint"
              title="Lokasi Belum Submit"
              right="Update terakhir"
              rows={data.belumSubmit.slice(0, 6).map((l, i) => ({
                key: l.id,
                href: `/lokasi/${l.slug}`,
                rank: i + 1,
                label: l.name,
                value: l.lastReportDate ? formatTanggal(l.lastReportDate) : "Belum ada laporan",
              }))}
            />
            <MiniList
              dot="bg-warning"
              title="Perlu Perhatian"
              right="Deviasi"
              rows={data.perluPerhatian.slice(0, 6).map((l, i) => ({
                key: l.id,
                href: `/lokasi/${l.slug}`,
                rank: i + 1,
                label: l.name,
                value: formatPct(l.deviationPct),
                danger: true,
              }))}
            />
            <Link href="/lokasi" className="flex items-center justify-center gap-1 border-t border-border pt-3 text-xs font-medium text-primary hover:underline">
              Lihat semua lokasi <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* Activity Centre + Deviasi + Kendala */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
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
                      <StatusPill tone="neutral" label={a.typeLabel} />
                      {a.hasKendala ? <StatusPill tone="danger" label="Ada kendala" /> : null}
                      {a.hasSolusi ? <StatusPill tone="success" label="Ada solusi" /> : null}
                      {a.deviationPct != null ? <DeltaBadge value={a.deviationPct} /> : null}
                    </div>
                  </div>
                  {a.thumbs.length > 0 ? (
                    <div className="w-[5.75rem] shrink-0">
                      <PhotoGallery photos={a.thumbs} thumbClass="size-[2.6rem]" />
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
          <div className="px-4 pb-3 pt-1">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="py-1.5 pr-2 text-left font-medium">Lokasi</th>
                  <th className="w-16 py-1.5 text-right font-medium">Rencana</th>
                  <th className="w-14 py-1.5 text-right font-medium">Aktual</th>
                  <th className="w-[4.5rem] py-1.5 pl-2 text-right font-medium">Deviasi</th>
                </tr>
              </thead>
              <tbody>
                {data.deviasiRanking.slice(0, 5).map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="max-w-0 truncate py-2.5 pr-2">
                      <Link href={`/lokasi/${r.slug}`} className="hover:underline">{r.name}</Link>
                    </td>
                    <td className="tabular py-2.5 text-right text-ink-muted">{formatPct(r.planPct)}</td>
                    <td className="tabular py-2.5 text-right">{formatPct(r.realizedPct)}</td>
                    <td className="py-2.5 pl-2 text-right"><DeltaBadge value={r.deviationPct} /></td>
                  </tr>
                ))}
                {data.deviasiRanking.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-xs text-ink-muted">Belum ada baseline/realisasi.</td></tr>
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

function StatCard({ icon, tone, label, value, sub, href }: { icon: ReactNode; tone: Tone; label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const card = (
    <Card className="flex h-full flex-col p-3">
      <div className="flex items-center gap-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-md [&>svg]:size-4 ${TONE_ICON[tone]}`}>{icon}</span>
        <span className="text-[10px] font-medium uppercase leading-tight tracking-wide text-ink-muted">{label}</span>
      </div>
      <div className="tabular mt-2 text-2xl font-semibold leading-none text-ink">{value}</div>
      {sub ? <div className="mt-1.5 text-[11px] text-ink-muted">{sub}</div> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition hover:shadow-sm">
      {card}
    </Link>
  ) : (
    card
  );
}

function Delta({ value, pct, goodWhenUp }: { value: number; pct: number; goodWhenUp: boolean }) {
  const up = value >= 0;
  const good = goodWhenUp ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-medium ${good ? "text-success" : "text-danger"}`}>
      <Icon aria-hidden className="size-3.5" />
      {value > 0 ? "+" : ""}{value} ({formatPct(Math.abs(pct))}) dari kemarin
    </span>
  );
}

function Bar({ value, tone }: { value: number; tone: "success" | "warning" }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
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
  rows: { key: string; href: string; rank: number; label: string; value: string; danger?: boolean }[];
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between border-b border-border pb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <span className={`size-2 rounded-full ${dot}`} />
          {title}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">{right}</span>
      </div>
      <ul>
        {rows.length === 0 ? (
          <li className="py-2 text-xs text-ink-muted">—</li>
        ) : (
          rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-surface-muted">
                <span className="w-4 shrink-0 text-right text-ink-faint">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
                <span className={`shrink-0 tabular ${r.danger ? "font-medium text-danger" : "text-ink-muted"}`}>{r.value}</span>
              </Link>
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
