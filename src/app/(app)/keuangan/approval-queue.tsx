"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge, Banner, Button, Input, Label } from "@/components/ui";
import { formatRupiah, formatTanggal } from "@/lib/format";
import {
  approveCommitment,
  approveExpense,
  approveInvoice,
  approveOwnerBilling,
  rejectCommitment,
  rejectExpense,
  rejectInvoice,
  rejectOwnerBilling,
  type FinanceActionState,
} from "@/lib/finance/actions";

export type QueueKind = "commitment" | "expense" | "invoice" | "billing";

export type QueueItem = {
  kind: QueueKind;
  id: string;
  /** Label jenis, mis. "Komitmen · Kasbon". */
  kindLabel: string;
  description: string;
  /** Konteks: nama lokasi / nomor kontrak. */
  context: string;
  /** Link konteks (halaman keuangan lokasi). */
  href: string | null;
  /** BigInt sebagai string. */
  amount: string;
  /** ISO date pengajuan. */
  createdAt: string;
};

const ACTIONS: Record<
  QueueKind,
  {
    approve: (prev: FinanceActionState, fd: FormData) => Promise<FinanceActionState>;
    reject: (prev: FinanceActionState, fd: FormData) => Promise<FinanceActionState>;
  }
> = {
  commitment: { approve: approveCommitment, reject: rejectCommitment },
  expense: { approve: approveExpense, reject: rejectExpense },
  invoice: { approve: approveInvoice, reject: rejectInvoice },
  billing: { approve: approveOwnerBilling, reject: rejectOwnerBilling },
};

function QueueRow({ item, canApprove }: { item: QueueItem; canApprove: boolean }) {
  const [approveState, approveAction, approving] = useActionState<FinanceActionState, FormData>(
    ACTIONS[item.kind].approve,
    undefined,
  );
  const [rejectState, rejectAction, rejecting] = useActionState<FinanceActionState, FormData>(
    ACTIONS[item.kind].reject,
    undefined,
  );
  const [showReject, setShowReject] = useState(false);
  const state = rejectState ?? approveState;

  return (
    <div className="py-3">
      {state?.error ? <Banner tone="error" title={state.error} className="mb-2" /> : null}
      {state?.success ? <Banner tone="success" title={state.success} className="mb-2" /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning" label={item.kindLabel} />
            <span className="font-medium text-ink">{item.description}</span>
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {item.href ? (
              <Link href={item.href} className="hover:underline">
                {item.context}
              </Link>
            ) : (
              item.context
            )}
            {" · diajukan "}
            {formatTanggal(new Date(item.createdAt))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular text-sm font-semibold text-ink">{formatRupiah(Number(item.amount))}</span>
          {canApprove ? (
            <div className="flex gap-1.5">
              <form action={approveAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button size="sm" type="submit" loading={approving}>
                  Setujui
                </Button>
              </form>
              <Button
                size="sm"
                variant="danger"
                type="button"
                onClick={() => setShowReject((v) => !v)}
              >
                Tolak
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {canApprove && showReject ? (
        <form
          action={rejectAction}
          className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted p-3"
        >
          <input type="hidden" name="id" value={item.id} />
          <div className="min-w-64 flex-1">
            <Label htmlFor={`tolak-${item.kind}-${item.id}`} required>
              Alasan penolakan
            </Label>
            <Input id={`tolak-${item.kind}-${item.id}`} name="reason" required minLength={3} />
          </div>
          <Button size="sm" variant="danger" type="submit" loading={rejecting}>
            Konfirmasi tolak
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setShowReject(false)}>
            Batal
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function ApprovalQueue({ items, canApprove }: { items: QueueItem[]; canApprove: boolean }) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-ink-muted">Tidak ada transaksi menunggu persetujuan.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <QueueRow key={`${item.kind}-${item.id}`} item={item} canApprove={canApprove} />
      ))}
    </div>
  );
}
