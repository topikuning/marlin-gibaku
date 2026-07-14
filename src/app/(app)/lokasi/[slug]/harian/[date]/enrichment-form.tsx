"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { Banner, Button, Input, Label, Textarea } from "@/components/ui";
import { saveEnrichmentAction, type DailyActionState } from "@/lib/daily-report/actions";
import {
  WEATHER_LABEL,
  WEATHER_ORDER,
  WORKER_ROLE_LABEL,
  WORKER_ROLE_ORDER,
} from "@/lib/daily-report/constants";
import type { WorkspaceReport } from "@/lib/daily-report/queries";

/**
 * Panel pelengkap KKP: cuaca (radio), jam kerja, tenaga per keahlian (grid
 * angka), material masuk (baris dinamis), peralatan (baris dinamis), catatan.
 * Diisi SM saat verifikasi (status dikirim) atau saat menyusun draft.
 */

type Row = { key: number; name: string; a: string; b: string };
let rowSeq = 1;

export function EnrichmentForm({ report }: { report: WorkspaceReport }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    saveEnrichmentAction,
    undefined,
  );
  const workerMap = new Map(report.workers.map((w) => [w.role, w.count]));
  const [materials, setMaterials] = useState<Row[]>(
    report.materials.length
      ? report.materials.map((m) => ({ key: rowSeq++, name: m.name, a: m.unit ?? "", b: m.qty != null ? String(m.qty) : "" }))
      : [{ key: rowSeq++, name: "", a: "", b: "" }],
  );
  const [equipment, setEquipment] = useState<Row[]>(
    report.equipment.length
      ? report.equipment.map((e) => ({ key: rowSeq++, name: e.name, a: String(e.count), b: "" }))
      : [{ key: rowSeq++, name: "", a: "1", b: "" }],
  );

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">Pelengkap laporan KKP</h2>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={report.id} />

      {/* Cuaca */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Cuaca</legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {WEATHER_ORDER.map((w) => (
            <label
              key={w}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary-50 has-checked:font-medium"
            >
              <input
                type="radio"
                name="weather"
                value={w}
                defaultChecked={report.weather === w}
                className="accent-primary"
              />
              {WEATHER_LABEL[w]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Jam kerja */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="en-start">Jam mulai</Label>
          <Input id="en-start" name="workStart" type="time" defaultValue={report.workStart ?? ""} />
        </div>
        <div>
          <Label htmlFor="en-end">Jam selesai</Label>
          <Input id="en-end" name="workEnd" type="time" defaultValue={report.workEnd ?? ""} />
        </div>
      </div>

      {/* Tenaga per keahlian */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Tenaga kerja (per keahlian)</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WORKER_ROLE_ORDER.map((role) => (
            <div key={role}>
              <Label htmlFor={`w-${role}`} className="text-xs font-normal text-ink-muted">
                {WORKER_ROLE_LABEL[role]}
              </Label>
              <Input
                id={`w-${role}`}
                name={`worker_${role}`}
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={workerMap.get(role) ?? 0}
                className="tabular-nums"
              />
            </div>
          ))}
        </div>
      </fieldset>

      {/* Material masuk */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Pemasukan bahan / material</legend>
        <div className="space-y-2">
          {materials.map((row, idx) => (
            <div key={row.key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {idx === 0 ? <Label className="text-xs font-normal text-ink-muted">Nama</Label> : null}
                <Input name="materialName" defaultValue={row.name} placeholder="mis. Semen 50kg" />
              </div>
              <div className="w-20">
                {idx === 0 ? <Label className="text-xs font-normal text-ink-muted">Sat</Label> : null}
                <Input name="materialUnit" defaultValue={row.a} placeholder="zak" />
              </div>
              <div className="w-24">
                {idx === 0 ? <Label className="text-xs font-normal text-ink-muted">Diterima</Label> : null}
                <Input name="materialQty" type="number" inputMode="decimal" step="0.001" min="0" defaultValue={row.b} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Hapus baris material"
                onClick={() => setMaterials((rows) => rows.filter((r) => r.key !== row.key))}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMaterials((rows) => [...rows, { key: rowSeq++, name: "", a: "", b: "" }])}
          >
            <Plus aria-hidden className="size-4" />
            Tambah material
          </Button>
        </div>
      </fieldset>

      {/* Peralatan */}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Peralatan</legend>
        <div className="space-y-2">
          {equipment.map((row, idx) => (
            <div key={row.key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {idx === 0 ? <Label className="text-xs font-normal text-ink-muted">Nama alat</Label> : null}
                <Input name="equipmentName" defaultValue={row.name} placeholder="mis. Molen beton" />
              </div>
              <div className="w-24">
                {idx === 0 ? <Label className="text-xs font-normal text-ink-muted">Jumlah</Label> : null}
                <Input name="equipmentCount" type="number" inputMode="numeric" min={1} defaultValue={row.a || "1"} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Hapus baris alat"
                onClick={() => setEquipment((rows) => rows.filter((r) => r.key !== row.key))}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEquipment((rows) => [...rows, { key: rowSeq++, name: "", a: "1", b: "" }])}
          >
            <Plus aria-hidden className="size-4" />
            Tambah alat
          </Button>
        </div>
      </fieldset>

      {/* Catatan */}
      <div>
        <Label htmlFor="en-notes">Catatan / keterangan</Label>
        <Textarea id="en-notes" name="notes" maxLength={2000} defaultValue={report.notes ?? ""} />
      </div>

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        Simpan Pelengkap
      </Button>
    </form>
  );
}
