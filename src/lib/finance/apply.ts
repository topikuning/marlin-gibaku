import type { Prisma } from "@/generated/prisma/client";
import { formatRupiah } from "@/lib/format";

/**
 * Lapisan aplikasi pembayaran/pencairan — dipanggil DI DALAM `db.$transaction`
 * oleh server action, dan langsung oleh uji integrasi race.
 *
 * Kenapa ada (audit 2026-07-27, B6): pola lama aggregate→guard→create berjalan
 * pada isolation level default (READ COMMITTED). Dua request paralel sama-sama
 * membaca "sisa Rp X", sama-sama lolos guard, sama-sama menulis — invoice
 * terbayar dobel, dan clamp `0n` di calc.ts menyembunyikannya dari dashboard.
 *
 * Solusi: `SELECT … FOR UPDATE` pada baris induk SEBELUM agregasi. Transaksi
 * kedua menunggu yang pertama commit, lalu membaca sisa yang sudah benar dan
 * ditolak guard. Bukan advisory lock, bukan serializable — cukup row lock yang
 * scope-nya persis satu invoice/termin.
 */

export class FinanceGuardError extends Error {}

export type AppliedPayment = {
  payment: { id: string };
  newStatus: "lunas" | "dibayar_sebagian";
};

export async function applyPaymentTx(
  tx: Prisma.TransactionClient,
  input: { invoiceId: string; amount: bigint; paidDate: Date; note: string | null; createdById: string },
): Promise<AppliedPayment> {
  // Row lock — serialisasi semua pembayaran atas invoice yang sama.
  await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;

  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: { id: true, amount: true, status: true, number: true },
  });
  if (inv.status !== "disetujui" && inv.status !== "dibayar_sebagian") {
    throw new FinanceGuardError("Pembayaran hanya untuk invoice disetujui / dibayar sebagian.");
  }
  const agg = await tx.paymentOut.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } });
  const paid = agg._sum.amount ?? 0n;
  const remaining = inv.amount - paid;
  if (input.amount > remaining) {
    throw new FinanceGuardError(`Melebihi sisa tagihan invoice ${inv.number}: sisa ${formatRupiah(remaining)}.`);
  }
  const payment = await tx.paymentOut.create({
    data: {
      invoiceId: inv.id,
      amount: input.amount,
      paidDate: input.paidDate,
      note: input.note,
      createdById: input.createdById,
    },
    select: { id: true },
  });
  const newStatus = paid + input.amount === inv.amount ? "lunas" : "dibayar_sebagian";
  await tx.invoice.update({ where: { id: inv.id }, data: { status: newStatus } });
  return { payment, newStatus };
}

export type AppliedDisbursement = {
  disbursement: { id: string };
  newStatus: "cair" | "cair_sebagian";
};

export async function applyDisbursementTx(
  tx: Prisma.TransactionClient,
  input: { billingId: string; amount: bigint; receivedDate: Date; note: string | null; createdById: string },
): Promise<AppliedDisbursement> {
  await tx.$queryRaw`SELECT id FROM "owner_billings" WHERE id = ${input.billingId}::uuid FOR UPDATE`;

  const billing = await tx.ownerBilling.findUniqueOrThrow({
    where: { id: input.billingId },
    select: { id: true, amount: true, status: true, terminNo: true },
  });
  if (billing.status !== "disetujui" && billing.status !== "cair_sebagian") {
    throw new FinanceGuardError("Pencairan hanya untuk termin disetujui / cair sebagian.");
  }
  const agg = await tx.disbursement.aggregate({
    where: { ownerBillingId: billing.id },
    _sum: { amount: true },
  });
  const received = agg._sum.amount ?? 0n;
  const remaining = billing.amount - received;
  if (input.amount > remaining) {
    throw new FinanceGuardError(`Melebihi sisa termin ${billing.terminNo}: sisa ${formatRupiah(remaining)}.`);
  }
  const disbursement = await tx.disbursement.create({
    data: {
      ownerBillingId: billing.id,
      amount: input.amount,
      receivedDate: input.receivedDate,
      note: input.note,
      createdById: input.createdById,
    },
    select: { id: true },
  });
  const newStatus = received + input.amount === billing.amount ? "cair" : "cair_sebagian";
  await tx.ownerBilling.update({ where: { id: billing.id }, data: { status: newStatus } });
  return { disbursement, newStatus };
}
