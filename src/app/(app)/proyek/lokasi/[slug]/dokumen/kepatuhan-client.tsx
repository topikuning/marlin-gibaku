"use client";

import { useActionState, useState } from "react";
import { Banner, Button, FileInput, Input, Label, Combobox, StatusPill, Textarea } from "@/components/ui";
import {
  syncComplianceAction,
  updateMilestoneAction,
  verifyMilestoneAction,
  type ComplianceSyncState,
  type MilestoneActionState,
} from "@/lib/milestones/actions";
import { uploadDocumentAction, type UploadActionState } from "@/app/(app)/dokumen-laporan/dokumen/actions";
import { ALL_DOC_TYPES, ALL_PHASES, PHASE_LABEL, TYPE_LABEL } from "@/lib/documents-meta";
import type { MilestoneStatus } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui/badge";

const STATUS_OPTIONS: { value: MilestoneStatus; label: string }[] = [
  { value: "belum_dimulai", label: "Belum Dimulai" },
  { value: "berjalan", label: "Berjalan" },
  { value: "menunggu_pihak_lain", label: "Menunggu Pihak Lain" },
  { value: "perlu_perbaikan", label: "Perlu Perbaikan" },
  { value: "selesai", label: "Selesai" },
  { value: "tidak_berlaku", label: "Tidak Berlaku" },
];

type MilestoneRow = {
  id: string;
  name: string;
  status: MilestoneStatus;
  statusLabel: string;
  statusTone: BadgeTone;
  requiresVerification: boolean;
  verified: boolean;
  picUserId: string | null;
  picName: string | null;
  dueDate: string | null;
  note: string | null;
  documents: { id: string; title: string }[];
};

function MilestoneEditForm({
  slug = "",
  packageId = "",
  item,
  picOptions,
  canUpload,
  onClose,
}: {
  slug?: string;
  packageId?: string;
  item: MilestoneRow;
  picOptions: { id: string; fullName: string }[];
  canUpload: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<MilestoneActionState, FormData>(updateMilestoneAction, undefined);
  return (
    <form action={action} className="mt-2 grid gap-3 rounded-md border border-border bg-surface-muted p-3 sm:grid-cols-2">
      {state?.error ? <div className="sm:col-span-2"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="sm:col-span-2"><Banner tone="success" title={state.success} /></div> : null}
      <input type="hidden" name="milestoneId" value={item.id} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="packageId" value={packageId} />
      <div>
        <Label htmlFor={`st-${item.id}`}>Status</Label>
        <Combobox id={`st-${item.id}`} name="status" defaultValue={item.status}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor={`pic-${item.id}`}>Penanggung jawab (PIC)</Label>
        <Combobox id={`pic-${item.id}`} name="picUserId" defaultValue={item.picUserId ?? ""}>
          <option value="">— tanpa PIC —</option>
          {picOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.fullName}</option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor={`due-${item.id}`}>Jatuh tempo</Label>
        <Input id={`due-${item.id}`} name="dueDate" type="date" defaultValue={item.dueDate ?? ""} />
      </div>
      {canUpload ? (
        <div>
          <Label htmlFor={`file-${item.id}`}>Lampiran dokumen</Label>
          <FileInput id={`file-${item.id}`} name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx" />
          <p className="mt-1 text-xs text-ink-muted">
            Unggah bukti (PDF/DOCX) — status otomatis maju setelah terunggah.
          </p>
        </div>
      ) : null}
      {item.documents.length > 0 ? (
        <div className="sm:col-span-2">
          <Label>Dokumen terlampir</Label>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {item.documents.map((d) => (
              <li key={d.id}>
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="text-primary hover:underline">📎 {d.title}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Label htmlFor={`note-${item.id}`}>Catatan</Label>
        <Textarea id={`note-${item.id}`} name="note" rows={2} defaultValue={item.note ?? ""} placeholder="Tambahkan catatan kepatuhan di sini…" />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>Tutup</Button>
        <Button size="sm" type="submit" loading={pending}>Simpan Perubahan</Button>
      </div>
    </form>
  );
}

function VerifyButton({
  slug = "",
  packageId = "",
  milestoneId,
}: {
  slug?: string;
  packageId?: string;
  milestoneId: string;
}) {
  const [state, action, pending] = useActionState<MilestoneActionState, FormData>(verifyMilestoneAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="packageId" value={packageId} />
      {state?.error ? <span className="mr-2 text-xs text-danger">{state.error}</span> : null}
      <Button size="sm" variant="secondary" type="submit" loading={pending}>
        Verifikasi & Selesai
      </Button>
    </form>
  );
}

export function MilestonePanel({
  slug = "",
  packageId = "",
  items,
  picOptions,
  canManage,
  canVerify,
  canUpload = false,
}: {
  slug?: string;
  packageId?: string;
  items: MilestoneRow[];
  picOptions: { id: string; fullName: string }[];
  canManage: boolean;
  canVerify: boolean;
  canUpload?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-border">
      {items.map((m) => (
        <li key={m.id} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-sm text-ink">{m.name}</span>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <StatusPill tone={m.statusTone} label={m.statusLabel} />
                {m.picName && <span>PIC: {m.picName}</span>}
                {m.dueDate && <span>Due {m.dueDate}</span>}
                {m.requiresVerification && !m.verified && m.status !== "selesai" && (
                  <span className="text-warning">butuh verifikasi</span>
                )}
                {m.documents.map((d) => (
                  <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="text-primary hover:underline">
                    📎 {d.title}
                  </a>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {canVerify && m.requiresVerification && m.status !== "selesai" && m.documents.length > 0 && (
                <VerifyButton slug={slug} packageId={packageId} milestoneId={m.id} />
              )}
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                  {openId === m.id ? "Tutup" : "Kelola"}
                </Button>
              )}
            </div>
          </div>
          {openId === m.id && canManage && (
            <MilestoneEditForm slug={slug} packageId={packageId} item={m} picOptions={picOptions} canUpload={canUpload} onClose={() => setOpenId(null)} />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tombol "Sinkronkan dari dokumen" — tautkan dokumen paket yang belum terhubung
 * ke checklist kepatuhan berdasarkan jenisnya, tanpa perlu hapus & unggah ulang.
 */
export function SyncComplianceButton({ packageId }: { packageId: string }) {
  const [state, action, pending] = useActionState<ComplianceSyncState, FormData>(syncComplianceAction, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="packageId" value={packageId} />
      <Button size="sm" variant="secondary" type="submit" loading={pending}>
        Sinkronkan dari dokumen
      </Button>
      {state?.error ? <span className="text-right text-xs text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-right text-xs text-success">{state.success}</span> : null}
    </form>
  );
}

export function QuickUploadForm({
  locationId,
  packageId,
  slug,
  milestones,
}: {
  locationId: string;
  packageId: string;
  slug: string;
  milestones: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(uploadDocumentAction, undefined);
  return (
    <form action={action} className="grid gap-2 rounded-md border border-border bg-surface-muted p-3 sm:grid-cols-2 lg:grid-cols-3">
      {state?.error ? <div className="sm:col-span-2 lg:col-span-3"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="sm:col-span-2 lg:col-span-3"><Banner tone="success" title={state.success} /></div> : null}
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="locationSlug" value={slug} />
      <div>
        <Label htmlFor="up-title" required>Judul</Label>
        <Input id="up-title" name="title" required />
      </div>
      <div>
        <Label htmlFor="up-phase" required>Fase</Label>
        <Combobox id="up-phase" name="phase" defaultValue="pelaksanaan">
          {ALL_PHASES.map((p) => (
            <option key={p} value={p}>{PHASE_LABEL[p]}</option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="up-type" required>Tipe</Label>
        <Combobox id="up-type" name="type" defaultValue="laporan">
          {ALL_DOC_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="up-milestone">Milestone (bukti utk)</Label>
        <Combobox id="up-milestone" name="milestoneId" defaultValue="">
          <option value="">— tidak terkait milestone —</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="up-docnumber">Nomor dokumen</Label>
        <Input id="up-docnumber" name="docNumber" />
      </div>
      <div>
        <Label htmlFor="up-docdate">Tanggal dokumen</Label>
        <Input id="up-docdate" name="docDate" type="date" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="up-file" required>File (PDF/JPG/PNG/XLSX/DOCX, maks 15MB)</Label>
        <FileInput id="up-file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx" />
      </div>
      <div className="flex items-end">
        <Button type="submit" loading={pending}>Unggah</Button>
      </div>
    </form>
  );
}
