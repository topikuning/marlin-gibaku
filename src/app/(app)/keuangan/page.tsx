import type { Metadata } from "next";
import { Card, CardBody, CardHeader, KpiCard } from "@/components/ui";
import { PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getContractsBilling, unbilledWork } from "@/lib/finance/calc";
import { financeSummary, pendingApprovals } from "@/lib/finance/queries";
import { formatRupiah, formatRupiahShort } from "@/lib/format";
import { ApprovalQueue, type QueueItem } from "./approval-queue";
import { PortfolioGrid, type PortfolioRow } from "./portfolio-grid";
import { COMMITMENT_TYPE_LABEL } from "./finance-ui";

export const metadata: Metadata = { title: "Keuangan" };
export const dynamic = "force-dynamic";

export default async function KeuanganPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "finance.view");
  const canApprove = can(user.role, "finance.approve");
  const locIds = await accessibleLocationIds(user);

  const locations = await db.location.findMany({
    where: locIds === null ? {} : { id: { in: locIds } },
    select: { id: true, name: true, slug: true, province: true },
    orderBy: { name: "asc" },
  });
  const ids = locations.map((l) => l.id);

  const [summary, pending, contracts] = await Promise.all([
    financeSummary(ids),
    pendingApprovals(locIds),
    db.contract.findMany({
      where: { package: { locations: { some: { id: { in: ids } } } } },
      select: { id: true, package: { select: { locations: { select: { id: true } } } } },
    }),
  ]);
  const billing = await getContractsBilling(contracts.map((c) => c.id));

  // ── Belum tertagih per lokasi: kontrak multi-lokasi dialokasikan proporsional terpasang ──
  const inScope = new Set(ids);
  const unbilledByLoc = new Map<string, bigint>();
  let totalBilled = 0n;
  let totalDisbursed = 0n;
  for (const c of contracts) {
    const b = billing.get(c.id);
    const contractLocs = c.package.locations.filter((l) => inScope.has(l.id));
    const installedTotal = contractLocs.reduce(
      (s, l) => s + (summary.get(l.id)?.installedValue ?? 0n),
      0n,
    );
    const unbilled = unbilledWork(installedTotal, b?.billed ?? 0n);
    totalBilled += b?.billed ?? 0n;
    totalDisbursed += b?.disbursed ?? 0n;
    for (const l of contractLocs) {
      const share =
        contractLocs.length === 1
          ? unbilled
          : installedTotal > 0n
            ? (unbilled * (summary.get(l.id)?.installedValue ?? 0n)) / installedTotal
            : 0n;
      unbilledByLoc.set(l.id, (unbilledByLoc.get(l.id) ?? 0n) + share);
    }
  }

  // ── Total portfolio ──
  let totalBudget = 0n;
  let totalExpense = 0n;
  let totalCommitment = 0n;
  let totalAvailable = 0n;
  let totalOutstanding = 0n;
  let totalInstalled = 0n;
  for (const s of summary.values()) {
    totalBudget += s.budgetTotal;
    totalExpense += s.expenseApproved;
    totalCommitment += s.commitmentOpen;
    totalAvailable += s.availableBudget;
    totalOutstanding += s.outstandingPayable;
    totalInstalled += s.installedValue;
  }

  const gridRows: PortfolioRow[] = locations.map((l) => {
    const s = summary.get(l.id);
    return {
      locationId: l.id,
      name: l.name,
      slug: l.slug,
      province: l.province,
      budget: Number(s?.budgetTotal ?? 0n),
      realisasi: Number(s?.expenseApproved ?? 0n),
      komitmen: Number(s?.commitmentOpen ?? 0n),
      available: Number(s?.availableBudget ?? 0n),
      outstanding: Number(s?.outstandingPayable ?? 0n),
      terpasang: Number(s?.installedValue ?? 0n),
      unbilled: Number(unbilledByLoc.get(l.id) ?? 0n),
    };
  });

  // ── Antrean approval lintas jenis (exception-first) ──
  const queue: QueueItem[] = [
    ...pending.commitments.map((c) => ({
      kind: "commitment" as const,
      id: c.id,
      kindLabel: `Komitmen · ${COMMITMENT_TYPE_LABEL[c.type]}`,
      description: `${c.number} — ${c.description}${c.vendor ? ` (${c.vendor.name})` : ""}`,
      context: c.location.name,
      href: `/lokasi/${c.location.slug}/keuangan`,
      amount: c.amount.toString(),
      createdAt: c.createdAt.toISOString(),
    })),
    ...pending.expenses.map((e) => ({
      kind: "expense" as const,
      id: e.id,
      kindLabel: "Realisasi",
      description: `${e.description}${e.commitment ? ` (komitmen ${e.commitment.number})` : ""}`,
      context: e.location.name,
      href: `/lokasi/${e.location.slug}/keuangan`,
      amount: e.amount.toString(),
      createdAt: e.createdAt.toISOString(),
    })),
    ...pending.invoices.map((i) => ({
      kind: "invoice" as const,
      id: i.id,
      kindLabel: "Invoice vendor",
      description: `${i.number}${i.commitment ? ` (komitmen ${i.commitment.number})` : ""}`,
      context: i.location.name,
      href: `/lokasi/${i.location.slug}/keuangan`,
      amount: i.amount.toString(),
      createdAt: i.createdAt.toISOString(),
    })),
    ...pending.billings.map((b) => ({
      kind: "billing" as const,
      id: b.id,
      kindLabel: `Penagihan owner · Termin ${b.terminNo}`,
      description: b.description || `Termin ${b.terminNo}`,
      context: `${b.contract.package.name} — ${b.contract.contractNumber}`,
      href: null,
      amount: b.amount.toString(),
      createdAt: b.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Keuangan Portfolio"
        description="Semua angka derived dari transaksi (budget, komitmen, realisasi, invoice, penagihan) — tidak ada input agregat manual."
      />

      <section id="antrean" aria-label="Antrean approval">
        <Card>
          <CardHeader
            title={`Antrean approval (${queue.length})`}
            subtitle={
              canApprove
                ? "Transaksi diajukan lintas jenis — putuskan di sini."
                : "Transaksi diajukan menunggu keputusan approver."
            }
          />
          <CardBody>
            <ApprovalQueue items={queue} canApprove={canApprove} />
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Ringkasan keuangan">
        <KpiCard label="Budget" value={formatRupiahShort(totalBudget)} href="#per-lokasi" />
        <KpiCard label="Realisasi" value={formatRupiahShort(totalExpense)} href="#per-lokasi" />
        <KpiCard label="Komitmen terbuka" value={formatRupiahShort(totalCommitment)} href="#per-lokasi" />
        <KpiCard
          label="Available budget"
          value={formatRupiahShort(totalAvailable)}
          tone={totalAvailable < 0n ? "danger" : "default"}
          sub={totalAvailable < 0n ? formatRupiah(totalAvailable) : undefined}
          href="#per-lokasi"
        />
        <KpiCard label="Outstanding payable" value={formatRupiahShort(totalOutstanding)} href="#per-lokasi" />
        <KpiCard label="Terpasang" value={formatRupiahShort(totalInstalled)} sub="nilai terpasang terverifikasi" href="#per-lokasi" />
        <KpiCard label="Tertagih" value={formatRupiahShort(totalBilled)} sub="owner billing diajukan+" href="#per-lokasi" />
        <KpiCard label="Cair" value={formatRupiahShort(totalDisbursed)} sub="pencairan diterima" href="#per-lokasi" />
      </section>

      <section id="per-lokasi" aria-label="Keuangan per lokasi">
        <Card>
          <CardHeader title="Per lokasi" subtitle="Klik lokasi untuk detail transaksi & form input." />
          <CardBody>
            <PortfolioGrid rows={gridRows} />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
