"use client";

import { useActionState } from "react";
import { Banner, Button, FileInput, Input, Label, Select, Textarea } from "@/components/ui";
import { uploadDocumentAction, type UploadActionState } from "@/app/(app)/dokumen/actions";
import { ALL_DOC_TYPES, ALL_PHASES, PHASE_LABEL, TYPE_LABEL } from "@/lib/documents-meta";

export function UploadForm({
  packages,
  locations,
}: {
  packages: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<UploadActionState, FormData>(uploadDocumentAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {state?.error ? <div className="sm:col-span-2"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="sm:col-span-2"><Banner tone="success" title={state.success} /></div> : null}
      <div className="sm:col-span-2">
        <Label htmlFor="d-title" required>Judul dokumen</Label>
        <Input id="d-title" name="title" required />
      </div>
      <div>
        <Label htmlFor="d-phase" required>Fase</Label>
        <Select id="d-phase" name="phase" defaultValue="pelaksanaan">
          {ALL_PHASES.map((p) => (
            <option key={p} value={p}>{PHASE_LABEL[p]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="d-type" required>Tipe</Label>
        <Select id="d-type" name="type" defaultValue="laporan">
          {ALL_DOC_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="d-package">Paket</Label>
        <Select id="d-package" name="packageId" defaultValue="">
          <option value="">— tidak terkait paket —</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="d-location">Lokasi</Label>
        <Select id="d-location" name="locationId" defaultValue="">
          <option value="">— tidak terkait lokasi —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="d-number">Nomor dokumen</Label>
        <Input id="d-number" name="docNumber" />
      </div>
      <div>
        <Label htmlFor="d-date">Tanggal dokumen</Label>
        <Input id="d-date" name="docDate" type="date" />
      </div>
      <div>
        <Label htmlFor="d-expiry">Tanggal kadaluarsa (jaminan dsb.)</Label>
        <Input id="d-expiry" name="expiryDate" type="date" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="d-desc">Keterangan</Label>
        <Textarea id="d-desc" name="description" rows={2} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="d-file" required>File (PDF/JPG/PNG/WEBP/XLSX/DOCX, maks 15MB)</Label>
        <FileInput
          id="d-file"
          name="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx"
        />
      </div>
      <div>
        <Button type="submit" loading={pending}>Unggah</Button>
      </div>
    </form>
  );
}
