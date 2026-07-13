"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { ProcurementStage } from "@prisma/client";
import { DataGrid } from "@/components/knmp/data-grid";
import { STAGE_LABEL, STAGE_COLOR, PROC_STAGES } from "@/lib/procurement";
import { StageSelect } from "./stage-select";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export type ProcGridRow = {
  id: string;
  slug: string;
  name: string;
  regency: string;
  province: string;
  contractor: string;
  hpsNum: number;
  kontrakNum: number;
  stage: ProcurementStage;
};

export function PengadaanGrid({ rows, canEdit }: { rows: ProcGridRow[]; canEdit: boolean }) {
  const stageOpts = PROC_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }));
  const columns = useMemo<ColumnDef<ProcGridRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Lokasi",
        cell: (c) => (
          <div>
            <Link href={`/lokasi/${c.row.original.slug}`} className="font-medium text-slate-900 hover:text-[#1e3a8a]">{c.getValue<string>()}</Link>
            <div className="text-xs text-slate-500">{c.row.original.regency} · {c.row.original.province}</div>
          </div>
        ),
      },
      { accessorKey: "contractor", header: "Kontraktor", cell: (c) => <span className="text-slate-700">{c.getValue<string>()}</span> },
      { accessorKey: "hpsNum", header: "HPS", meta: { align: "right" }, cell: (c) => <span className="tabular-nums text-slate-600">{rupiah.format(c.getValue<number>())}</span> },
      { accessorKey: "kontrakNum", header: "Kontrak", meta: { align: "right" }, cell: (c) => <span className="tabular-nums text-slate-900">{rupiah.format(c.getValue<number>())}</span> },
      {
        accessorKey: "stage",
        header: "Tahap",
        cell: (c) => {
          const s = c.getValue<ProcurementStage>();
          return canEdit ? (
            <StageSelect locationId={c.row.original.id} stage={s} stages={stageOpts} />
          ) : (
            <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</span>
          );
        },
      },
    ],
    [canEdit] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari lokasi / kontraktor…" empty="Belum ada lokasi." />;
}
