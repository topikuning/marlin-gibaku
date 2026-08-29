import type { Metadata } from "next";
import { Card, CardBody, CardHeader, KpiCard } from "@/components/ui";
import { PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { alokasiBelumTertagih, getContractsBilling, totalPortofolio } from "@/lib/finance/calc";
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
    where: locationScopeWhere(user, locIds),
    select: { id: true, name: true, slug: true, province: true },
    orderBy: { name: "asc" },
  });
  const ids = locations.map((l) => l.id);

  const [summary, pending, contracts] = await Promise.all([
    financeSummary(ids),
    pendingApprovals(locIds),
    db.contract.findMany({
      where: { package: { locations: { some: { id: { in: ids } } } } },
      select: { id: true, ppnPercent: true, package: { select: { locations: { select: { id: true } } } } },
    }),
  ]);
  const billing = await getContractsBilling(contracts.map((c) => c.id));

  /*
   * Angka uang TIDAK dihitung di halaman ini — halaman hanya menyaring lingkup
   * lalu memanggil calculation layer (`finance/calc.ts`). Sebelumnya Σ dan
   * alokasi proporsionalnya ditulis di sini, dan itu membuat angka "belum
   * tertagih" mustahil dipakai AI/PDF/Excel tanpa menyalin formulanya.
   */
  const inScope = new Set(ids);
  const terpasangPerLokasi = new Map(
    [...summary.entries()].map(([id, s]) => [id, s.installedValue] as const),
  );
  const {
    perLokasi: unbilledByLoc,
    totalBilled,
    totalDisbursed,
  } = alokasiBelumTertagih(
    contracts.map((c) => ({
      contractId: c.id,
      ppnPercent: Number(c.ppnPercent),
      locationIds: c.package.locations.filter((l) => inScope.has(l.id)).map((l) => l.id),
    })),
    billing,
    terpasangPerLokasi,
  );

  const total = totalPortofolio(summary.values());

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
      description: `${c.number} – ${c.description}${c.vendor ? ` (${c.vendor.name})` : ""}`,
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
      context: `${b.contract.package.name} – ${b.contract.contractNumber}`,
      href: null,
      amount: b.amount.toString(),
      createdAt: b.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Keuangan Portfolio"
        description="Semua angka derived dari transaksi (budget, komitmen, realisasi, invoice, penagihan) – tidak ada input agregat manual."
      />

      <section id="antrean" aria-label="Antrean approval">
        <Card>
          <CardHeader
            title={`Antrean approval (${queue.length})`}
            subtitle={
              canApprove
                ? "Transaksi diajukan lintas jenis – putuskan di sini."
                : "Transaksi diajukan menunggu keputusan approver."
            }
          />
          <CardBody>
            <ApprovalQueue items={queue} canApprove={canApprove} />
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Ringkasan keuangan">
        <KpiCard label="Budget" value={formatRupiahShort(total.budget)} href="#per-lokasi" />
        <KpiCard label="Realisasi" value={formatRupiahShort(total.expense)} href="#per-lokasi" />
        <KpiCard label="Komitmen terbuka" value={formatRupiahShort(total.commitment)} href="#per-lokasi" />
        <KpiCard
          label="Available budget"
          value={formatRupiahShort(total.available)}
          tone={total.available < 0n ? "danger" : "default"}
          sub={total.available < 0n ? formatRupiah(total.available) : undefined}
          href="#per-lokasi"
        />
        <KpiCard label="Outstanding payable" value={formatRupiahShort(total.outstanding)} href="#per-lokasi" />
        <KpiCard label="Terpasang" value={formatRupiahShort(total.installed)} sub="dilaporkan (dikirim+disetujui+final) – belum tentu terverifikasi" href="#per-lokasi" />
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
