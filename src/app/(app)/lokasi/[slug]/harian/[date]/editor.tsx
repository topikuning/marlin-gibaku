"use client";

import { useActionState, useRef, useState } from "react";
import type { WeatherCode, WorkerRole } from "@prisma/client";
import {
  WORKER_ROLE_ORDER,
  WORKER_ROLE_LABEL,
  WEATHER_ORDER,
  WEATHER_LABEL,
} from "@/lib/daily-log";
import { saveDailyLog } from "../actions";

type Mat = { name: string; unit: string; qty: string };
type Equ = { name: string; count: string };

export function DailyLogEditor({
  slug,
  date,
  initial,
}: {
  slug: string;
  date: string;
  initial: {
    weather: WeatherCode | null;
    workStart: string | null;
    workEnd: string | null;
    notes: string | null;
    workers: Partial<Record<WorkerRole, number>>;
    materials: Mat[];
    equipment: Equ[];
  };
}) {
  const [state, action, pending] = useActionState(saveDailyLog, undefined);
  const [materials, setMaterials] = useState<Mat[]>(
    initial.materials.length ? initial.materials : []
  );
  const [equipment, setEquipment] = useState<Equ[]>(
    initial.equipment.length ? initial.equipment : []
  );
  const matRef = useRef<HTMLInputElement>(null);
  const equRef = useRef<HTMLInputElement>(null);

  const label = "block text-xs font-medium text-slate-500 mb-1";
  const inp =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]";
  // Varian untuk baris flex (tanpa w-full agar flex-basis bekerja).
  const inpRow =
    "min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]";

  return (
    <form
      action={action}
      onSubmit={() => {
        if (matRef.current)
          matRef.current.value = JSON.stringify(
            materials.filter((m) => m.name.trim())
          );
        if (equRef.current)
          equRef.current.value = JSON.stringify(
            equipment.filter((e) => e.name.trim())
          );
      }}
      className="space-y-6"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="logDate" value={date} />
      <input type="hidden" name="materials" ref={matRef} />
      <input type="hidden" name="equipment" ref={equRef} />

      {/* Cuaca + jam kerja */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>Cuaca dominan</label>
          <select name="weather" defaultValue={initial.weather ?? ""} className={inp}>
            <option value="">—</option>
            {WEATHER_ORDER.map((w) => (
              <option key={w} value={w}>
                {WEATHER_LABEL[w]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Jam kerja mulai</label>
          <input name="workStart" defaultValue={initial.workStart ?? ""} placeholder="07:00" className={inp} />
        </div>
        <div>
          <label className={label}>Jam kerja selesai</label>
          <input name="workEnd" defaultValue={initial.workEnd ?? ""} placeholder="16:00" className={inp} />
        </div>
      </div>

      {/* Tenaga kerja per keahlian */}
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-900">
          Tenaga kerja (per keahlian)
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {WORKER_ROLE_ORDER.map((r) => (
            <label
              key={r}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
            >
              <span className="text-xs text-slate-600">{WORKER_ROLE_LABEL[r]}</span>
              <input
                type="number"
                min={0}
                name={`worker_${r}`}
                defaultValue={initial.workers[r] ?? ""}
                placeholder="0"
                className="w-14 rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-[#1e3a8a]"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Material masuk */}
      <RepeatRows
        title="Rekap pemasukan bahan / material"
        addLabel="+ Tambah material"
        rows={materials}
        onAdd={() => setMaterials((s) => [...s, { name: "", unit: "", qty: "" }])}
        onRemove={(i) => setMaterials((s) => s.filter((_, j) => j !== i))}
        render={(row, i) => (
          <>
            <input
              value={row.name}
              onChange={(e) =>
                setMaterials((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
              placeholder="Jenis material/bahan"
              className={`${inpRow} flex-[3]`}
            />
            <input
              value={row.unit}
              onChange={(e) =>
                setMaterials((s) => s.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))
              }
              placeholder="satuan"
              className={`${inpRow} flex-1`}
            />
            <input
              value={row.qty}
              onChange={(e) =>
                setMaterials((s) => s.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
              }
              placeholder="jml"
              className={`${inpRow} w-20`}
            />
          </>
        )}
      />

      {/* Peralatan */}
      <RepeatRows
        title="Peralatan"
        addLabel="+ Tambah peralatan"
        rows={equipment}
        onAdd={() => setEquipment((s) => [...s, { name: "", count: "1" }])}
        onRemove={(i) => setEquipment((s) => s.filter((_, j) => j !== i))}
        render={(row, i) => (
          <>
            <input
              value={row.name}
              onChange={(e) =>
                setEquipment((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
              placeholder="Nama peralatan"
              className={`${inpRow} flex-[3]`}
            />
            <input
              value={row.count}
              onChange={(e) =>
                setEquipment((s) => s.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))
              }
              placeholder="jml"
              className={`${inpRow} w-20`}
            />
          </>
        )}
      />

      <div>
        <label className={label}>Catatan lapangan</label>
        <textarea name="notes" defaultValue={initial.notes ?? ""} rows={3} className={inp} />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan Laporan Harian KKP"}
        </button>
        {state?.ok && <span className="text-sm text-[#15803D]">{state.ok}</span>}
        {state?.error && <span className="text-sm text-[#DC2626]">{state.error}</span>}
      </div>
    </form>
  );
}

function RepeatRows<T>({
  title,
  addLabel,
  rows,
  onAdd,
  onRemove,
  render,
}: {
  title: string;
  addLabel: string;
  rows: T[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  render: (row: T, i: number) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-900">{title}</div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            {render(row, i)}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="shrink-0 rounded-md border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
              aria-label="Hapus baris"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 text-sm font-medium text-[#1e3a8a] hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}
