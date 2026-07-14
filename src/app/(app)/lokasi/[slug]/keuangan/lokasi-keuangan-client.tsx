"use client";

import { useActionState, useState } from "react";
import { Badge, Banner, Button, HelpText, Input, Label, Select, Textarea } from "@/components/ui";
import { formatRupiah, formatTanggal } from "@/lib/format";
import {
  addDisbursement,
  addPayment,
  approveCommitment,
  approveExpense,
  approveInvoice,
  approveOwnerBilling,
  closeCommitment,
  createCommitment,
  createExpense,
  createInvoice,
  createOwnerBilling,
  rejectCommitment,
  rejectExpense,
  rejectInvoice,
  rejectOwnerBilling,
  setBudgetLine,
  submitOwnerBilling,
  type FinanceActionState,
} from "@/lib/finance/actions";
import type {
  ApprovalStatus,
  BillingStatus,
  CommitmentType,
  CostCategory,
  InvoiceStatus,
} from "@/generated/prisma/enums";
import {
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_TONE,
  BILLING_STATUS_LABEL,
  BILLING_STATUS_TONE,
  CATEGORY_LABEL,
  COMMITMENT_TYPE_LABEL,
  COMMITMENT_TYPES,
  COST_CATEGORIES,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
} from "../../../keuangan/finance-ui";

/* Semua nilai BigInt dikirim sebagai string (bigintToString), tanggal sebagai ISO string. */

const rp = (s: string) => formatRupiah(Number(s));
const tgl = (s: string) => formatTanggal(new Date(s));

type ServerAction = (prev: FinanceActionState, fd: FormData) => Promise<FinanceActionState>;

/* ------------------------------------------------------------------ */
/* Blok generik                                                        */
/* ------------------------------------------------------------------ */

function StateBanners({ state }: { state: FinanceActionState }) {
  if (!state) return null;
  return (
    <>
      {state.error ? <Banner tone="error" title={state.error} className="mb-2" /> : null}
      {state.success ? <Banner tone="success" title={state.success} className="mb-2" /> : null}
    </>
  );
}

/** Setujui / Tolak(+alasan) untuk satu transaksi diajukan. */
function ApproveRejectButtons({
  id,
  approveAction,
  rejectAction,
}: {
  id: string;
  approveAction: ServerAction;
  rejectAction: ServerAction;
}) {
  const [approveState, approve, approving] = useActionState<FinanceActionState, FormData>(approveAction, undefined);
  const [rejectState, reject, rejecting] = useActionState<FinanceActionState, FormData>(rejectAction, undefined);
  const [showReject, setShowReject] = useState(false);
  return (
    <div>
      <StateBanners state={rejectState ?? approveState} />
      <div className="flex flex-wrap gap-1.5">
        <form action={approve}>
          <input type="hidden" name="id" value={id} />
          <Button size="sm" type="submit" loading={approving}>
            Setujui
          </Button>
        </form>
        <Button size="sm" variant="danger" type="button" onClick={() => setShowReject((v) => !v)}>
          Tolak
        </Button>
      </div>
      {showReject ? (
        <form action={reject} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <div>
            <Label htmlFor={`reason-${id}`} required>
              Alasan
            </Label>
            <Input id={`reason-${id}`} name="reason" required minLength={3} className="w-56" />
          </div>
          <Button size="sm" variant="danger" type="submit" loading={rejecting}>
            Konfirmasi
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setShowReject(false)}>
            Batal
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Satu tombol aksi sederhana (tutup komitmen, ajukan termin). */
function SingleActionButton({
  id,
  action,
  label,
  variant = "secondary",
}: {
  id: string;
  action: ServerAction;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(action, undefined);
  return (
    <div>
      <StateBanners state={state} />
      <form action={act}>
        <input type="hidden" name="id" value={id} />
        <Button size="sm" variant={variant} type="submit" loading={pending}>
          {label}
        </Button>
      </form>
    </div>
  );
}

function AmountInput({
  id,
  name = "amount",
  label = "Jumlah (Rp)",
  required = true,
  defaultValue,
}: {
  id: string;
  name?: string;
  label?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        inputMode="numeric"
        required={required}
        placeholder="mis. 15000000"
        defaultValue={defaultValue}
        autoComplete="off"
      />
    </div>
  );
}

function ToggleFormCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <Button size="sm" variant={open ? "ghost" : "secondary"} type="button" onClick={() => setOpen((v) => !v)}>
        {open ? "Tutup form" : label}
      </Button>
      {open ? <div className="mt-3 rounded-md border border-border bg-surface-muted p-4">{children}</div> : null}
    </div>
  );
}

const TH = "py-2 pr-3 text-left text-xs uppercase text-ink-muted";
const TD = "py-2 pr-3 align-top";

/* ------------------------------------------------------------------ */
/* 1. Budget per kategori                                              */
/* ------------------------------------------------------------------ */

export type BudgetRowUI = {
  category: CostCategory;
  amount: string | null;
  note: string | null;
};

function BudgetEditForm({ locationId, category, onClose }: { locationId: string; category: CostCategory; onClose: () => void }) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(setBudgetLine, undefined);
  return (
    <form action={act} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted p-3">
      <StateBanners state={state} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="category" value={category} />
      <AmountInput id={`budget-${category}`} label="Nilai budget baru (Rp)" />
      <div>
        <Label htmlFor={`budget-note-${category}`}>Catatan</Label>
        <Input id={`budget-note-${category}`} name="note" className="w-56" />
      </div>
      <Button size="sm" type="submit" loading={pending}>
        Simpan
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onClose}>
        Batal
      </Button>
    </form>
  );
}

export function BudgetSection({
  locationId,
  rows,
  canApprove,
}: {
  locationId: string;
  rows: BudgetRowUI[];
  canApprove: boolean;
}) {
  const [editing, setEditing] = useState<CostCategory | null>(null);
  const total = rows.reduce((s, r) => s + (r.amount ? BigInt(r.amount) : 0n), 0n);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={TH}>Kategori</th>
            <th className={`${TH} text-right`}>Nilai berlaku</th>
            <th className={TH}>Catatan</th>
            {canApprove ? <th className={TH}>Aksi</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.category}>
              <td className={`${TD} font-medium text-ink`}>{CATEGORY_LABEL[r.category]}</td>
              <td className={`${TD} tabular text-right`}>{r.amount ? rp(r.amount) : <span className="text-ink-faint">—</span>}</td>
              <td className={`${TD} text-ink-muted`}>{r.note ?? ""}</td>
              {canApprove ? (
                <td className={TD}>
                  <Button size="sm" variant="secondary" type="button" onClick={() => setEditing(editing === r.category ? null : r.category)}>
                    Ubah
                  </Button>
                  {editing === r.category ? (
                    <BudgetEditForm locationId={locationId} category={r.category} onClose={() => setEditing(null)} />
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
          <tr>
            <td className={`${TD} font-semibold text-ink`}>Total</td>
            <td className={`${TD} tabular text-right font-semibold text-ink`}>{formatRupiah(Number(total))}</td>
            <td className={TD} colSpan={canApprove ? 2 : 1} />
          </tr>
        </tbody>
      </table>
      {canApprove ? (
        <HelpText>Perubahan membuat baris budget baru — riwayat nilai lama tersimpan (append-only).</HelpText>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Komitmen (PO / kontrak vendor / kasbon)                          */
/* ------------------------------------------------------------------ */

export type CommitmentRowUI = {
  id: string;
  type: CommitmentType;
  number: string;
  description: string;
  category: CostCategory;
  amount: string;
  realizedAmount: string;
  dueDate: string | null;
  status: ApprovalStatus;
  closedAt: string | null;
  vendorName: string | null;
};

export function CommitmentSection({
  locationId,
  rows,
  vendors,
  canInput,
  canApprove,
}: {
  locationId: string;
  rows: CommitmentRowUI[];
  vendors: string[];
  canInput: boolean;
  canApprove: boolean;
}) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(createCommitment, undefined);
  return (
    <div>
      {canInput ? (
        <ToggleFormCard label="+ Komitmen baru (PO / kontrak vendor / kasbon)">
          <form action={act} className="space-y-3">
            <StateBanners state={state} />
            <input type="hidden" name="locationId" value={locationId} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="c-type" required>
                  Jenis
                </Label>
                <Select id="c-type" name="type" required defaultValue="po">
                  {COMMITMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {COMMITMENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="c-number" required>
                  Nomor
                </Label>
                <Input id="c-number" name="number" required placeholder="mis. PO-KDM-2026-002" autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="c-vendor">Vendor (wajib kecuali kasbon)</Label>
                <Input id="c-vendor" name="vendorName" list="vendor-list" autoComplete="off" />
                <datalist id="vendor-list">
                  {vendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="c-category" required>
                  Kategori biaya
                </Label>
                <Select id="c-category" name="category" required defaultValue="material">
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <AmountInput id="c-amount" label="Nilai (Rp)" />
              <div>
                <Label htmlFor="c-due">Jatuh tempo</Label>
                <Input id="c-due" name="dueDate" type="date" />
              </div>
            </div>
            <div>
              <Label htmlFor="c-desc" required>
                Deskripsi
              </Label>
              <Textarea id="c-desc" name="description" required rows={2} />
            </div>
            <Button type="submit" loading={pending}>
              Ajukan komitmen
            </Button>
            <HelpText>Komitmen langsung berstatus diajukan — menunggu persetujuan approver.</HelpText>
          </form>
        </ToggleFormCard>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Nomor</th>
              <th className={TH}>Jenis</th>
              <th className={TH}>Vendor</th>
              <th className={TH}>Kategori</th>
              <th className={`${TH} text-right`}>Nilai</th>
              <th className={`${TH} text-right`}>Terealisasi</th>
              <th className={TH}>Jatuh tempo</th>
              <th className={TH}>Status</th>
              {canApprove ? <th className={TH}>Aksi</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td className={`${TD} text-ink-muted`} colSpan={canApprove ? 9 : 8}>
                  Belum ada komitmen.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td className={`${TD} font-medium text-ink`}>
                    {c.number}
                    <div className="max-w-64 truncate text-xs font-normal text-ink-muted" title={c.description}>
                      {c.description}
                    </div>
                  </td>
                  <td className={TD}>{COMMITMENT_TYPE_LABEL[c.type]}</td>
                  <td className={TD}>{c.vendorName ?? <span className="text-ink-faint">—</span>}</td>
                  <td className={TD}>{CATEGORY_LABEL[c.category]}</td>
                  <td className={`${TD} tabular text-right`}>{rp(c.amount)}</td>
                  <td className={`${TD} tabular text-right`}>{rp(c.realizedAmount)}</td>
                  <td className={`${TD} tabular`}>{c.dueDate ? tgl(c.dueDate) : "—"}</td>
                  <td className={TD}>
                    <Badge tone={APPROVAL_STATUS_TONE[c.status]} label={APPROVAL_STATUS_LABEL[c.status]} />
                    {c.closedAt ? <Badge tone="neutral" label="Ditutup" className="ml-1" /> : null}
                  </td>
                  {canApprove ? (
                    <td className={TD}>
                      {c.status === "diajukan" ? (
                        <ApproveRejectButtons id={c.id} approveAction={approveCommitment} rejectAction={rejectCommitment} />
                      ) : c.status === "disetujui" && !c.closedAt ? (
                        <SingleActionButton id={c.id} action={closeCommitment} label="Tutup" />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Realisasi (expense / settlement)                                 */
/* ------------------------------------------------------------------ */

export type CommitmentOption = {
  id: string;
  label: string;
};

export type ExpenseRowUI = {
  id: string;
  category: CostCategory;
  amount: string;
  txDate: string;
  description: string;
  status: ApprovalStatus;
  commitmentNumber: string | null;
};

export function ExpenseSection({
  locationId,
  rows,
  openCommitments,
  canInput,
  canApprove,
  today,
}: {
  locationId: string;
  rows: ExpenseRowUI[];
  openCommitments: CommitmentOption[];
  canInput: boolean;
  canApprove: boolean;
  today: string;
}) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(createExpense, undefined);
  return (
    <div>
      {canInput ? (
        <ToggleFormCard label="+ Realisasi baru">
          <form action={act} className="space-y-3">
            <StateBanners state={state} />
            <input type="hidden" name="locationId" value={locationId} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="e-commitment">Komitmen terbuka (opsional)</Label>
                <Select id="e-commitment" name="commitmentId" defaultValue="">
                  <option value="">— tanpa komitmen —</option>
                  {openCommitments.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="e-category" required>
                  Kategori biaya
                </Label>
                <Select id="e-category" name="category" required defaultValue="material">
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <AmountInput id="e-amount" />
              <div>
                <Label htmlFor="e-date" required>
                  Tanggal transaksi
                </Label>
                <Input id="e-date" name="txDate" type="date" required defaultValue={today} />
              </div>
            </div>
            <div>
              <Label htmlFor="e-desc" required>
                Deskripsi
              </Label>
              <Textarea id="e-desc" name="description" required rows={2} />
            </div>
            <Button type="submit" loading={pending}>
              Ajukan realisasi
            </Button>
            <HelpText>Bila menempel komitmen, total realisasi tidak boleh melebihi nilai komitmen (guard settlement).</HelpText>
          </form>
        </ToggleFormCard>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Tanggal</th>
              <th className={TH}>Deskripsi</th>
              <th className={TH}>Kategori</th>
              <th className={TH}>Komitmen</th>
              <th className={`${TH} text-right`}>Jumlah</th>
              <th className={TH}>Status</th>
              {canApprove ? <th className={TH}>Aksi</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td className={`${TD} text-ink-muted`} colSpan={canApprove ? 7 : 6}>
                  Belum ada realisasi.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr key={e.id}>
                  <td className={`${TD} tabular`}>{tgl(e.txDate)}</td>
                  <td className={`${TD} max-w-72`}>{e.description}</td>
                  <td className={TD}>{CATEGORY_LABEL[e.category]}</td>
                  <td className={TD}>{e.commitmentNumber ?? <span className="text-ink-faint">—</span>}</td>
                  <td className={`${TD} tabular text-right`}>{rp(e.amount)}</td>
                  <td className={TD}>
                    <Badge tone={APPROVAL_STATUS_TONE[e.status]} label={APPROVAL_STATUS_LABEL[e.status]} />
                  </td>
                  {canApprove ? (
                    <td className={TD}>
                      {e.status === "diajukan" ? (
                        <ApproveRejectButtons id={e.id} approveAction={approveExpense} rejectAction={rejectExpense} />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Invoice vendor + pembayaran parsial                              */
/* ------------------------------------------------------------------ */

export type InvoiceRowUI = {
  id: string;
  number: string;
  amount: string;
  paidTotal: string;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  commitmentNumber: string | null;
  vendorName: string | null;
};

function PaymentForm({ invoice, today }: { invoice: InvoiceRowUI; today: string }) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(addPayment, undefined);
  const remaining = BigInt(invoice.amount) - BigInt(invoice.paidTotal);
  return (
    <form action={act} className="mt-2 flex flex-wrap items-end gap-2">
      <StateBanners state={state} />
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <AmountInput id={`pay-${invoice.id}`} label={`Bayar (sisa ${formatRupiah(Number(remaining))})`} />
      <div>
        <Label htmlFor={`pay-date-${invoice.id}`} required>
          Tanggal bayar
        </Label>
        <Input id={`pay-date-${invoice.id}`} name="paidDate" type="date" required defaultValue={today} />
      </div>
      <div>
        <Label htmlFor={`pay-note-${invoice.id}`}>Catatan</Label>
        <Input id={`pay-note-${invoice.id}`} name="note" className="w-40" />
      </div>
      <Button size="sm" type="submit" loading={pending}>
        Catat pembayaran
      </Button>
    </form>
  );
}

export function InvoiceSection({
  locationId,
  rows,
  commitments,
  canInput,
  canApprove,
  today,
}: {
  locationId: string;
  rows: InvoiceRowUI[];
  commitments: CommitmentOption[];
  canInput: boolean;
  canApprove: boolean;
  today: string;
}) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(createInvoice, undefined);
  const [payingId, setPayingId] = useState<string | null>(null);
  return (
    <div>
      {canInput ? (
        <ToggleFormCard label="+ Invoice vendor baru">
          <form action={act} className="space-y-3">
            <StateBanners state={state} />
            <input type="hidden" name="locationId" value={locationId} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="i-number" required>
                  Nomor invoice
                </Label>
                <Input id="i-number" name="number" required autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="i-commitment">Komitmen (opsional)</Label>
                <Select id="i-commitment" name="commitmentId" defaultValue="">
                  <option value="">— tanpa komitmen —</option>
                  {commitments.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <AmountInput id="i-amount" label="Nilai invoice (Rp)" />
              <div>
                <Label htmlFor="i-date" required>
                  Tanggal invoice
                </Label>
                <Input id="i-date" name="invoiceDate" type="date" required defaultValue={today} />
              </div>
              <div>
                <Label htmlFor="i-due">Jatuh tempo</Label>
                <Input id="i-due" name="dueDate" type="date" />
              </div>
            </div>
            <Button type="submit" loading={pending}>
              Ajukan invoice
            </Button>
          </form>
        </ToggleFormCard>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Nomor</th>
              <th className={TH}>Komitmen</th>
              <th className={TH}>Tanggal</th>
              <th className={TH}>Jatuh tempo</th>
              <th className={`${TH} text-right`}>Nilai</th>
              <th className={`${TH} text-right`}>Terbayar</th>
              <th className={TH}>Status</th>
              {canApprove || canInput ? <th className={TH}>Aksi</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td className={`${TD} text-ink-muted`} colSpan={8}>
                  Belum ada invoice.
                </td>
              </tr>
            ) : (
              rows.map((inv) => {
                const payable = inv.status === "disetujui" || inv.status === "dibayar_sebagian";
                return (
                  <tr key={inv.id}>
                    <td className={`${TD} font-medium text-ink`}>
                      {inv.number}
                      {inv.vendorName ? <div className="text-xs font-normal text-ink-muted">{inv.vendorName}</div> : null}
                    </td>
                    <td className={TD}>{inv.commitmentNumber ?? <span className="text-ink-faint">—</span>}</td>
                    <td className={`${TD} tabular`}>{tgl(inv.invoiceDate)}</td>
                    <td className={`${TD} tabular`}>{inv.dueDate ? tgl(inv.dueDate) : "—"}</td>
                    <td className={`${TD} tabular text-right`}>{rp(inv.amount)}</td>
                    <td className={`${TD} tabular text-right`}>{rp(inv.paidTotal)}</td>
                    <td className={TD}>
                      <Badge tone={INVOICE_STATUS_TONE[inv.status]} label={INVOICE_STATUS_LABEL[inv.status]} />
                    </td>
                    {canApprove || canInput ? (
                      <td className={TD}>
                        {canApprove && inv.status === "diajukan" ? (
                          <ApproveRejectButtons id={inv.id} approveAction={approveInvoice} rejectAction={rejectInvoice} />
                        ) : null}
                        {canInput && payable ? (
                          <div>
                            <Button
                              size="sm"
                              variant="secondary"
                              type="button"
                              onClick={() => setPayingId(payingId === inv.id ? null : inv.id)}
                            >
                              {payingId === inv.id ? "Tutup" : "Bayar"}
                            </Button>
                            {payingId === inv.id ? <PaymentForm invoice={inv} today={today} /> : null}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Penagihan owner (termin per kontrak)                             */
/* ------------------------------------------------------------------ */

export type BillingRowUI = {
  id: string;
  terminNo: number;
  description: string | null;
  amount: string;
  retentionHeld: string;
  disbursedTotal: string;
  billedDate: string | null;
  status: BillingStatus;
};

function DisbursementForm({ billing, today }: { billing: BillingRowUI; today: string }) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(addDisbursement, undefined);
  const remaining = BigInt(billing.amount) - BigInt(billing.disbursedTotal);
  return (
    <form action={act} className="mt-2 flex flex-wrap items-end gap-2">
      <StateBanners state={state} />
      <input type="hidden" name="billingId" value={billing.id} />
      <AmountInput id={`disb-${billing.id}`} label={`Pencairan (sisa ${formatRupiah(Number(remaining))})`} />
      <div>
        <Label htmlFor={`disb-date-${billing.id}`} required>
          Tanggal diterima
        </Label>
        <Input id={`disb-date-${billing.id}`} name="receivedDate" type="date" required defaultValue={today} />
      </div>
      <Button size="sm" type="submit" loading={pending}>
        Catat pencairan
      </Button>
    </form>
  );
}

export function BillingSection({
  contractId,
  rows,
  canInput,
  canApprove,
  today,
}: {
  contractId: string;
  rows: BillingRowUI[];
  canInput: boolean;
  canApprove: boolean;
  today: string;
}) {
  const [state, act, pending] = useActionState<FinanceActionState, FormData>(createOwnerBilling, undefined);
  const [disbursingId, setDisbursingId] = useState<string | null>(null);
  const nextTermin = rows.reduce((m, r) => Math.max(m, r.terminNo), 0) + 1;
  return (
    <div>
      {canInput ? (
        <ToggleFormCard label="+ Termin penagihan baru">
          <form action={act} className="space-y-3">
            <StateBanners state={state} />
            <input type="hidden" name="contractId" value={contractId} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="b-termin" required>
                  Nomor termin
                </Label>
                <Input id="b-termin" name="terminNo" type="number" min={1} required defaultValue={nextTermin} />
              </div>
              <AmountInput id="b-amount" label="Nilai termin (Rp)" />
              <AmountInput id="b-retention" name="retentionHeld" label="Retensi ditahan (Rp)" required={false} defaultValue="0" />
              <div>
                <Label htmlFor="b-desc">Deskripsi</Label>
                <Input id="b-desc" name="description" placeholder="mis. MC-1 progres 30%" />
              </div>
            </div>
            <Button type="submit" loading={pending}>
              Simpan draft termin
            </Button>
            <HelpText>Termin dibuat sebagai draft — ajukan setelah dokumen tagihan siap.</HelpText>
          </form>
        </ToggleFormCard>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Termin</th>
              <th className={TH}>Deskripsi</th>
              <th className={TH}>Tanggal tagih</th>
              <th className={`${TH} text-right`}>Nilai</th>
              <th className={`${TH} text-right`}>Retensi</th>
              <th className={`${TH} text-right`}>Cair</th>
              <th className={TH}>Status</th>
              {canApprove || canInput ? <th className={TH}>Aksi</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td className={`${TD} text-ink-muted`} colSpan={8}>
                  Belum ada termin penagihan.
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const disbursable = b.status === "disetujui" || b.status === "cair_sebagian";
                return (
                  <tr key={b.id}>
                    <td className={`${TD} font-medium text-ink`}>Termin {b.terminNo}</td>
                    <td className={`${TD} max-w-64`}>{b.description ?? <span className="text-ink-faint">—</span>}</td>
                    <td className={`${TD} tabular`}>{b.billedDate ? tgl(b.billedDate) : "—"}</td>
                    <td className={`${TD} tabular text-right`}>{rp(b.amount)}</td>
                    <td className={`${TD} tabular text-right`}>{rp(b.retentionHeld)}</td>
                    <td className={`${TD} tabular text-right`}>{rp(b.disbursedTotal)}</td>
                    <td className={TD}>
                      <Badge tone={BILLING_STATUS_TONE[b.status]} label={BILLING_STATUS_LABEL[b.status]} />
                    </td>
                    {canApprove || canInput ? (
                      <td className={TD}>
                        {canInput && b.status === "draft" ? (
                          <SingleActionButton id={b.id} action={submitOwnerBilling} label="Ajukan" variant="primary" />
                        ) : null}
                        {canApprove && b.status === "diajukan" ? (
                          <ApproveRejectButtons id={b.id} approveAction={approveOwnerBilling} rejectAction={rejectOwnerBilling} />
                        ) : null}
                        {canInput && disbursable ? (
                          <div>
                            <Button
                              size="sm"
                              variant="secondary"
                              type="button"
                              onClick={() => setDisbursingId(disbursingId === b.id ? null : b.id)}
                            >
                              {disbursingId === b.id ? "Tutup" : "Pencairan"}
                            </Button>
                            {disbursingId === b.id ? <DisbursementForm billing={b} today={today} /> : null}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
