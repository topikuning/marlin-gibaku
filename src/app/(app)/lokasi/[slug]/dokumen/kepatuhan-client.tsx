"use client";

import { useActionState, useState } from "react";
import { Banner, Button, FileInput, Input, Label, Select, StatusPill, Textarea } from "@/components/ui";
import {
  updateMilestoneAction,
  verifyMilestoneAction,
  type MilestoneActionState,
} from "@/lib/milestones/actions";
import { uploadDocumentAction, type UploadActionState } from "@/app/(app)/dokumen/actions";
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
  slug,
  item,
  picOptions,
  onClose,
}: {
  slug: string;
  item: MilestoneRow;
  picOptions: { id: string; fullName: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<MilestoneActionState, FormData>(updateMilestoneAction, undefined);
  return (
    <form action={action} className="mt-2 grid gap-2 rounded-md border border-border bg-surface-muted p-3 sm:grid-cols-2">
      {state?.error ? <div className="sm:col-span-2"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="sm:col-span-2"><Banner tone="success" title={state.success} /></div> : null}
      <input type="hidden" name="milestoneId" value={item.id} />
      <input type="hidden" name="slug" value={slug} />
      <div>
        <Label htmlFor={`st-${item.id}`}>Status</Label>
        <Select id={`st-${item.id}`} name="status" defaultValue={item.status}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`pic-${item.id}`}>PIC</Label>
        <Select id={`pic-${item.id}`} name="picUserId" defaultValue={item.picUserId ?? ""}>
          <option value="">— tanpa PIC —</option>
          {picOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.fullName}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`due-${item.id}`}>Jatuh tempo</Label>
        <Input id={`due-${item.id}`} name="dueDate" type="date" defaultValue={item.dueDate ?? ""} />
      </div>
      <div>
        <Label htmlFor={`note-${item.id}`}>Catatan</Label>
        <Input id={`note-${item.id}`} name="note" defaultValue={item.note ?? ""} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" type="submit" loading={pending}>Simpan</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>Tutup</Button>
      </div>
    </form>
  );
}

function VerifyButton({ slug, milestoneId }: { slug: string; milestoneId: string }) {
  const [state, action, pending] = useActionState<MilestoneActionState, FormData>(verifyMilestoneAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <input type="hidden" name="slug" value={slug} />
      {state?.error ? <span className="mr-2 text-xs text-danger">{state.error}</span> : null}
      <Button size="sm" variant="secondary" type="submit" loading={pending}>
        Verifikasi & Selesai
      </Button>
    </form>
  );
}

export function MilestonePanel({
  slug,
  items,
  picOptions,
  canManage,
  canVerify,
}: {
  slug: string;
  items: MilestoneRow[];
  picOptions: { id: string; fullName: string }[];
  canManage: boolean;
  canVerify: boolean;
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
                  <a key={d.id} href={`/api/documents/${d.id}`} className="text-primary hover:underline">
                    📎 {d.title}
                  </a>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {canVerify && m.requiresVerification && m.status !== "selesai" && m.documents.length > 0 && (
                <VerifyButton slug={slug} milestoneId={m.id} />
              )}
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                  {openId === m.id ? "Tutup" : "Kelola"}
                </Button>
              )}
            </div>
          </div>
          {openId === m.id && canManage && (
            <MilestoneEditForm slug={slug} item={m} picOptions={picOptions} onClose={() => setOpenId(null)} />
          )}
        </li>
      ))}
    </ul>
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
        <Select id="up-phase" name="phase" defaultValue="pelaksanaan">
          {ALL_PHASES.map((p) => (
            <option key={p} value={p}>{PHASE_LABEL[p]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="up-type" required>Tipe</Label>
        <Select id="up-type" name="type" defaultValue="laporan">
          {ALL_DOC_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="up-milestone">Milestone (bukti utk)</Label>
        <Select id="up-milestone" name="milestoneId" defaultValue="">
          <option value="">— tidak terkait milestone —</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
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
