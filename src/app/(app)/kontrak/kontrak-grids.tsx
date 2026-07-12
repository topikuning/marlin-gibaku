"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/knmp/data-grid";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export type ContractorRow = { id: string; name: string; npwp: string; contracts: number };
export type ContractRow = {
  id: string;
  contractNumber: string;
  contractor: string;
  valueNum: number;
  periodStr: string;
  startMs: number;
  locations: number;
};

export function ContractorsGrid({ rows }: { rows: ContractorRow[] }) {
  const columns = useMemo<ColumnDef<ContractorRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Nama", cell: (c) => <span className="font-medium text-[#0F172A]">{c.getValue<string>()}</span> },
      { accessorKey: "npwp", header: "NPWP", cell: (c) => <span className="text-[#64748B]">{c.getValue<string>() || "—"}</span> },
      { accessorKey: "contracts", header: "Kontrak", meta: { align: "center" }, cell: (c) => <span className="tabular-nums">{c.getValue<number>()}</span> },
    ],
    []
  );
  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari kontraktor…" empty="Belum ada kontraktor." />;
}

export function ContractsGrid({ rows }: { rows: ContractRow[] }) {
  const columns = useMemo<ColumnDef<ContractRow, unknown>[]>(
    () => [
      { accessorKey: "contractNumber", header: "Nomor SPK", cell: (c) => <span className="font-mono text-[12px] text-[#0F172A]">{c.getValue<string>()}</span> },
      { accessorKey: "contractor", header: "Kontraktor", cell: (c) => <span className="text-[#0F172A]">{c.getValue<string>()}</span> },
      {
        accessorKey: "valueNum",
        header: "Nilai",
        meta: { align: "right" },
        cell: (c) => <span className="tabular-nums text-[#0F172A]">{rupiah.format(c.getValue<number>())}</span>,
      },
      {
        accessorKey: "startMs",
        header: "Periode",
        cell: (c) => <span className="text-xs text-[#64748B]">{c.row.original.periodStr}</span>,
      },
      { accessorKey: "locations", header: "Lokasi", meta: { align: "center" }, cell: (c) => <span className="tabular-nums">{c.getValue<number>()}</span> },
    ],
    []
  );
  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari nomor / kontraktor…" empty="Belum ada kontrak." />;
}
