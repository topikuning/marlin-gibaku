import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getLocationProgress, COUNTED_REPORT_STATUSES } from "@/lib/progress";
import { ppnAmount, withPpn } from "@/lib/money";
import { formatTanggal } from "@/lib/format";
import { requireLocationPage } from "../get-location";
import { RabTree, type RabNodeRow } from "./rab-tree";
import { RevisionList, type RevisionRow } from "./revision-list";
import { WeeklyPlanSection, type LeafOption, type PlanItemRow } from "./weekly-plan";

export const metadata: Metadata = { title: "Rencana & RAB" };
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

export default async function RabPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ minggu?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const canManage = can(user.role, "rab.manage");
  const canPlan = can(user.role, "weekly_plan.manage");

  const [progress, revisions] = await Promise.all([
    getLocationProgress(location.id),
    db.rabRevision.findMany({
      where: { locationId: location.id },
      orderBy: { revisionNo: "desc" },
      select: {
        id: true,
        revisionNo: true,
        source: true,
        status: true,
        totalValue: true,
        createdAt: true,
        note: true,
      },
    }),
  ]);
  const active = revisions.find((r) => r.status === "aktif") ?? null;

  const nodes = active
    ? await db.rabNode.findMany({
        where: { revisionId: active.id },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          parentId: true,
          kind: true,
          code: true,
          name: true,
          volume: true,
          unit: true,
          unitPrice: true,
          amount: true,
          sortOrder: true,
        },
      })
    : [];

  // Serialisasi SEKALI untuk boundary client (BigInt → string, Decimal → number).
  const nodeRows: RabNodeRow[] = nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    kind: n.kind,
    code: n.code,
    name: n.name,
    volume: n.volume == null ? null : Number(n.volume),
    unit: n.unit,
    unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
    amount: n.amount.toString(),
    sortOrder: n.sortOrder,
  }));

  const contract = location.package.contract;
  const ppnPercent = contract ? Number(contract.ppnPercent) : 11;
  const grand = active?.totalValue ?? 0n;
  const ppnValue = ppnAmount(grand, ppnPercent);
  const totalWithPpn = withPpn(grand, ppnPercent);

  const revisionRows: RevisionRow[] = revisions.map((r) => ({
    id: r.id,
    revisionNo: r.revisionNo,
    source: r.source,
    status: r.status,
    totalValue: r.totalValue.toString(),
    createdAt: r.createdAt.toISOString(),
    note: r.note,
  }));

  // ── Rencana mingguan (minggu terpilih, default berjalan) ─────────────────
  const parsedWeek = Number.parseInt(sp.minggu ?? "", 10);
  const weekNumber =
    Number.isInteger(parsedWeek) && parsedWeek >= 1 && parsedWeek <= 520
      ? parsedWeek
      : progress.weekNumber;

  const startDate = contract?.startDate ?? null;
  const weekStart = startDate ? new Date(startDate.getTime() + (weekNumber - 1) * 7 * DAY_MS) : null;
  const weekEnd = weekStart ? new Date(weekStart.getTime() + 6 * DAY_MS) : null;

  const [plan, realizedRows] = await Promise.all([
    db.weeklyPlan.findUnique({
      where: { locationId_weekNumber: { locationId: location.id, weekNumber } },
      select: {
        items: {
          orderBy: { priority: "asc" },
          select: {
            id: true,
            targetVolume: true,
            priority: true,
            picName: true,
            note: true,
            rabNode: { select: { code: true, name: true, unit: true, lineageKey: true } },
          },
        },
      },
    }),
    weekStart && weekEnd
      ? db.dailyReportItem.groupBy({
          by: ["lineageKey"],
          where: {
            report: {
              locationId: location.id,
              status: { in: [...COUNTED_REPORT_STATUSES] },
              reportDate: { gte: weekStart, lte: weekEnd },
            },
          },
          _sum: { volumeDone: true },
        })
      : Promise.resolve([]),
  ]);
  const realizedByLineage = new Map(
    realizedRows.map((r) => [r.lineageKey, Number(r._sum.volumeDone ?? 0)]),
  );

  const planItems: PlanItemRow[] = (plan?.items ?? []).map((it) => ({
    id: it.id,
    code: it.rabNode.code,
    name: it.rabNode.name,
    unit: it.rabNode.unit,
    targetVolume: Number(it.targetVolume),
    priority: it.priority,
    picName: it.picName,
    note: it.note,
    realizedVolume: realizedByLineage.get(it.rabNode.lineageKey) ?? 0,
  }));

  const leafOptions: LeafOption[] = nodeRows
    .filter((n) => n.kind === "item")
    .map((n) => ({ id: n.id, code: n.code, name: n.name, unit: n.unit, volume: n.volume }));

  const weekPeriod =
    weekStart && weekEnd ? `${formatTanggal(weekStart)} – ${formatTanggal(weekEnd)}` : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            active
              ? `Pohon RAB — revisi aktif #${active.revisionNo}`
              : "Pohon RAB"
          }
          subtitle={
            active
              ? `${nodeRows.filter((n) => n.kind === "item").length} item pekerjaan · sumber ${active.source === "adendum" ? "adendum" : "HPS awal"}`
              : "Belum ada revisi aktif"
          }
          action={
            canManage ? (
              <Link
                href={`/lokasi/${slug}/rab/import`}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Impor HPS / Adendum
              </Link>
            ) : null
          }
        />
        <CardBody>
          <RabTree
            nodes={nodeRows}
            grandTotal={grand.toString()}
            ppnPercent={ppnPercent}
            ppnValue={ppnValue.toString()}
            totalWithPpn={totalWithPpn.toString()}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Rencana mingguan"
          subtitle="Target volume per item pekerjaan — dibandingkan realisasi laporan harian minggu tsb."
        />
        <CardBody>
          {active ? (
            <WeeklyPlanSection
              locationId={location.id}
              weekNumber={weekNumber}
              currentWeek={progress.weekNumber}
              totalWeeks={progress.totalWeeks}
              weekPeriod={weekPeriod}
              items={planItems}
              options={leafOptions}
              canManage={canPlan}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Rencana mingguan butuh revisi RAB aktif. Impor HPS terlebih dahulu.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Riwayat revisi RAB"
          subtitle="Aktifkan draft untuk menggantikan revisi aktif — realisasi tersambung otomatis via lineage."
        />
        <CardBody>
          <RevisionList revisions={revisionRows} canManage={canManage} />
        </CardBody>
      </Card>
    </div>
  );
}
