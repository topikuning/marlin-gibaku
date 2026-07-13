"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/knmp/data-grid";
import { setUserActive } from "./actions";

export type UserRow = {
  id: string;
  username: string;
  fullName: string;
  roleLabel: string;
  locations: number;
  isActive: boolean;
  isSelf: boolean;
};

export function UsersGrid({ rows }: { rows: UserRow[] }) {
  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: "username",
        header: "Username",
        cell: (c) => <span className="font-mono text-[13px] text-[#0F172A]">{c.getValue<string>()}</span>,
      },
      { accessorKey: "fullName", header: "Nama", cell: (c) => <span className="text-[#0F172A]">{c.getValue<string>()}</span> },
      { accessorKey: "roleLabel", header: "Role", cell: (c) => <span className="text-[#1e3a8a]">{c.getValue<string>()}</span> },
      {
        accessorKey: "locations",
        header: "Lokasi",
        meta: { align: "center" },
        cell: (c) => <span className="tabular-nums">{c.getValue<number>()}</span>,
      },
      {
        accessorKey: "isActive",
        header: "Status",
        meta: { align: "center" },
        cell: (c) => {
          const active = c.getValue<boolean>();
          return (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FEE2E2] text-[#DC2626]"}`}>
              {active ? "Aktif" : "Nonaktif"}
            </span>
          );
        },
      },
      {
        id: "aksi",
        header: "Aksi",
        enableSorting: false,
        meta: { align: "right" },
        cell: (c) => {
          const u = c.row.original;
          if (u.isSelf) return <span className="text-xs text-[#94A3B8]">(Anda)</span>;
          return (
            <form action={setUserActive.bind(null, u.id, !u.isActive)}>
              <button
                type="submit"
                className="rounded border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#1e3a8a] transition hover:bg-[#f1f5f9]"
              >
                {u.isActive ? "Nonaktifkan" : "Aktifkan"}
              </button>
            </form>
          );
        },
      },
    ],
    []
  );

  return <DataGrid columns={columns} data={rows} searchPlaceholder="Cari username / nama…" empty="Belum ada pengguna." />;
}
