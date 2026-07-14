"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Input, Label, Select, StatusPill, Textarea } from "@/components/ui";
import { formatTanggal } from "@/lib/format";
import {
  addRecoveryAction,
  addRecoveryUpdate,
  createIssue,
  updateIssueStatus,
  updateRecoveryStatus,
  type IssueActionState,
} from "@/lib/issues";
import {
  ALL_ISSUE_SEVERITIES,
  ALL_ISSUE_STATUSES,
  ALL_RECOVERY_STATUSES,
  ISSUE_SEVERITY_LABEL,
  ISSUE_SEVERITY_TONE,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUS_TONE,
  RECOVERY_STATUS_LABEL,
  RECOVERY_STATUS_TONE,
} from "../issue-labels";
import type { IssueSeverity, IssueStatus, RecoveryStatus } from "@/generated/prisma/enums";

export type RecoveryUpdateData = { id: string; note: string; createdAt: string };
export type RecoveryActionData = {
  id: string;
  description: string;
  picName: string | null;
  dueDate: string | null;
  status: RecoveryStatus;
  updates: RecoveryUpdateData[];
};
export type IssueData = {
  id: string;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  createdAt: string;
  actions: RecoveryActionData[];
};

function StateBanners({ state }: { state: IssueActionState }) {
  if (!state) return null;
  if (state.error) return <Banner tone="error" title={state.error} />;
  if (state.success) return <Banner tone="success" title={state.success} />;
  return null;
}

/** Form buat kendala baru. */
function CreateIssueForm({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<IssueActionState, FormData>(createIssue, undefined);
  return (
    <form action={action} className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
      <StateBanners state={state} />
      <input type="hidden" name="locationId" value={locationId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="is-title" required>Judul kendala</Label>
          <Input id="is-title" name="title" required minLength={3} maxLength={200} placeholder="mis. Hujan deras 3 hari, akses material terputus" />
        </div>
        <div>
          <Label htmlFor="is-severity" required>Tingkat</Label>
          <Select id="is-severity" name="severity" required defaultValue="sedang">
            {ALL_ISSUE_SEVERITIES.map((s) => (
              <option key={s} value={s}>{ISSUE_SEVERITY_LABEL[s]}</option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="is-desc">Uraian (opsional)</Label>
          <Textarea id="is-desc" name="description" rows={2} maxLength={2000} />
        </div>
      </div>
      <Button type="submit" loading={pending}>Catat kendala</Button>
    </form>
  );
}

function IssueStatusControl({ issueId, status }: { issueId: string; status: IssueStatus }) {
  const [state, action, pending] = useActionState<IssueActionState, FormData>(updateIssueStatus, undefined);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="issueId" value={issueId} />
      <Select name="status" defaultValue={status} className="h-8 w-32 py-0 text-[13px]" aria-label="Status kendala">
        {ALL_ISSUE_STATUSES.map((s) => (
          <option key={s} value={s}>{ISSUE_STATUS_LABEL[s]}</option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" type="submit" loading={pending}>Ubah</Button>
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function RecoveryStatusControl({ actionId, status }: { actionId: string; status: RecoveryStatus }) {
  const [state, action, pending] = useActionState<IssueActionState, FormData>(updateRecoveryStatus, undefined);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="actionId" value={actionId} />
      <Select name="status" defaultValue={status} className="h-8 w-36 py-0 text-[13px]" aria-label="Status aksi pemulihan">
        {ALL_RECOVERY_STATUSES.map((s) => (
          <option key={s} value={s}>{RECOVERY_STATUS_LABEL[s]}</option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" type="submit" loading={pending}>Ubah</Button>
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function AddRecoveryActionForm({ issueId, onDone }: { issueId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<IssueActionState, FormData>(addRecoveryAction, undefined);
  return (
    <form action={action} className="mt-2 space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <StateBanners state={state} />
      <input type="hidden" name="issueId" value={issueId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Label htmlFor={`ra-desc-${issueId}`} required>Aksi pemulihan</Label>
          <Textarea id={`ra-desc-${issueId}`} name="description" rows={2} required minLength={3} maxLength={2000} placeholder="mis. Tambah 1 grup tukang batu, kejar revetment seksi 2" />
        </div>
        <div>
          <Label htmlFor={`ra-pic-${issueId}`}>PIC</Label>
          <Input id={`ra-pic-${issueId}`} name="picName" maxLength={120} />
        </div>
        <div>
          <Label htmlFor={`ra-due-${issueId}`}>Target selesai</Label>
          <Input id={`ra-due-${issueId}`} name="dueDate" type="date" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={pending}>Simpan aksi</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>Tutup</Button>
      </div>
    </form>
  );
}

function AddUpdateForm({ actionId }: { actionId: string }) {
  const [state, action, pending] = useActionState<IssueActionState, FormData>(addRecoveryUpdate, undefined);
  return (
    <form action={action} className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="actionId" value={actionId} />
      <Input
        name="note"
        required
        minLength={2}
        maxLength={2000}
        placeholder="Catat perkembangan…"
        className="h-8 w-64 text-[13px]"
        aria-label="Perkembangan aksi pemulihan"
      />
      <Button size="sm" variant="secondary" type="submit" loading={pending}>Catat</Button>
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function IssueCard({ issue, canManage }: { issue: IssueData; canManage: boolean }) {
  const [showAddAction, setShowAddAction] = useState(false);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{issue.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <StatusPill tone={ISSUE_SEVERITY_TONE[issue.severity]} label={ISSUE_SEVERITY_LABEL[issue.severity]} />
            <StatusPill tone={ISSUE_STATUS_TONE[issue.status]} label={ISSUE_STATUS_LABEL[issue.status]} />
            <span>{formatTanggal(new Date(issue.createdAt))}</span>
          </div>
          {issue.description ? <p className="mt-1 text-[13px] text-ink-muted">{issue.description}</p> : null}
        </div>
        {canManage ? <IssueStatusControl issueId={issue.id} status={issue.status} /> : null}
      </div>

      <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
        {issue.actions.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Belum ada aksi pemulihan.</p>
        ) : (
          issue.actions.map((a) => (
            <div key={a.id} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-ink">{a.description}</span>
                  <span className="ml-2 text-xs text-ink-muted">
                    {a.picName ? `PIC ${a.picName}` : "Tanpa PIC"}
                    {a.dueDate ? ` · target ${formatTanggal(new Date(a.dueDate))}` : ""}
                  </span>
                </div>
                {canManage ? (
                  <RecoveryStatusControl actionId={a.id} status={a.status} />
                ) : (
                  <StatusPill tone={RECOVERY_STATUS_TONE[a.status]} label={RECOVERY_STATUS_LABEL[a.status]} />
                )}
              </div>
              {a.updates.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[13px] text-ink-muted">
                  {a.updates.map((u) => (
                    <li key={u.id}>
                      <span className="tabular text-ink-faint">{formatTanggal(new Date(u.createdAt))}</span> — {u.note}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canManage ? <AddUpdateForm actionId={a.id} /> : null}
            </div>
          ))
        )}
        {canManage ? (
          showAddAction ? (
            <AddRecoveryActionForm issueId={issue.id} onDone={() => setShowAddAction(false)} />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setShowAddAction(true)}>
              Tambah aksi pemulihan
            </Button>
          )
        ) : null}
      </div>
    </li>
  );
}

export function IssuesPanel({
  locationId,
  issues,
  canManage,
}: {
  locationId: string;
  issues: IssueData[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-3">
      {canManage ? <CreateIssueForm locationId={locationId} /> : null}
      {issues.length === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada kendala tercatat.</p>
      ) : (
        <ul className="divide-y divide-border">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}
