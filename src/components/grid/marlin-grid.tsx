"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ColDefField,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type RowClickedEvent,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Download, Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";

// Registrasi module sekali (module-level), bukan per-render.
ModuleRegistry.registerModules([AllCommunityModule]);

/** Theme MARLIN via Theming API — warna dari design token CSS variables. */
const marlinTheme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  accentColor: "var(--color-primary-600)",
  foregroundColor: "var(--color-ink)",
  headerTextColor: "var(--color-ink-muted)",
  headerBackgroundColor: "var(--color-surface-muted)",
  backgroundColor: "var(--color-surface)",
  borderColor: "var(--color-border)",
  rowHoverColor: "var(--color-surface-muted)",
  wrapperBorderRadius: 8,
});

/** Terjemahan Indonesia minimal untuk teks umum AG Grid. */
const AG_GRID_LOCALE_ID: Record<string, string> = {
  noRowsToShow: "Tidak ada data",
  loadingOoo: "Memuat...",
  filterOoo: "Saring...",
  searchOoo: "Cari...",
  blanks: "(Kosong)",
  selectAll: "(Pilih semua)",
  // Filter teks/angka
  equals: "Sama dengan",
  notEqual: "Tidak sama dengan",
  contains: "Mengandung",
  notContains: "Tidak mengandung",
  startsWith: "Diawali",
  endsWith: "Diakhiri",
  blank: "Kosong",
  notBlank: "Tidak kosong",
  lessThan: "Kurang dari",
  lessThanOrEqual: "Kurang dari atau sama",
  greaterThan: "Lebih dari",
  greaterThanOrEqual: "Lebih dari atau sama",
  inRange: "Dalam rentang",
  inRangeStart: "Dari",
  inRangeEnd: "Sampai",
  andCondition: "DAN",
  orCondition: "ATAU",
  applyFilter: "Terapkan",
  resetFilter: "Reset",
  clearFilter: "Bersihkan",
  cancelFilter: "Batal",
  // Pagination
  page: "Halaman",
  of: "dari",
  to: "s.d.",
  nextPage: "Halaman berikutnya",
  lastPage: "Halaman terakhir",
  firstPage: "Halaman pertama",
  previousPage: "Halaman sebelumnya",
  pageSizeSelectorLabel: "Baris per halaman:",
  ariaPageSizeSelectorLabel: "Baris per halaman",
};

const DEFAULT_COL_DEF: ColDef = {
  sortable: true,
  resizable: true,
  filter: true,
};

function LoadingOverlay() {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      Memuat...
    </div>
  );
}

function NoRowsOverlay(props: { emptyText?: string }) {
  return (
    <div className="py-6 text-sm text-ink-muted">
      {props.emptyText ?? "Tidak ada data"}
    </div>
  );
}

function storageKey(persistKey: string): string {
  return `marlin-grid:${persistKey}`;
}

export interface MarlinGridProps<T> {
  rowData?: T[] | null;
  columnDefs: ColDef<T>[];
  /** Render input "Cari..." (quick filter) di atas grid. */
  quickFilter?: boolean;
  /** Default true, pageSize 25. */
  pagination?: boolean;
  pageSize?: number;
  /**
   * "auto" (default): autoHeight bila rowData ≤ 100 baris, selain itu 600px.
   * Atau nilai CSS eksplisit, mis. "70vh".
   */
  height?: string;
  onRowClicked?: (data: T) => void;
  getRowId?: (data: T) => string;
  /** Tombol "Unduh CSV". */
  csvExport?: boolean;
  /** Simpan/restore column state (urutan, lebar, sort) ke localStorage. */
  persistKey?: string;
  /** Data besar: infinite row model dengan datasource server. */
  serverSide?: { datasource: IDatasource };
  emptyText?: string;
  loading?: boolean;
  className?: string;
}

export function MarlinGrid<T>({
  rowData,
  columnDefs,
  quickFilter = false,
  pagination = true,
  pageSize = 25,
  height = "auto",
  onRowClicked,
  getRowId,
  csvExport = false,
  persistKey,
  serverSide,
  emptyText,
  loading,
  className,
}: MarlinGridProps<T>) {
  const apiRef = useRef<GridApi<T> | null>(null);
  const [quickFilterText, setQuickFilterText] = useState("");

  const autoHeight =
    !serverSide && height === "auto" && (rowData?.length ?? 0) <= 100;
  const fixedHeight = height !== "auto" ? height : "600px";

  const saveColumnState = useCallback(
    (e: { api: GridApi<T> }) => {
      if (!persistKey) return;
      try {
        localStorage.setItem(
          storageKey(persistKey),
          JSON.stringify(e.api.getColumnState()),
        );
      } catch {
        // localStorage penuh/di-block — abaikan, bukan fitur kritis.
      }
    },
    [persistKey],
  );

  const onGridReady = useCallback(
    (e: GridReadyEvent<T>) => {
      apiRef.current = e.api;
      if (!persistKey) return;
      try {
        const raw = localStorage.getItem(storageKey(persistKey));
        if (raw) {
          e.api.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
        }
      } catch {
        // State korup — abaikan, pakai default.
      }
    },
    [persistKey],
  );

  const handleRowClicked = useCallback(
    (e: RowClickedEvent<T>) => {
      if (onRowClicked && e.data != null) onRowClicked(e.data);
    },
    [onRowClicked],
  );

  const rowIdGetter = useMemo(
    () =>
      getRowId ? (p: GetRowIdParams<T>) => getRowId(p.data) : undefined,
    [getRowId],
  );

  const showToolbar = quickFilter || csvExport;

  return (
    <div className={className}>
      {showToolbar ? (
        <div className="no-print mb-2 flex items-center justify-between gap-2">
          {quickFilter ? (
            <input
              type="search"
              value={quickFilterText}
              onChange={(e) => setQuickFilterText(e.target.value)}
              placeholder="Cari..."
              aria-label="Cari di tabel"
              className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-3 text-sm text-ink"
            />
          ) : (
            <span />
          )}
          {csvExport ? (
            <button
              type="button"
              onClick={() => apiRef.current?.exportDataAsCsv()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <Download aria-hidden className="size-4" />
              Unduh CSV
            </button>
          ) : null}
        </div>
      ) : null}
      <div style={autoHeight ? undefined : { height: fixedHeight }}>
        <AgGridReact<T>
          theme={marlinTheme}
          localeText={AG_GRID_LOCALE_ID}
          columnDefs={columnDefs}
          defaultColDef={DEFAULT_COL_DEF}
          domLayout={autoHeight ? "autoHeight" : "normal"}
          pagination={pagination}
          paginationPageSize={pageSize}
          paginationPageSizeSelector={[25, 50, 100]}
          quickFilterText={quickFilter ? quickFilterText : undefined}
          loading={loading}
          loadingOverlayComponent={LoadingOverlay}
          noRowsOverlayComponent={NoRowsOverlay}
          noRowsOverlayComponentParams={{ emptyText }}
          getRowId={rowIdGetter}
          onGridReady={onGridReady}
          onRowClicked={onRowClicked ? handleRowClicked : undefined}
          rowClass={onRowClicked ? "cursor-pointer" : undefined}
          onSortChanged={persistKey ? saveColumnState : undefined}
          onColumnMoved={persistKey ? saveColumnState : undefined}
          onColumnResized={persistKey ? saveColumnState : undefined}
          onColumnVisible={persistKey ? saveColumnState : undefined}
          {...(serverSide
            ? {
                rowModelType: "infinite" as const,
                datasource: serverSide.datasource,
                cacheBlockSize: pageSize,
              }
            : { rowData: rowData ?? [] })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helper kolom — formatter konsisten dari @/lib/format               */
/* ------------------------------------------------------------------ */

const NUMERIC_CELL = "tabular text-right";

/** Kolom Rupiah (BigInt/number), rata kanan + tabular. */
export function rupiahCol<T>(
  field: ColDefField<T>,
  headerName: string,
  extra?: ColDef<T>,
): ColDef<T> {
  return {
    field,
    headerName,
    valueFormatter: (p: ValueFormatterParams<T>) =>
      p.value == null ? "" : formatRupiah(p.value as bigint | number),
    cellClass: NUMERIC_CELL,
    headerClass: "ag-right-aligned-header",
    ...extra,
  };
}

/** Kolom persen, rata kanan + tabular. */
export function pctCol<T>(
  field: ColDefField<T>,
  headerName: string,
  extra?: ColDef<T>,
): ColDef<T> {
  return {
    field,
    headerName,
    valueFormatter: (p: ValueFormatterParams<T>) =>
      p.value == null ? "" : formatPct(Number(p.value)),
    cellClass: NUMERIC_CELL,
    headerClass: "ag-right-aligned-header",
    ...extra,
  };
}

/** Kolom tanggal (Date | string ISO), format Asia/Jakarta. */
export function dateCol<T>(
  field: ColDefField<T>,
  headerName: string,
  extra?: ColDef<T>,
): ColDef<T> {
  return {
    field,
    headerName,
    valueFormatter: (p: ValueFormatterParams<T>) =>
      p.value == null ? "" : formatTanggal(new Date(p.value as string | Date)),
    cellClass: "tabular",
    ...extra,
  };
}
