"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/knmp/data-grid";
import { MoneyCell } from "./money-cell";
import type { FinanceField } from "@/lib/finance";

const grp = new Intl.NumberFormat("id-ID");

export type FinGridRow = {
  id: string;
  slug: string;
  name: string;
  contract: number;
  terpasang: number;
  invoiced: number;
  paid: number;
  belumDitagih: number;
  spent: number;
  budgetCap: number;
  need30d: number;
};

export function KeuanganGrid({ rows, canEdit }: { rows: FinGridRow[]; canEdit: boolean }) {
  const money = (rowKey: keyof FinGridRow, field: FinanceField, header: string) => ({
    accessorKey: rowKey,
    header,
    meta: { align: "right" as const },
    cell: (c: { getValue: () => unknown; row: { original: FinGridRow } }) =>
      canEdit ? (
        <MoneyCell locationId={c.row.original.id} field={field} value={Number(c.getValue())} />
      ) : (
        <span className="tabular-nums">{grp.format(Number(c.getValue()))}</span>
      ),
  });

  const num = (key: keyof FinGridRow, header: string, strong = false) => ({
    accessorKey: key,
    header,
    meta: { align: "right" as const },
    cell: (c: { getValue: () => unknown }) => (
      <span className={`tabular-nums ${strong ? "font-medium text-slate-900" : "text-slate-600"}`}>{grp.format(Number(c.getValue()))}</span>
    ),
  });

  const columns = useMemo<ColumnDef<FinGridRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Lokasi",
        cell: (c) => <Link href={`/lokasi/${c.row.original.slug}`} className="font-medium text-slate-900 hover:text-[#1e3a8a]">{c.getValue<string>()}</Link>,
      },
      num("contract", "Kontrak"),
      num("terpasang", "Terpasang", true),
      money("invoiced", "invoicedValue", "Ditagih"),
      money("paid", "paidValue", "Dibayar"),
      num("belumDitagih", "Belum Ditagih", true),
      money("spent", "spentValue", "Pengeluaran"),
      money("budgetCap", "budgetCap", "Pagu"),
      num("need30d", "Keb. 30hr"),
    ] as ColumnDef<FinGridRow, unknown>[],
    [canEdit] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari lokasi…" empty="Belum ada lokasi." />;
}
