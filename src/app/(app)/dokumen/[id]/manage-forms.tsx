"use client";

import { useActionState } from "react";
import {
  Banner,
  Button,
  Combobox,
  ConfirmSubmit,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import {
  deleteDocumentAction,
  restoreDocumentAction,
  updateDocumentAction,
  voidDocumentAction,
  type UploadActionState,
} from "@/app/(app)/dokumen/actions";
import { ALL_DOC_TYPES, ALL_PHASES, PHASE_LABEL, TYPE_LABEL } from "@/lib/documents-meta";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/**
 * Form koreksi metadata + zona bahaya (batalkan / pulihkan / hapus permanen).
 * Hanya dirender bila capability-nya ada; server action tetap memeriksa ulang.
 */

export type ManageTarget = {
  documentId: string;
  locationSlug: string;
  packageId: string;
};

function Hidden({ target }: { target: ManageTarget }) {
  return (
    <>
      <input type="hidden" name="documentId" value={target.documentId} />
      <input type="hidden" name="locationSlug" value={target.locationSlug} />
      <input type="hidden" name="packageId" value={target.packageId} />
    </>
  );
}

function Result({ state }: { state: UploadActionState }) {
  if (state?.error) return <Banner tone="error" title={state.error} />;
  if (state?.success) return <Banner tone="success" title={state.success} />;
  return null;
}

export function DocumentEditForm({
  target,
  current,
}: {
  target: ManageTarget;
  current: {
    title: string;
    phase: AdminPhase;
    type: DocumentType;
    docNumber: string;
    docDate: string;
    expiryDate: string;
    description: string;
  };
}) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(
    updateDocumentAction,
    undefined,
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Hidden target={target} />
      <div className="sm:col-span-2">
        <Result state={state} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="e-title" required>
          Judul (keterangan bebas)
        </Label>
        <Input id="e-title" name="title" defaultValue={current.title} required />
        <p className="mt-1 text-xs text-ink-muted">
          Nama yang tampil di daftar dibentuk otomatis dari jenis + lokasi + tanggal + nomor. Judul di
          sini hanya jadi keterangan tambahan bila menambah informasi.
        </p>
      </div>
      <div>
        <Label htmlFor="e-phase" required>
          Fase
        </Label>
        <Combobox id="e-phase" name="phase" defaultValue={current.phase}>
          {ALL_PHASES.map((p) => (
            <option key={p} value={p}>
              {PHASE_LABEL[p]}
            </option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="e-type" required>
          Jenis dokumen
        </Label>
        <Combobox id="e-type" name="type" defaultValue={current.type}>
          {ALL_DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Combobox>
      </div>
      <div>
        <Label htmlFor="e-number">Nomor dokumen</Label>
        <Input id="e-number" name="docNumber" defaultValue={current.docNumber} />
      </div>
      <div>
        <Label htmlFor="e-date">Tanggal dokumen</Label>
        <Input id="e-date" name="docDate" type="date" defaultValue={current.docDate} />
      </div>
      <div>
        <Label htmlFor="e-expiry">Tanggal kadaluarsa (jaminan dsb.)</Label>
        <Input id="e-expiry" name="expiryDate" type="date" defaultValue={current.expiryDate} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="e-desc">Keterangan</Label>
        <Textarea id="e-desc" name="description" rows={2} defaultValue={current.description} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending}>
          Simpan koreksi
        </Button>
      </div>
    </form>
  );
}

export function VoidDocumentForm({ target, displayName }: { target: ManageTarget; displayName: string }) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(
    voidDocumentAction,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <Hidden target={target} />
      <Result state={state} />
      <div>
        <Label htmlFor="v-reason" required>
          Alasan pembatalan
        </Label>
        <Textarea
          id="v-reason"
          name="reason"
          rows={2}
          required
          placeholder="Mis. salah lokasi – berkas ini milik Desa Pesisir, bukan Kedungrejo"
        />
      </div>
      <ConfirmSubmit
        label="Batalkan dokumen"
        title="Batalkan dokumen ini?"
        description={`"${displayName}" akan hilang dari daftar dokumen dan tidak lagi dihitung sebagai bukti milestone administrasi. File & jejak audit tetap tersimpan – dokumen bisa dipulihkan kembali.`}
        confirmLabel="Ya, batalkan"
        variant="danger"
        confirmVariant="danger"
        loading={pending}
      />
    </form>
  );
}

export function RestoreDocumentForm({ target }: { target: ManageTarget }) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(
    restoreDocumentAction,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <Hidden target={target} />
      <Result state={state} />
      <Button type="submit" loading={pending}>
        Pulihkan dokumen
      </Button>
    </form>
  );
}

export function DeleteDocumentForm({
  target,
  displayName,
}: {
  target: ManageTarget;
  displayName: string;
}) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(
    deleteDocumentAction,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <Hidden target={target} />
      <Result state={state} />
      <div>
        <Label htmlFor="d-confirm" required>
          Ketik <span className="font-mono">HAPUS PERMANEN</span> untuk mengonfirmasi
        </Label>
        <Input id="d-confirm" name="confirm" autoComplete="off" placeholder="HAPUS PERMANEN" required />
      </div>
      <ConfirmSubmit
        label="Hapus permanen"
        title="Hapus dokumen ini permanen?"
        description={`"${displayName}" dan filenya dihapus dari penyimpanan. TIDAK BISA dipulihkan – yang tersisa hanya catatan audit bahwa dokumen ini pernah ada dan siapa yang menghapusnya.`}
        confirmLabel="Ya, hapus permanen"
        variant="danger"
        confirmVariant="danger"
        loading={pending}
      />
    </form>
  );
}
