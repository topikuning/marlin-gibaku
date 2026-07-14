import "server-only";
import { db } from "@/lib/db";

/**
 * Calculation layer keuangan — semua agregat DERIVED dari transaksi.
 * Formula (docs/rebuild/DOMAIN_MODEL.md):
 *   availableBudget    = Σ budget disetujui − Σ expense disetujui − komitmen disetujui belum terealisasi
 *   outstandingPayable = Σ invoice disetujui/dibayar_sebagian − Σ pembayaran keluar
 *   unbilledWork       = nilai terpasang terverifikasi − Σ owner billing (diajukan+)
 *   cashRequirement    = komitmen jatuh tempo + forecast biaya − kas tersedia − pencairan terjadwal
 */

export type LocationFinance = {
  locationId: string;
  budgetTotal: bigint;
  expenseApproved: bigint;
  commitmentOpen: bigint; // disetujui, belum selesai/batal
  availableBudget: bigint;
  invoiceApproved: bigint;
  paymentOut: bigint;
  outstandingPayable: bigint;
};

export async function getLocationsFinance(locationIds: string[]): Promise<Map<string, LocationFinance>> {
  const result = new Map<string, LocationFinance>();
  if (locationIds.length === 0) return result;

  const [budgets, expenses, commitments, commitmentRealized, invoices, payments] = await Promise.all([
    db.budgetLine.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locationIds }, status: "disetujui" },
      _sum: { amount: true },
    }),
    db.expense.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locationIds }, status: "disetujui" },
      _sum: { amount: true },
    }),
    db.commitment.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locationIds }, status: "disetujui", closedAt: null },
      _sum: { amount: true },
    }),
    // realisasi yang menempel pada komitmen terbuka — mengurangi "komitmen belum terealisasi"
    db.expense.groupBy({
      by: ["locationId"],
      where: {
        locationId: { in: locationIds },
        status: "disetujui",
        commitment: { is: { status: "disetujui", closedAt: null } },
      },
      _sum: { amount: true },
    }),
    db.invoice.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locationIds }, status: { in: ["disetujui", "dibayar_sebagian", "lunas"] } },
      _sum: { amount: true },
    }),
    db.paymentOut.groupBy({
      by: ["invoiceId"],
      where: { invoice: { locationId: { in: locationIds } } },
      _sum: { amount: true },
    }),
  ]);

  const invoiceLocByInvoice = await db.invoice.findMany({
    where: { locationId: { in: locationIds } },
    select: { id: true, locationId: true },
  });
  const locByInvoice = new Map(invoiceLocByInvoice.map((i) => [i.id, i.locationId]));
  const paymentByLoc = new Map<string, bigint>();
  for (const p of payments) {
    const loc = locByInvoice.get(p.invoiceId);
    if (!loc) continue;
    paymentByLoc.set(loc, (paymentByLoc.get(loc) ?? 0n) + (p._sum.amount ?? 0n));
  }

  const toMap = (rows: { locationId: string; _sum: { amount: bigint | null } }[]) =>
    new Map(rows.map((r) => [r.locationId, r._sum.amount ?? 0n]));
  const budgetBy = toMap(budgets);
  const expenseBy = toMap(expenses);
  const commitBy = toMap(commitments);
  const commitRealBy = toMap(commitmentRealized);
  const invoiceBy = toMap(invoices);

  for (const locId of locationIds) {
    const budgetTotal = budgetBy.get(locId) ?? 0n;
    const expenseApproved = expenseBy.get(locId) ?? 0n;
    const commitmentGross = commitBy.get(locId) ?? 0n;
    const commitmentRealizedAmt = commitRealBy.get(locId) ?? 0n;
    const commitmentOpen =
      commitmentGross > commitmentRealizedAmt ? commitmentGross - commitmentRealizedAmt : 0n;
    const invoiceApproved = invoiceBy.get(locId) ?? 0n;
    const paymentOutTotal = paymentByLoc.get(locId) ?? 0n;
    result.set(locId, {
      locationId: locId,
      budgetTotal,
      expenseApproved,
      commitmentOpen,
      availableBudget: budgetTotal - expenseApproved - commitmentOpen,
      invoiceApproved,
      paymentOut: paymentOutTotal,
      outstandingPayable: invoiceApproved > paymentOutTotal ? invoiceApproved - paymentOutTotal : 0n,
    });
  }
  return result;
}

export type ContractBilling = {
  contractId: string;
  billed: bigint; // diajukan+
  disbursed: bigint;
  retentionHeld: bigint;
};

export async function getContractsBilling(contractIds: string[]): Promise<Map<string, ContractBilling>> {
  const result = new Map<string, ContractBilling>();
  if (contractIds.length === 0) return result;
  const billings = await db.ownerBilling.findMany({
    where: { contractId: { in: contractIds }, status: { not: "ditolak" } },
    select: {
      contractId: true,
      amount: true,
      retentionHeld: true,
      status: true,
      disbursements: { select: { amount: true } },
    },
  });
  for (const b of billings) {
    const cur = result.get(b.contractId) ?? { contractId: b.contractId, billed: 0n, disbursed: 0n, retentionHeld: 0n };
    if (b.status !== "draft") cur.billed += b.amount;
    cur.retentionHeld += b.retentionHeld;
    for (const d of b.disbursements) cur.disbursed += d.amount;
    result.set(b.contractId, cur);
  }
  return result;
}

/** unbilledWork utk satu kontrak: nilai terpasang terverifikasi (Σ lokasi) − billed. */
export function unbilledWork(installedVerified: bigint, billed: bigint): bigint {
  return installedVerified > billed ? installedVerified - billed : 0n;
}

/** cashRequirement: komitmen jatuh tempo ≤ horizon + forecast − kas tersedia − pencairan dijadwalkan. */
export function cashRequirement(params: {
  commitmentsDue: bigint;
  forecastCost: bigint;
  cashAvailable: bigint;
  scheduledDisbursement: bigint;
}): bigint {
  const need =
    params.commitmentsDue + params.forecastCost - params.cashAvailable - params.scheduledDisbursement;
  return need > 0n ? need : 0n;
}
