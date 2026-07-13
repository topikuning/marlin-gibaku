"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/knmp/data-grid";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_CLASS } from "@/lib/roles";
import { formatRupiahShort } from "@/lib/format";
import type { LocationStatus } from "@prisma/client";

export type LokasiRow = {
  id: string;
  slug: string;
  name: string;
  regency: string;
  province: string;
  contractor: string;
  valueNum: number;
  status: LocationStatus;
};

export function LokasiGrid({ rows }: { rows: LokasiRow[] }) {
  const columns = useMemo<ColumnDef<LokasiRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Lokasi",
        cell: (c) => (
          <div>
            <Link href={`/lokasi/${c.row.original.slug}`} className="font-medium text-slate-900 hover:text-[#0F766E]">
              {c.getValue<string>()}
            </Link>
            <div className="text-xs text-slate-500">{c.row.original.regency}</div>
          </div>
        ),
      },
      { accessorKey: "province", header: "Provinsi", cell: (c) => <span className="text-slate-700">{c.getValue<string>()}</span> },
      { accessorKey: "contractor", header: "Kontraktor", cell: (c) => <span className="text-slate-700">{c.getValue<string>()}</span> },
      {
        accessorKey: "valueNum",
        header: "Nilai Kontrak",
        meta: { align: "right" },
        cell: (c) => <span className="tabular-nums text-slate-900">{formatRupiahShort(BigInt(c.getValue<number>()))}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (c) => {
          const s = c.getValue<LocationStatus>();
          return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LOCATION_STATUS_CLASS[s]}`}>{LOCATION_STATUS_LABEL[s]}</span>;
        },
      },
    ],
    []
  );
  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari lokasi / kontraktor…" empty="Belum ada lokasi." />;
}
