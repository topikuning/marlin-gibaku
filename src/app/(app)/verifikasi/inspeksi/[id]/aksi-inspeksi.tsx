"use client";

import { useActionState } from "react";
import { Banner, Button, Combobox, ConfirmSubmit, Input, Label, Textarea } from "@/components/ui";
import { finalizeInspectionAction, updateInspectionAction, type InspectionActionState } from "@/lib/inspections/actions";
import { linkEvidenceAction, type FindingActionState } from "@/lib/findings/actions";

function Hasil({ state }: { state: { error?: string; success?: string } | undefined }) {
  if (state?.error) return <Banner tone="error" title={state.error} className="mt-2" />;
  if (state?.success) return <Banner tone="success" title={state.success} className="mt-2" />;
  return null;
}

export function AksiInspeksi({
  inspectionId,
  title,
  notes,
  recommendation,
  dateKey,
}: {
  inspectionId: string;
  title: string;
  notes: string | null;
  recommendation: string | null;
  dateKey: string;
}) {
  const [stateUbah, actionUbah, pendingUbah] = useActionState<InspectionActionState, FormData>(updateInspectionAction, undefined);
  const [stateFinal, actionFinal] = useActionState<InspectionActionState, FormData>(finalizeInspectionAction, undefined);

  return (
    <div className="space-y-4">
      <form action={actionUbah} className="space-y-2">
        <input type="hidden" name="inspectionId" value={inspectionId} />
        <div>
          <Label htmlFor="iu-tanggal">Tanggal</Label>
          <Input id="iu-tanggal" name="inspectionDateKey" type="date" defaultValue={dateKey} />
        </div>
        <div>
          <Label htmlFor="iu-judul" required>Judul</Label>
          <Input id="iu-judul" name="title" defaultValue={title} required maxLength={200} />
        </div>
        <div>
          <Label htmlFor="iu-catatan">Catatan</Label>
          <Textarea id="iu-catatan" name="notes" rows={4} defaultValue={notes ?? ""} maxLength={8000} />
        </div>
        <div>
          <Label htmlFor="iu-rekomendasi">Rekomendasi</Label>
          <Textarea id="iu-rekomendasi" name="recommendation" rows={3} defaultValue={recommendation ?? ""} maxLength={4000} />
        </div>
        <Button type="submit" size="sm" loading={pendingUbah}>Simpan perubahan</Button>
        <Hasil state={stateUbah} />
      </form>

      <form action={actionFinal}>
        <input type="hidden" name="inspectionId" value={inspectionId} />
        <ConfirmSubmit
          label="Finalkan inspeksi"
          title="Finalkan inspeksi?"
          description="Setelah final, catatan inspeksi tidak bisa diubah lagi."
          confirmLabel="Finalkan"
          size="sm"
        />
        <Hasil state={stateFinal} />
      </form>
    </div>
  );
}

export function FormBuktiInspeksi({
  inspectionId,
  foto,
}: {
  inspectionId: string;
  foto: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(linkEvidenceAction, undefined);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`ib-${inspectionId}`}>Foto lokasi</Label>
          <Combobox id={`ib-${inspectionId}`} name="photoId" defaultValue="" options={foto} placeholder={foto.length ? "Pilih foto" : "Belum ada foto di lokasi ini"} />
        </div>
        <div>
          <Label htmlFor={`ic-${inspectionId}`}>Keterangan</Label>
          <Input id={`ic-${inspectionId}`} name="caption" maxLength={300} placeholder="opsional" />
        </div>
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>Tautkan bukti foto</Button>
      <Hasil state={state} />
    </form>
  );
}
