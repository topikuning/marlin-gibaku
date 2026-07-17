import type { Metadata } from "next";
import { Card, CardBody, CardHeader, StatusPill, type BadgeTone } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { getScurveSeries } from "@/lib/baseline";
import { formatNumber, formatPct, formatRupiahShort, formatTanggal } from "@/lib/format";
import type { BaselineSource, RevisionStatus } from "@/generated/prisma/enums";
import { requireLocationPage } from "../get-location";
import { IssuesPanel, type IssueData } from "./issues-client";
import { RecalcBaselineButton } from "./recalc-baseline";

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

  const [series, realizedVol, issues, baselines] = await Promise.all([
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
  ]);

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
    lagging = activeItems
      .filter((n) => n.volume != null && Number(n.volume) > 0)
      .map((n) => {
        const volume = Number(n.volume);
        const expected = volume * planFraction;
        const realized = realizedVol.get(n.lineageKey) ?? 0;
        const unitPrice = n.unitPrice != null ? Number(n.unitPrice) : Number(n.amount) / volume;
        return {
          id: n.id,
          code: n.code,
          name: n.name,
          unit: n.unit,
          volume,
          expected,
          realized,
          gapValue: Math.max(0, (expected - realized) * unitPrice),
        };
      })
      .filter((it) => it.realized < it.expected - 1e-9)
      .sort((a, b) => b.gapValue - a.gapValue)
      .slice(0, 10);
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

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Kurva-S"
            subtitle="Baseline aktif vs realisasi mingguan"
            action={canManageBaseline ? <RecalcBaselineButton locationId={location.id} /> : undefined}
          />
          <CardBody>
            <ScurveChart series={series} />
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
          subtitle="Baseline tidak pernah diedit in place — setiap perubahan membuat versi baru."
        />
        <CardBody>
          {baselines.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada baseline.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Versi</th>
                    <th className="py-2 pr-3">Sumber</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Durasi</th>
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">Catatan</th>
                    <th className="py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {baselines.map((b) => (
                    <tr key={b.id} className="align-top">
                      <td className="tabular py-2 pr-3">#{b.baselineNo}</td>
                      <td className="py-2 pr-3">{BASELINE_SOURCE_LABEL[b.source]}</td>
                      <td className="py-2 pr-3">
                        <StatusPill tone={BASELINE_STATUS_TONE[b.status]} label={BASELINE_STATUS_LABEL[b.status]} />
                      </td>
                      <td className="tabular py-2 pr-3 text-right">
                        {b.contractDays} hari ({b.points.length} mgg)
                      </td>
                      <td className="tabular py-2 pr-3">{formatTanggal(b.createdAt)}</td>
                      <td className="max-w-60 truncate py-2 pr-3 text-ink-muted" title={b.note ?? undefined}>
                        {b.note ?? "—"}
                      </td>
                      <td className="py-2">
                        <details>
                          <summary className="cursor-pointer text-[13px] text-primary hover:underline">
                            Lihat
                          </summary>
                          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-surface-muted p-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-ink-muted">
                                  <th className="py-0.5 pr-2">Mgg</th>
                                  <th className="py-0.5 text-right">Rencana kumulatif</th>
                                </tr>
                              </thead>
                              <tbody>
                                {b.points.map((p) => (
                                  <tr key={p.weekNumber}>
                                    <td className="tabular py-0.5 pr-2">{p.weekNumber}</td>
                                    <td className="tabular py-0.5 text-right">{formatPct(Number(p.plannedPct))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
