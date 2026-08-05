"use client";

import { useActionState } from "react";
import { Banner, Button, StatusPill, type BadgeTone } from "@/components/ui";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { activateDraftAction, discardDraftAction, type RabActionState } from "./actions";
import type { RabRevisionSource, RevisionStatus } from "@/generated/prisma/enums";

export type RevisionRow = {
  id: string;
  revisionNo: number;
  source: RabRevisionSource;
  status: RevisionStatus;
  /** Rupiah string (BigInt serialized). */
  totalValue: string;
  createdAt: string;
  note: string | null;
};

const SOURCE_LABEL: Record<RabRevisionSource, string> = {
  hps_awal: "HPS awal",
  adendum: "Adendum",
};

const STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft",
  aktif: "Aktif",
  digantikan: "Digantikan",
};

const STATUS_TONE: Record<RevisionStatus, BadgeTone> = {
  draft: "warning",
  aktif: "success",
  digantikan: "neutral",
};

function DraftActions({ revisionId }: { revisionId: string }) {
  const [activateState, activate, activating] = useActionState<RabActionState, FormData>(
    activateDraftAction,
    undefined,
  );
  const [discardState, discard, discarding] = useActionState<RabActionState, FormData>(
    discardDraftAction,
    undefined,
  );
  const state = activateState ?? discardState;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-end gap-1.5">
        <form action={activate}>
          <input type="hidden" name="revisionId" value={revisionId} />
          <Button size="sm" type="submit" loading={activating} disabled={discarding}>
            Aktifkan
          </Button>
        </form>
        <form action={discard}>
          <input type="hidden" name="revisionId" value={revisionId} />
          <Button size="sm" variant="danger" type="submit" loading={discarding} disabled={activating}>
            Buang
          </Button>
        </form>
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </div>
  );
}

export function RevisionList({ revisions, canManage }: { revisions: RevisionRow[]; canManage: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
            <th className="py-2 pr-3">No</th>
            <th className="py-2 pr-3">Sumber</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3 text-right">Total (pra-PPN)</th>
            <th className="py-2 pr-3">Tanggal</th>
            <th className="py-2 pr-3">Catatan</th>
            {canManage ? <th className="py-2 text-right">Aksi</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {revisions.map((r) => (
            <tr key={r.id}>
              <td className="tabular py-2 pr-3">#{r.revisionNo}</td>
              <td className="py-2 pr-3">{SOURCE_LABEL[r.source]}</td>
              <td className="py-2 pr-3">
                <StatusPill tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} />
              </td>
              <td className="tabular py-2 pr-3 text-right">{formatRupiah(Number(r.totalValue))}</td>
              <td className="tabular py-2 pr-3">{formatTanggal(new Date(r.createdAt))}</td>
              <td className="max-w-60 truncate py-2 pr-3 text-ink-muted" title={r.note ?? undefined}>
                {r.note ?? "—"}
              </td>
              {canManage ? (
                <td className="py-2 text-right">
                  {r.status === "draft" ? <DraftActions revisionId={r.id} /> : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
