"use client";

import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

type Align = "left" | "right" | "center";

/** Data grid modern (TanStack Table): sortable + global search + sticky header. */
export function DataGrid<T>({
  columns,
  data,
  searchPlaceholder = "Cari…",
  empty = "Tidak ada data.",
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  searchPlaceholder?: string;
  empty?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    // Cari di SEMUA field baris (termasuk yang tak jadi kolom sendiri, mis. provinsi).
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase().trim();
      if (!q) return true;
      const hay = Object.values(row.original as Record<string, unknown>)
        .map((v) => (v == null ? "" : String(v)))
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const alignClass = (a?: Align) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div>
      <input
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        placeholder={searchPlaceholder}
        className="mb-3 w-full max-w-xs rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15"
      />
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-[#E2E8F0]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[#F8FAFC]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-[#E2E8F0] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
                {hg.headers.map((h) => {
                  const align = (h.column.columnDef.meta as { align?: Align } | undefined)?.align;
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={`whitespace-nowrap px-4 py-2.5 font-semibold ${alignClass(align)} ${sortable ? "cursor-pointer select-none hover:text-[#1e3a8a]" : ""}`}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {sortable && (
                        <span className="ml-1 text-[#1e3a8a]">
                          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-[#94A3B8]">
                  {empty}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-[#EEF2F6] last:border-0 hover:bg-[#F8FAFC]">
                  {row.getVisibleCells().map((cell) => {
                    const align = (cell.column.columnDef.meta as { align?: Align } | undefined)?.align;
                    return (
                      <td key={cell.id} className={`px-4 py-3 ${alignClass(align)}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
