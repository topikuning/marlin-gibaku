import "server-only";
import { db } from "@/lib/db";
import { withPpn } from "@/lib/money";

/**
 * Calculation layer keuangan — semua agregat DERIVED dari transaksi.
 * Formula (docs/rebuild/DOMAIN_MODEL.md):
 *   availableBudget    = Σ budget disetujui − Σ expense disetujui − komitmen disetujui belum terealisasi
 *   outstandingPayable = Σ invoice disetujui/dibayar_sebagian − Σ pembayaran keluar
 *   unbilledWork       = nilai terpasang DILAPORKAN (level counted: dikirim+disetujui+
 *                        final — BUKAN terverifikasi; audit 2026-07-27 B4) − Σ owner billing (diajukan+)
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
    if (b.status !== "draft") {
      cur.billed += b.amount;
      // Retensi hanya dari termin yang benar-benar diajukan+ — termin draft
      // belum menahan apa pun (audit 2026-07-27, B14a).
      cur.retentionHeld += b.retentionHeld;
    }
    for (const d of b.disbursements) cur.disbursed += d.amount;
    result.set(b.contractId, cur);
  }
  return result;
}

/**
 * unbilledWork utk satu kontrak: nilai terpasang DILAPORKAN (Σ lokasi) − billed,
 * DIBANDINGKAN APPLE-TO-APPLE pada basis inklusif PPN (audit 2026-07-27, B5):
 * terpasang berasal dari RAB (pre-PPN) sedangkan owner billing ditagihkan
 * inklusif PPN — tanpa penyetaraan, unbilled understated ~11% dan klaim
 * "sudah tertagih semua" bisa palsu. Terpasang dinaikkan dgn `withPpn` memakai
 * `Contract.ppnPercent` (jangan hardcode — CLAUDE.md).
 *
 * Basis level status tetap counted (dikirim+disetujui+final) — "dilaporkan",
 * bukan "terverifikasi" (B4); pemisahan level menunggu keputusan user.
 */
export function unbilledWork(installedReportedPreTax: bigint, billed: bigint, ppnPercent: number): bigint {
  const installedInclPpn = withPpn(installedReportedPreTax, ppnPercent);
  return installedInclPpn > billed ? installedInclPpn - billed : 0n;
}

/**
 * Satu kontrak untuk alokasi "belum tertagih". `locationIds` HANYA berisi lokasi
 * yang masih dalam lingkup pembaca — penyaringan lingkup tetap tugas pemanggil,
 * supaya fungsi ini murni dan bisa diuji tanpa sesi maupun DB.
 */
export type KontrakUntukAlokasi = {
  contractId: string;
  ppnPercent: number;
  locationIds: string[];
};

export type AlokasiBelumTertagih = {
  /** Belum tertagih per lokasi (inklusif PPN, sesuai `unbilledWork`). */
  perLokasi: Map<string, bigint>;
  totalBilled: bigint;
  totalDisbursed: bigint;
};

/**
 * Belum tertagih per LOKASI untuk sekumpulan kontrak.
 *
 * Kontrak ditagihkan per KONTRAK, sedangkan portofolio ditampilkan per LOKASI —
 * jadi kontrak multi-lokasi harus dibagi. Pembaginya nilai terpasang: lokasi
 * yang mengerjakan lebih banyak menanggung porsi tagihan yang lebih besar.
 *
 * Sebelumnya penjumlahan ini hidup di dalam `app/(app)/keuangan/page.tsx`,
 * sehingga satu-satunya cara memakai angkanya di AI/PDF/Excel adalah menyalin
 * formulanya — dua salinan uang yang bisa berbeda tanpa ada yang memberi tahu.
 *
 * Pembagian BigInt memotong ke bawah, jadi Σ porsi bisa kurang beberapa rupiah
 * dari `unbilled` kontraknya. Itu perilaku yang SUDAH berjalan dan sengaja
 * dipertahankan apa adanya: memperbaikinya mengubah angka yang sudah dilihat
 * orang, dan itu keputusan tersendiri.
 */
export function alokasiBelumTertagih(
  kontrak: KontrakUntukAlokasi[],
  billing: Map<string, { billed: bigint; disbursed: bigint }>,
  terpasangPerLokasi: Map<string, bigint>,
): AlokasiBelumTertagih {
  const perLokasi = new Map<string, bigint>();
  let totalBilled = 0n;
  let totalDisbursed = 0n;

  for (const c of kontrak) {
    const b = billing.get(c.contractId);
    const terpasangKontrak = c.locationIds.reduce(
      (s, id) => s + (terpasangPerLokasi.get(id) ?? 0n),
      0n,
    );
    const unbilled = unbilledWork(terpasangKontrak, b?.billed ?? 0n, c.ppnPercent);
    totalBilled += b?.billed ?? 0n;
    totalDisbursed += b?.disbursed ?? 0n;
    for (const id of c.locationIds) {
      const porsi =
        c.locationIds.length === 1
          ? unbilled
          : terpasangKontrak > 0n
            ? (unbilled * (terpasangPerLokasi.get(id) ?? 0n)) / terpasangKontrak
            : 0n;
      perLokasi.set(id, (perLokasi.get(id) ?? 0n) + porsi);
    }
  }
  return { perLokasi, totalBilled, totalDisbursed };
}

export type TotalPortofolio = {
  budget: bigint;
  expense: bigint;
  commitment: bigint;
  available: bigint;
  outstanding: bigint;
  installed: bigint;
};

/** Σ seluruh lokasi dalam lingkup — enam angka atas halaman Keuangan. */
export function totalPortofolio(
  rows: Iterable<LocationFinance & { installedValue: bigint }>,
): TotalPortofolio {
  const total: TotalPortofolio = {
    budget: 0n,
    expense: 0n,
    commitment: 0n,
    available: 0n,
    outstanding: 0n,
    installed: 0n,
  };
  for (const s of rows) {
    total.budget += s.budgetTotal;
    total.expense += s.expenseApproved;
    total.commitment += s.commitmentOpen;
    total.available += s.availableBudget;
    total.outstanding += s.outstandingPayable;
    total.installed += s.installedValue;
  }
  return total;
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
