"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Banner, Button, FileInput, Input, Label, Select, Textarea } from "@/components/ui";
import { uploadDocumentAction, type UploadActionState } from "@/app/(app)/dokumen/actions";
import { ALL_DOC_TYPES, ALL_PHASES, PHASE_LABEL, TYPE_LABEL, TYPES_BY_PHASE } from "@/lib/documents-meta";
import type { AdminPhase } from "@/generated/prisma/enums";

/**
 * Unggah dokumen LANGSUNG dari dalam paket — packageId sudah terisi (tak perlu
 * keluar ke Document Center lalu pilih paket lagi). Fase & Tipe tetap pakai
 * taksonomi resmi; Tipe menyesuaikan Fase yang dipilih.
 */
export function PackageDocUploadForm({
  packageId,
  locations,
}: {
  packageId: string;
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(uploadDocumentAction, undefined);
  const [phase, setPhase] = useState<AdminPhase>("kontrak");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state?.success]);

  const typeOptions = TYPES_BY_PHASE[phase] ?? ALL_DOC_TYPES;

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="packageId" value={packageId} />
      {state?.error ? <div className="sm:col-span-2"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="sm:col-span-2"><Banner tone="success" title={state.success} /></div> : null}

      <div className="sm:col-span-2">
        <Label htmlFor="pu-title" required>Judul dokumen</Label>
        <Input id="pu-title" name="title" required placeholder="mis. Undangan Penunjukan Langsung Paket 351" />
      </div>

      <div>
        <Label htmlFor="pu-phase" required>Fase</Label>
        <Select id="pu-phase" name="phase" value={phase} onChange={(e) => setPhase(e.target.value as AdminPhase)}>
          {ALL_PHASES.map((p) => (
            <option key={p} value={p}>{PHASE_LABEL[p]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="pu-type" required>Jenis dokumen</Label>
        <Select id="pu-type" name="type" defaultValue={typeOptions[0]} key={phase}>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="pu-loc">Lokasi (opsional)</Label>
        <Select id="pu-loc" name="locationId" defaultValue="">
          <option value="">— tingkat paket —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="pu-number">Nomor dokumen</Label>
        <Input id="pu-number" name="docNumber" placeholder="Opsional" />
      </div>

      <div>
        <Label htmlFor="pu-date">Tanggal dokumen</Label>
        <Input id="pu-date" name="docDate" type="date" />
      </div>
      <div>
        <Label htmlFor="pu-expiry">Tanggal kadaluarsa (jaminan dsb.)</Label>
        <Input id="pu-expiry" name="expiryDate" type="date" />
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="pu-desc">Keterangan</Label>
        <Textarea id="pu-desc" name="description" rows={2} placeholder="Opsional" />
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="pu-file" required>File (PDF/JPG/PNG/WEBP/XLSX/DOCX, maks 15MB)</Label>
        <FileInput
          id="pu-file"
          name="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx"
        />
      </div>

      <div>
        <Button type="submit" loading={pending}>Unggah dokumen</Button>
      </div>
    </form>
  );
}
