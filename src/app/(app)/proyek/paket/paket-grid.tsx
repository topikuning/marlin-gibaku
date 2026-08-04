"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { MarlinGrid, dateCol, rupiahCol } from "@/components/grid/marlin-grid";
import { StatusPill } from "@/components/ui";
import { PACKAGE_STAGE_LABEL, PACKAGE_STAGE_TONE } from "@/lib/lifecycle";
import type { PackageStage } from "@/generated/prisma/enums";

export type PaketRow = {
  id: string;
  packageNumber: string;
  name: string;
  stage: PackageStage;
  province: string;
  /** BigInt diserialisasi string dari server. */
  hpsValue: string;
  vendorName: string;
  locationCount: number;
  /** Nama (atau ID) grup WhatsApp paket; null = belum diatur. */
  waGroupName: string | null;
  /** Folder Google Drive KKP sudah ditautkan? */
  hasDrive: boolean;
  updatedAt: string;
};

/** Row internal grid: HPS sudah number agar sort/filter numerik benar. */
type GridRow = Omit<PaketRow, "hpsValue"> & { hpsValue: number };

export function PaketGrid({ rows }: { rows: PaketRow[] }) {
  const router = useRouter();

  const data = useMemo<GridRow[]>(
    () => rows.map((r) => ({ ...r, hpsValue: Number(r.hpsValue) })),
    [rows],
  );

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: "packageNumber", headerName: "Nomor", width: 150 },
      {
        field: "name",
        headerName: "Nama Paket",
        flex: 1,
        minWidth: 220,
        tooltipField: "name",
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data ? (
            <Link
              href={`/proyek/paket/${p.data.id}`}
              title={p.data.name}
              className="block truncate font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {p.data.name}
            </Link>
          ) : null,
      },
      {
        field: "stage",
        headerName: "Stage",
        width: 140,
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data ? (
            <StatusPill
              tone={PACKAGE_STAGE_TONE[p.data.stage]}
              label={PACKAGE_STAGE_LABEL[p.data.stage]}
            />
          ) : null,
        valueFormatter: (p) =>
          p.value ? PACKAGE_STAGE_LABEL[p.value as PackageStage] : "",
      },
      { field: "province", headerName: "Provinsi", width: 160 },
      rupiahCol<GridRow>("hpsValue", "HPS", { width: 170 }),
      { field: "vendorName", headerName: "Vendor / Kandidat", width: 200 },
      {
        field: "locationCount",
        headerName: "Lokasi",
        width: 100,
        cellClass: "tabular text-right",
        headerClass: "ag-right-aligned-header",
      },
      {
        // Kesiapan integrasi per paket — permintaan user 2026-07-30: dari daftar
        // langsung kelihatan paket mana yang belum diatur grup WA / folder Drive.
        field: "waGroupName",
        headerName: "Grup WA",
        width: 150,
        tooltipValueGetter: (p) => (p.data?.waGroupName ? `Grup: ${p.data.waGroupName}` : "Grup WhatsApp belum diatur"),
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data ? (
            p.data.waGroupName ? (
              <span className="block truncate text-[13px] text-success" title={p.data.waGroupName}>
                ✓ {p.data.waGroupName}
              </span>
            ) : (
              <StatusPill tone="warning" label="Belum" />
            )
          ) : null,
        // Filter/CSV memakai teks, bukan JSX.
        valueFormatter: (p) => (p.value ? String(p.value) : "Belum diatur"),
      },
      {
        field: "hasDrive",
        headerName: "Drive",
        width: 100,
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data ? (
            p.data.hasDrive ? (
              <span className="text-[13px] text-success">✓ Ada</span>
            ) : (
              <StatusPill tone="warning" label="Belum" />
            )
          ) : null,
        valueFormatter: (p) => (p.value ? "Ada" : "Belum diatur"),
      },
      dateCol<GridRow>("updatedAt", "Diperbarui", { width: 140 }),
    ],
    [],
  );

  return (
    <MarlinGrid<GridRow>
      rowData={data}
      columnDefs={columns}
      quickFilter
      csvExport
      persistKey="paket-list"
      getRowId={(r) => r.id}
      onRowClicked={(r) => router.push(`/proyek/paket/${r.id}`)}
      emptyText="Belum ada paket."
    />
  );
}
