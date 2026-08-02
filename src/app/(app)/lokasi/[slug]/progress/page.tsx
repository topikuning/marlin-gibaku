import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Sheet } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CollapsibleCard, type BadgeTone } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { forecastFromSeries, FORECAST_STATUS } from "@/lib/forecast";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { cumulativeVolumeByLineage, getProgresDraftAdendum } from "@/lib/progress";
import { laggingItems } from "@/lib/progress-calc";
import { getPeriodBounds } from "@/lib/periodic-report";
import { deriveCategorySchedule, getScurveSeries } from "@/lib/baseline";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort, formatTanggal } from "@/lib/format";
import type { BaselineSource, RevisionStatus } from "@/generated/prisma/enums";
import { requireLocationPage } from "../get-location";
import { IssuesPanel, type IssueData } from "./issues-client";
import { RecalcBaselineButton } from "./recalc-baseline";
import { BaselineEditor } from "./baseline-editor";
import { ScheduleEditor } from "./schedule-editor";
import { JadwalImport } from "./jadwal-import";
import { BaselineHistory, type BaselineHistoryRow } from "./baseline-history";
import { withBackTo } from "@/lib/print-back";

export const metadata: Metadata = { title: "Progress Lokasi" };
export const dynamic = "force-dynamic";

const BASELINE_SOURCE_LABEL: Record<BaselineSource, string> = {
  auto: "Otomatis (impor RAB)",
  adendum: "Adendum",
  manual: "Edit manual",
};

const BASELINE_STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft",
  aktif: "Aktif",
  digantikan: "Digantikan",
};

const BASELINE_STATUS_TONE: Record<RevisionStatus, BadgeTone> = {
  draft: "warning",
  aktif: "success",
  digantikan: "neutral",
};

export default async function ProgressLokasiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "progress.view");
  const canManageIssues = can(user.role, "issue.manage");
  const canManageBaseline = can(user.role, "baseline.manage");

  const [series, realizedVol, issues, baselines, bounds] = await Promise.all([
    getScurveSeries(location.id),
    cumulativeVolumeByLineage(location.id),
    db.issue.findMany({
      where: { locationId: location.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        createdAt: true,
        actions: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            description: true,
            picName: true,
            dueDate: true,
            status: true,
            updates: {
              orderBy: { createdAt: "asc" },
              select: { id: true, note: true, createdAt: true },
            },
          },
        },
      },
    }),
    db.baseline.findMany({
      where: { locationId: location.id },
      orderBy: { baselineNo: "desc" },
      select: {
        id: true,
        baselineNo: true,
        source: true,
        status: true,
        contractDays: true,
        note: true,
        createdAt: true,
        points: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, plannedPct: true } },
      },
    }),
    getPeriodBounds(location.id, { assume: true }),
  ]);

  const activeBaseline = baselines.find((b) => b.status === "aktif");

  // Prognosa (forecast) jadwal/fisik — derived dari kurva-S. Tanggal hanya bila
  // SPMK sudah terbit (bounds.assume=false); pra-SPMK cukup minggu & status.
  const forecast = forecastFromSeries(series, bounds && !bounds.assumed ? bounds.startDate : null);
  const fcStatus = FORECAST_STATUS[forecast.status];
  const schedule = canManageBaseline ? await deriveCategorySchedule(location.id) : null;

  const historyRows: BaselineHistoryRow[] = baselines.map((b) => ({
    id: b.id,
    baselineNo: b.baselineNo,
    sourceLabel: BASELINE_SOURCE_LABEL[b.source],
    statusLabel: BASELINE_STATUS_LABEL[b.status],
    statusTone: BASELINE_STATUS_TONE[b.status],
    isActive: b.status === "aktif",
    contractDays: b.contractDays,
    note: b.note,
    createdAtLabel: formatTanggal(b.createdAt),
    points: b.points.map((p) => Number(p.plannedPct)),
  }));

  // ── Item tertinggal: realisasi kumulatif < target proporsional plan ──────
  // Sederhana & jelas: target volume item minggu ini = volume RAB × plan% —
  // asumsi semua item bergerak proporsional terhadap kurva rencana.
  const planNow = series.planPct[series.currentWeek - 1] ?? 0;
  const planFraction = planNow / 100;
  type LaggingItem = {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    volume: number;
    expected: number;
    realized: number;
    gapValue: number;
  };
  let lagging: LaggingItem[] = [];
  if (planFraction > 0) {
    const activeItems = await db.rabNode.findMany({
      where: { revision: { locationId: location.id, status: "aktif" }, kind: "item" },
      select: { id: true, code: true, name: true, unit: true, volume: true, unitPrice: true, amount: true, lineageKey: true },
    });
    // Formula ada di calculation layer, bukan di halaman (audit 2026-07-27, M6).
    const meta = new Map(activeItems.map((n) => [n.lineageKey, n]));
    lagging = laggingItems(
      activeItems.map((n) => ({
        lineageKey: n.lineageKey,
        volK: n.volume != null ? Number(n.volume) : 0,
        amount: Number(n.amount),
        volSd: realizedVol.get(n.lineageKey) ?? 0,
      })),
      planFraction,
    ).map((it) => {
      const n = meta.get(it.lineageKey)!;
      return {
        id: n.id,
        code: n.code,
        name: n.name,
        unit: n.unit,
        volume: it.volK,
        expected: it.expected,
        realized: it.realized,
        gapValue: it.gapValue,
      };
    });
  }

  const issueData: IssueData[] = issues.map((i) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity,
    status: i.status,
    createdAt: i.createdAt.toISOString(),
    actions: i.actions.map((a) => ({
      id: a.id,
      description: a.description,
      picName: a.picName,
      dueDate: a.dueDate ? a.dueDate.toISOString() : null,
      status: a.status,
      updates: a.updates.map((u) => ({ id: u.id, note: u.note, createdAt: u.createdAt.toISOString() })),
    })),
  }));

  // Progres terhadap draft adendum — ditampilkan HANYA bila lokasinya memang
  // sedang punya draft. Angka ini bukan angka resmi (DECISIONS 210).
  const draftProg = await getProgresDraftAdendum(location.id);

  return (
    <div className="space-y-4">
      {draftProg ? (
        <Card>
          <CardHeader
            title={`Progres seandainya adendum disetujui — draft revisi #${draftProg.revisionNo}`}
            subtitle="BUKAN angka resmi. Termin, kurva-S, dan blanko KKP tetap memakai RAB kontrak yang berlaku."
            action={
              <Link
                href={`/lokasi/${slug}/rab/adendum`}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Buka draft adendum →
              </Link>
            }
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">Nilai RAB draft</p>
                <p className="tabular text-sm font-semibold text-ink">
                  {formatRupiah(Number(draftProg.grandTotal))}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                  Terpasang menurut draft
                </p>
                <p className="tabular text-sm font-semibold text-ink">
                  {formatRupiah(Number(draftProg.realizedValue))}{" "}
                  <span className="font-normal text-ink-muted">
                    ({formatPct(draftProg.realizedPct)})
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                  Terpasang menurut RAB resmi
                </p>
                <p className="tabular text-sm font-semibold text-ink">
                  {formatRupiah(Number(draftProg.realizedValueResmi))}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[13px] text-ink-muted">
              {draftProg.barisBasisDraft === 0
                ? "Belum ada baris laporan yang dicatat terhadap draft ini — angka di atas berasal dari laporan yang sudah ada, dinilai memakai RAB draft."
                : `${draftProg.barisBasisDraft} baris laporan dicatat terhadap draft ini (pekerjaan yang belum ada dasarnya di kontrak berjalan).`}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Kurva-S"
            subtitle="Baseline aktif vs realisasi mingguan"
            action={
              <div className="flex flex-wrap items-center gap-2">
                {bounds ? (
                  <>
                    <Link
                      href={withBackTo(`/cetak/jadwal/${slug}`, `/lokasi/${slug}/progress`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted hover:border-border-strong"
                    >
                      <CalendarClock aria-hidden className="size-4" /> Cetak Jadwal
                    </Link>
                    <a
                      href={`/lokasi/${slug}/jadwal/export`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted hover:border-border-strong"
                    >
                      <Sheet aria-hidden className="size-4" /> Unduh Excel
                    </a>
                  </>
                ) : null}
                {canManageBaseline ? <RecalcBaselineButton locationId={location.id} /> : null}
              </div>
            }
          />
          <CardBody>
            <ScurveChart series={series} forecast={forecast.enoughData ? forecast.forecastPct : null} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rencana vs realisasi per minggu" />
          <CardBody>
            {series.totalWeeks === 0 ? (
              <p className="text-sm text-ink-muted">Belum ada baseline.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                      <th className="py-1.5 pr-3">Minggu</th>
                      <th className="py-1.5 pr-3 text-right">Rencana</th>
                      <th className="py-1.5 pr-3 text-right">Realisasi</th>
                      <th className="py-1.5">Deviasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {series.planPct.map((plan, i) => {
                      const actual = series.actualPct[i];
                      const isCurrent = i + 1 === series.currentWeek;
                      return (
                        <tr key={i} className={isCurrent ? "bg-surface-muted font-medium" : undefined}>
                          <td className="tabular py-1.5 pr-3">
                            {i + 1}
                            {isCurrent ? " (berjalan)" : ""}
                          </td>
                          <td className="tabular py-1.5 pr-3 text-right">{formatPct(plan)}</td>
                          <td className="tabular py-1.5 pr-3 text-right">
                            {actual == null ? "—" : formatPct(actual)}
                          </td>
                          <td className="py-1.5">
                            {actual == null ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              <DeltaBadge value={actual - plan} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {series.totalWeeks > 0 ? (
        <Card>
          <CardHeader
            title="Prognosa penyelesaian"
            subtitle="Proyeksi ke depan dari laju realisasi terkini + kinerja kumulatif (SPI). Estimasi berbasis tren, bukan kepastian."
            action={
              can(user.role, "ai.view") ? (
                <Link
                  href={`/ai?scopeIds=${location.id}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Jelaskan dengan AI →
                </Link>
              ) : null
            }
          />
          <CardBody>
            {!forecast.enoughData ? (
              <p className="text-sm text-ink-muted">
                {fcStatus.label} — prognosa tampil setelah ada realisasi minimal 2 minggu.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Status</div>
                  <div className="mt-1.5">
                    <Badge tone={fcStatus.tone} label={fcStatus.label} />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Prognosa selesai</div>
                  <div className="mt-1 text-base font-semibold text-ink">
                    {forecast.beyondHorizon
                      ? "Belum bisa diperkirakan"
                      : forecast.forecastFinishDate
                        ? formatTanggal(forecast.forecastFinishDate)
                        : `± minggu ${Math.round(forecast.forecastFinishWeek ?? forecast.totalWeeks)}`}
                  </div>
                  <div className="text-[12px] text-ink-muted">
                    rencana: {bounds && !bounds.assumed ? formatTanggal(bounds.endDate) : `minggu ${forecast.totalWeeks}`}
                    {forecast.beyondHorizon
                      ? " · laju realisasi terlalu rendah — proyeksi jatuh >1 tahun melewati rencana"
                      : forecast.slipWeeks != null
                        ? ` · ${forecast.slipWeeks <= 0 ? "tepat / lebih cepat" : `perkiraan telat ~${forecast.slipWeeks} mgg`}`
                        : ""}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Realisasi vs rencana (mgg {forecast.currentWeek})
                  </div>
                  <div className="mt-1 text-base font-semibold text-ink">
                    {formatPct(forecast.actualPct)} <span className="text-ink-muted">/ {formatPct(forecast.planPct)}</span>
                  </div>
                  <div className="mt-1">
                    <DeltaBadge value={forecast.deviationPct} />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Laju terkini / dibutuhkan
                  </div>
                  <div className="mt-1 text-base font-semibold text-ink">
                    {forecast.velocityPerWeek != null ? `${forecast.velocityPerWeek.toFixed(2)}%` : "—"}
                    <span className="text-ink-muted">
                      {" / "}
                      {forecast.requiredPerWeek != null ? `${forecast.requiredPerWeek.toFixed(2)}%` : "—"}/mgg
                    </span>
                  </div>
                  {forecast.spi != null ? (
                    <div className="text-[12px] text-ink-muted">SPI {forecast.spi.toFixed(2)}</div>
                  ) : null}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {canManageBaseline && schedule ? (
        <CollapsibleCard
          title="Jadwal per pekerjaan (kurva-S)"
          subtitle="Atur rentang minggu tiap pekerjaan — boleh >1 rentang bila terputus (jeda); bobot mengikuti RAB. Klik untuk membuka."
        >
          <ScheduleEditor
            locationId={location.id}
            totalWeeks={schedule.totalWeeks}
            origin={schedule.origin}
            initial={schedule.rows}
          />
          <JadwalImport locationId={location.id} />
        </CollapsibleCard>
      ) : null}

      {canManageBaseline && activeBaseline && activeBaseline.points.length > 0 ? (
        <CollapsibleCard
          title="Penyesuaian halus %-mingguan"
          subtitle="Koreksi kecil deret %-kumulatif per minggu (mis. menyamakan dengan angka pengawas). Jadwal per pekerjaan ikut menyesuaikan. Klik untuk membuka."
        >
          <BaselineEditor
            locationId={location.id}
            baselineId={activeBaseline.id}
            initial={activeBaseline.points.map((p) => Number(p.plannedPct))}
          />
        </CollapsibleCard>
      ) : null}

      <Card>
        <CardHeader
          title="Item tertinggal"
          subtitle={`Realisasi kumulatif di bawah target proporsional rencana (${formatPct(planNow)} pada minggu ${series.currentWeek}) — 10 terbesar berdasar nilai kekurangan.`}
        />
        <CardBody>
          {lagging.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {planFraction > 0
                ? "Tidak ada item volume yang tertinggal dari target proporsional."
                : "Belum ada target rencana untuk dibandingkan."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Uraian</th>
                    <th className="py-2 pr-3 text-right">Vol RAB</th>
                    <th className="py-2 pr-3 text-right">Target s/d mgg ini</th>
                    <th className="py-2 pr-3 text-right">Realisasi</th>
                    <th className="py-2 pr-3 text-right">Kekurangan</th>
                    <th className="py-2 text-right">Nilai kekurangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lagging.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 pr-3 text-xs text-ink-muted">{it.code}</td>
                      <td className="max-w-80 truncate py-2 pr-3" title={it.name}>{it.name}</td>
                      <td className="tabular py-2 pr-3 text-right">
                        {formatNumber(it.volume)} {it.unit ?? ""}
                      </td>
                      <td className="tabular py-2 pr-3 text-right">{formatNumber(it.expected)}</td>
                      <td className="tabular py-2 pr-3 text-right">{formatNumber(it.realized)}</td>
                      <td className="tabular py-2 pr-3 text-right text-danger">
                        {formatNumber(it.expected - it.realized)}
                      </td>
                      <td className="tabular py-2 text-right">{formatRupiahShort(it.gapValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Kendala & pemulihan"
          subtitle="Catat kendala lapangan, susun aksi pemulihan (PIC + target), dan log perkembangannya."
        />
        <CardBody>
          <IssuesPanel locationId={location.id} issues={issueData} canManage={canManageIssues} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Riwayat baseline"
          subtitle="Baseline tidak pernah diedit in place — setiap perubahan membuat versi baru. Centang beberapa versi untuk membandingkan kurvanya; versi lama bisa dipulihkan (dibuat sebagai salinan baru)."
        />
        <CardBody>
          <BaselineHistory baselines={historyRows} canManage={canManageBaseline} />
        </CardBody>
      </Card>
    </div>
  );
}
