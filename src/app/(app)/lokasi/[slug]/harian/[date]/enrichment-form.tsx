"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { Banner, Button, Input, Label, Textarea } from "@/components/ui";
import {
  fetchWeatherAction,
  saveEnrichmentAction,
  type DailyActionState,
} from "@/lib/daily-report/actions";
import type { KkpWeatherCategory } from "@/lib/weather/hourly";
import {
  SHOW_MANUAL_WEATHER_PICKER,
  WEATHER_LABEL,
  WEATHER_ORDER,
  WORKER_ROLE_LABEL,
  WORKER_ROLE_ORDER,
} from "@/lib/daily-report/constants";
import type { WorkspaceReport } from "@/lib/daily-report/queries";

/**
 * Panel pelengkap KKP: cuaca (otomatis per jam; pemilih manual di balik
 * SHOW_MANUAL_WEATHER_PICKER), jam kerja,
 * tenaga per keahlian (grid angka), material masuk (baris dinamis),
 * peralatan (baris dinamis), catatan.
 * Diisi SM saat verifikasi (status dikirim) atau saat menyusun draft.
 */

type Row = { key: number; name: string; a: string; b: string };
let rowSeq = 1;

const CATEGORY_TONE: Record<KkpWeatherCategory, string> = {
  Cerah: "bg-amber-100 text-amber-900",
  Mendung: "bg-slate-200 text-slate-700",
  Hujan: "bg-sky-200 text-sky-900",
};

/**
 * Pengambilan cuaca otomatis per jam dari koordinat lokasi + pita 07–21 supaya
 * orang lapangan bisa MEMBANDINGKAN dengan yang dia lihat sendiri. Tombol
 * terpisah (bukan otomatis saat halaman dibuka): laporan tidak boleh menunggu
 * jaringan, dan asal angka harus jelas.
 *
 * Tanggal yang diambil = TANGGAL LAPORAN, bukan hari ini — laporan yang diisi
 * mundur (mis. lupa 3 hari) tetap mendapat kondisi tanggal itu.
 */
function WeatherAuto({ report }: { report: WorkspaceReport }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    fetchWeatherAction,
    undefined,
  );
  const hours = report.weatherHourly;
  const isManual = report.weatherSource === "manual";
  const rainHours = hours?.filter((h) => h.category === "Hujan").length ?? 0;

  return (
    <div className="mb-2 space-y-2 rounded-md border border-dashed border-border bg-surface-muted p-2.5">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" size="sm" formAction={formAction} disabled={pending}>
          {pending ? "Mengambil…" : hours ? "Muat ulang cuaca" : "Ambil cuaca otomatis"}
        </Button>
        <span className="text-xs text-ink-muted">
          {hours
            ? `${hours.length} jam terisi${rainHours > 0 ? ` · ${rainHours} jam hujan` : " · tanpa hujan"}`
            : "Berdasarkan koordinat lokasi, mengikuti TANGGAL laporan ini (bukan hari ini) — laporan yang diisi mundur tetap dapat cuaca tanggalnya."}
        </span>
      </div>
      {isManual ? (
        <input type="hidden" name="overwriteManual" value="1" />
      ) : null}
      {/* MEMBUNGKUS, bukan menggulir ke samping. Lima belas sel × 36px ≈ 570px:
          di layar 375px versi satu-baris memaksa usap horizontal untuk melihat
          sore hari — dan sepertiga pitanya tak pernah terlihat kalau tidak ada
          yang sadar bisa diusap. Dua baris memuat semuanya sekaligus. */}
      {hours ? (
        <div className="flex flex-wrap gap-0.5">
          {hours.map((h) => (
            <div key={h.hour} className="w-9 shrink-0 text-center">
              <div className="text-[10px] text-ink-muted">{String(h.hour).padStart(2, "0")}</div>
              <div className={`rounded px-1 py-0.5 text-[10px] font-medium ${CATEGORY_TONE[h.category]}`}>
                {h.category === "Mendung" ? "Mdg" : h.category === "Hujan" ? "Hjn" : "Crh"}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {isManual && hours == null ? (
        <p className="text-xs text-ink-muted">
          Cuaca sudah diisi manual dari lapangan. Menekan tombol di atas akan menggantinya dengan data
          otomatis.
        </p>
      ) : null}
    </div>
  );
}

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
        <WeatherAuto report={report} />
        {/* Pemilih manual dimatikan sejak cuaca otomatis per jam berjalan
            (DECISIONS 177). Saat mati, form TIDAK mengirim field `weather`
            sama sekali sehingga server tahu harus membiarkan isian cuaca apa
            adanya — bukan mengosongkannya. */}
        {SHOW_MANUAL_WEATHER_PICKER ? (
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
        ) : null}
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
