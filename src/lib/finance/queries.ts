import "server-only";
import { db } from "@/lib/db";
import { getLocationsFinance, type LocationFinance } from "@/lib/finance/calc";
import { getLocationsProgress } from "@/lib/progress";
import type { CostCategory } from "@/generated/prisma/enums";

/**
 * Query layer keuangan — read-only, dipakai halaman /keuangan dan /lokasi/[slug]/keuangan.
 * Agregat (available budget, outstanding, dst.) TIDAK dihitung di sini —
 * itu tugas calc layer (@/lib/finance/calc). File ini hanya menyusun data baris.
 */

// ── Budget ───────────────────────────────────────────────────

export type EffectiveBudget = {
  id: string;
  amount: bigint;
  note: string | null;
  createdAt: Date;
};

/**
 * Nilai budget BERLAKU per kategori = row disetujui TERBARU per kategori.
 * (setBudgetLine membatalkan row lama, jadi normalnya hanya ada satu row
 * disetujui per kategori — query ini tetap defensif ambil yang terbaru.)
 */
export async function latestBudgetByCategory(
  locationId: string,
): Promise<Map<CostCategory, EffectiveBudget>> {
  const rows = await db.budgetLine.findMany({
    where: { locationId, status: "disetujui" },
    orderBy: { createdAt: "desc" },
    select: { id: true, category: true, amount: true, note: true, createdAt: true },
  });
  const result = new Map<CostCategory, EffectiveBudget>();
  for (const r of rows) {
    if (!result.has(r.category)) {
      result.set(r.category, { id: r.id, amount: r.amount, note: r.note, createdAt: r.createdAt });
    }
  }
  return result;
}

// ── Daftar transaksi per lokasi ──────────────────────────────

export async function listCommitments(locationId: string) {
  const [rows, realized] = await Promise.all([
    db.commitment.findMany({
      where: { locationId },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // realisasi (expense non-ditolak) per komitmen — untuk sisa settlement
    db.expense.groupBy({
      by: ["commitmentId"],
      where: { locationId, commitmentId: { not: null }, status: { not: "ditolak" } },
      _sum: { amount: true },
    }),
  ]);
  const realizedBy = new Map(realized.map((r) => [r.commitmentId, r._sum.amount ?? 0n]));
  return rows.map((c) => ({ ...c, realizedAmount: realizedBy.get(c.id) ?? 0n }));
}

export async function listExpenses(locationId: string) {
  return db.expense.findMany({
    where: { locationId },
    include: { commitment: { select: { number: true, type: true } } },
    orderBy: [{ txDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function listInvoices(locationId: string) {
  const rows = await db.invoice.findMany({
    where: { locationId },
    include: {
      commitment: { select: { number: true, vendor: { select: { name: true } } } },
      payments: { orderBy: { paidDate: "asc" } },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((inv) => ({
    ...inv,
    paidTotal: inv.payments.reduce((s, p) => s + p.amount, 0n),
  }));
}

export async function listVendors(orgId: string) {
  return db.vendor.findMany({
    where: { orgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listOwnerBillings(contractId: string) {
  const rows = await db.ownerBilling.findMany({
    where: { contractId },
    include: { disbursements: { orderBy: { receivedDate: "asc" } } },
    orderBy: { terminNo: "asc" },
  });
  return rows.map((b) => ({
    ...b,
    disbursedTotal: b.disbursements.reduce((s, d) => s + d.amount, 0n),
  }));
}

// ── Antrean approval lintas jenis ────────────────────────────

export type PendingApprovals = Awaited<ReturnType<typeof pendingApprovals>>;

/** Semua transaksi status "diajukan" dalam scope lokasi (null = semua lokasi). */
export async function pendingApprovals(locationIds: string[] | null) {
  const locFilter = locationIds === null ? {} : { locationId: { in: locationIds } };
  const locSelect = { select: { id: true, name: true, slug: true } };
  const [commitments, expenses, invoices, billings] = await Promise.all([
    db.commitment.findMany({
      where: { status: "diajukan", ...locFilter },
      include: { location: locSelect, vendor: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.expense.findMany({
      where: { status: "diajukan", ...locFilter },
      include: { location: locSelect, commitment: { select: { number: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invoice.findMany({
      where: { status: "diajukan", ...locFilter },
      include: { location: locSelect, commitment: { select: { number: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.ownerBilling.findMany({
      where: {
        status: "diajukan",
        ...(locationIds === null
          ? {}
          : { contract: { package: { locations: { some: { id: { in: locationIds } } } } } }),
      },
      include: {
        contract: {
          select: { contractNumber: true, package: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { commitments, expenses, invoices, billings };
}

// ── Ringkasan keuangan per lokasi (finance + nilai terpasang) ─

export type LocationFinanceSummary = LocationFinance & { installedValue: bigint };

/** Gabungan agregat keuangan (calc layer) + nilai terpasang (progress layer). */
export async function financeSummary(
  locationIds: string[],
): Promise<Map<string, LocationFinanceSummary>> {
  const [finance, progress] = await Promise.all([
    getLocationsFinance(locationIds),
    getLocationsProgress(locationIds),
  ]);
  const result = new Map<string, LocationFinanceSummary>();
  for (const id of locationIds) {
    const f = finance.get(id);
    if (!f) continue;
    result.set(id, { ...f, installedValue: progress.get(id)?.realizedValue ?? 0n });
  }
  return result;
}
