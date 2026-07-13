import { db } from "@/lib/db";
import { getLocationProgress } from "@/lib/progress";
import { getPlannedSeries } from "@/lib/scurve-plan";

export const FINANCE_FIELDS = ["invoicedValue", "paidValue", "spentValue", "budgetCap"] as const;
export type FinanceField = (typeof FINANCE_FIELDS)[number];

export type FinanceRow = {
  id: string;
  slug: string;
  name: string;
  contract: bigint;
  terpasang: bigint; // nilai pekerjaan terpasang (realisasi)
  invoiced: bigint;
  paid: bigint;
  spent: bigint;
  budgetCap: bigint;
  belumDitagih: bigint; // terpasang - invoiced (>=0)
  need30d: bigint; // kebutuhan dana ~30 hari (rencana fisik 4 minggu ke depan)
};

export async function getFinanceRows(
  locations: {
    id: string;
    slug: string;
    name: string;
    invoicedValue: bigint;
    paidValue: bigint;
    spentValue: bigint;
    budgetCap: bigint;
    contract: { startDate: Date; contractValue: bigint };
  }[]
): Promise<FinanceRow[]> {
  return Promise.all(
    locations.map(async (l) => {
      const [progress, planned] = await Promise.all([
        getLocationProgress(l.id, l.contract.startDate),
        getPlannedSeries(l.id),
      ]);
      const terpasang = progress.realizedValue;
      const belumDitagih = terpasang > l.invoicedValue ? terpasang - l.invoicedValue : 0n;

      // Kebutuhan dana ~30 hari = nilai fisik rencana 4 minggu ke depan.
      const pct = planned.plannedPct;
      const now = Math.min(progress.weekNumber, pct.length);
      const target = Math.min(now + 4, pct.length);
      const deltaPct = pct.length > 0 && target > now ? (pct[target - 1] ?? 0) - (pct[now - 1] ?? 0) : 0;
      const need30d = BigInt(Math.max(0, Math.round((deltaPct / 100) * Number(progress.grandTotal))));

      return {
        id: l.id,
        slug: l.slug,
        name: l.name,
        contract: l.contract.contractValue,
        terpasang,
        invoiced: l.invoicedValue,
        paid: l.paidValue,
        spent: l.spentValue,
        budgetCap: l.budgetCap,
        belumDitagih,
        need30d,
      };
    })
  );
}

export type FinanceRollup = {
  contract: bigint;
  terpasang: bigint;
  invoiced: bigint;
  paid: bigint;
  spent: bigint;
  budgetCap: bigint;
  belumDitagih: bigint;
  need30d: bigint;
  serapanPct: number; // paid / contract
};

export function financeRollup(rows: FinanceRow[]): FinanceRollup {
  const sum = (f: (r: FinanceRow) => bigint) => rows.reduce((s, r) => s + f(r), 0n);
  const contract = sum((r) => r.contract);
  const paid = sum((r) => r.paid);
  return {
    contract,
    terpasang: sum((r) => r.terpasang),
    invoiced: sum((r) => r.invoiced),
    paid,
    spent: sum((r) => r.spent),
    budgetCap: sum((r) => r.budgetCap),
    belumDitagih: sum((r) => r.belumDitagih),
    need30d: sum((r) => r.need30d),
    serapanPct: contract > 0n ? (Number(paid) / Number(contract)) * 100 : 0,
  };
}
