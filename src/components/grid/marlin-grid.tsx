"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type ColDefField,
  type ColumnState,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type RowClassRules,
  type RowClickedEvent,
  type RowSelectionOptions,
  type SelectionChangedEvent,
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
  /**
   * Ketukan di MANA PUN pada baris membuka tautan pertama di dalam baris itu.
   *
   * Dipakai daftar yang barisnya memang menuju satu halaman. Sebelum ini
   * satu-satunya sasaran adalah tautan nama — diukur 75x16 px, hanya 2,4% luas
   * baris — sehingga di ponsel sebagian besar ketukan TIDAK melakukan apa pun
   * dan terbaca "aplikasi tidak merespon" (DECISIONS 247).
   */
  rowLink?: boolean;
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
  /**
   * Mode edit sel gaya Excel: satu klik langsung edit, Enter pindah ke bawah,
   * editan tersimpan saat sel kehilangan fokus. Kolom mana yang bisa diedit
   * tetap ditentukan `editable` pada masing-masing ColDef.
   */
  editMode?: boolean;
  onCellValueChanged?: (e: CellValueChangedEvent<T>) => void;
  rowClassRules?: RowClassRules<T>;
  /**
   * Tinggi baris tetap (px). Dipakai grid yang selnya memuat DUA baris teks.
   *
   * Sengaja tinggi TETAP, bukan `autoHeight` per kolom: dengan `autoHeight`,
   * tinggi total grid (domLayout "autoHeight") sempat dihitung memakai tinggi
   * baris bawaan sebelum sel yang dua baris sempat memuai — dan baris terakhir
   * terpotong separuh. Diukur di peramban: baris ke-7 dari 7 tertimpa bilah
   * pagination. Angka yang dipatok tidak punya perlombaan itu.
   */
  rowHeight?: number;
  /**
   * Pilih banyak baris dengan kotak centang (DECISIONS 328).
   *
   * Dipakai daftar yang keputusannya BORONGAN — mis. menyetujui 300 padanan
   * AHSP sekaligus. Sengaja memakai pilihan baris AG Grid, bukan kolom kotak
   * centang buatan sendiri: hanya dengan itu "pilih semua" mengikuti hasil
   * saringan & pencarian yang sedang aktif. Kotak centang buatan sendiri akan
   * memilih baris yang sedang tidak terlihat — cacat yang baru ketahuan
   * sesudah tombolnya ditekan.
   */
  rowSelection?: "multi";
  /** Dipanggil tiap pilihan berubah; menerima data baris terpilih. */
  onSelectionChanged?: (dipilih: T[]) => void;
  /** Baris mana yang BOLEH dipilih — mis. hanya yang berstatus usulan. */
  isRowSelectable?: (data: T) => boolean;
}

export function MarlinGrid<T>({
  rowData,
  columnDefs,
  quickFilter = false,
  pagination = true,
  pageSize = 25,
  height = "auto",
  onRowClicked,
  rowLink = false,
  getRowId,
  csvExport = false,
  persistKey,
  serverSide,
  emptyText,
  loading,
  className,
  editMode = false,
  onCellValueChanged,
  rowClassRules,
  rowHeight,
  rowSelection,
  onSelectionChanged,
  isRowSelectable,
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
          /*
           * `pinned` DIBUANG dari state tersimpan — kolom yang dikunci selalu
           * mengikuti kode, bukan simpanan peramban.
           *
           * `getColumnState()` ikut menyimpan `pinned`, termasuk `null` untuk
           * kolom yang saat itu memang belum dikunci. Tanpa pembuangan ini,
           * setiap orang yang PERNAH membuka daftar ini sebelum kuncinya
           * dipasang akan membawa `pinned: null` selamanya: di layar mereka
           * kolomnya tidak terkunci, sementara di layar orang baru terkunci —
           * dan tidak ada satu pun tombol yang bisa menjelaskan bedanya.
           *
           * Yang tetap disimpan justru yang memang milik pengguna: urutan,
           * lebar, sortir, dan kolom yang disembunyikan.
           */
          const state = (JSON.parse(raw) as ColumnState[]).map(
            ({ pinned: _abaikan, ...sisa }) => sisa,
          );
          e.api.applyColumnState({ state, applyOrder: true });
        }
      } catch {
        // State korup — abaikan, pakai default.
      }
    },
    [persistKey],
  );

  const handleRowClicked = useCallback(
    (e: RowClickedEvent<T>) => {
      /*
       * Ketukan yang mendarat di ELEMEN INTERAKTIF di dalam sel (tautan nama
       * lokasi, tombol aksi) diurus elemen itu sendiri. Tanpa penjagaan ini,
       * satu ketukan pada tautan memicu DUA navigasi ke alamat yang sama —
       * tepat perilaku "request berulang" yang sedang diperbaiki, cuma kali
       * ini dibuat oleh kodenya sendiri, bukan oleh jari pengguna.
       */
      const src = e.event?.target;
      if (src instanceof Element && src.closest("a,button,input,select,textarea,[role='button']")) return;

      /*
       * `rowLink`: SELURUH BARIS membuka tautan yang memang sudah ada di
       * dalamnya, dengan cara MENGETUK tautan itu — bukan `router.push`.
       *
       * Bedanya penting. Tautan aslinya melewati <Link> Next DAN pendengar
       * ketukan di shell, jadi barisnya ikut dapat penanda "sedang dibuka",
       * bar progres menyala, dan ketukan ulang ke alamat yang sama tersaring.
       * `router.push` melompati semua itu: navigasinya jalan, tapi senyap —
       * persis penyakit yang sedang diobati.
       */
      if (rowLink) {
        if (!(src instanceof Element)) return;
        src.closest(".ag-row")?.querySelector<HTMLAnchorElement>("a[href]")?.click();
        return;
      }
      if (onRowClicked && e.data != null) onRowClicked(e.data);
    },
    [onRowClicked, rowLink],
  );

  const rowIdGetter = useMemo(
    () =>
      getRowId ? (p: GetRowIdParams<T>) => getRowId(p.data) : undefined,
    [getRowId],
  );

  const selectionOptions = useMemo<RowSelectionOptions<T> | undefined>(() => {
    if (rowSelection !== "multi") return undefined;
    return {
      mode: "multiRow",
      checkboxes: true,
      // Kotak centang kepala memilih SEMUA yang lolos saringan — itulah
      // sebabnya pilihan diserahkan ke grid; lihat catatan pada prop.
      headerCheckbox: true,
      selectAll: "filtered",
      // Ketukan pada baris membuka rinciannya, BUKAN memilihnya: dua makna
      // untuk satu ketukan membuat orang tak sengaja membatalkan pilihannya.
      enableClickSelection: false,
      isRowSelectable: isRowSelectable
        ? (node) => (node.data == null ? false : isRowSelectable(node.data))
        : undefined,
    };
  }, [rowSelection, isRowSelectable]);

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
              // text-base di ponsel: kotak ini diketik, dan kontrol <16px
              // membuat Safari iOS memperbesar halaman lalu tidak
              // mengembalikannya (DECISIONS 246).
              className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-3 text-base sm:text-sm text-ink"
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
          rowClassRules={rowClassRules}
          rowHeight={rowHeight}
          rowSelection={selectionOptions}
          onSelectionChanged={
            onSelectionChanged
              ? (e: SelectionChangedEvent<T>) => onSelectionChanged(e.api.getSelectedRows())
              : undefined
          }
          {...(editMode
            ? {
                singleClickEdit: true,
                stopEditingWhenCellsLoseFocus: true,
                enterNavigatesVertically: true,
                enterNavigatesVerticallyAfterEdit: true,
              }
            : {})}
          onCellValueChanged={onCellValueChanged}
          onGridReady={onGridReady}
          onRowClicked={onRowClicked || rowLink ? handleRowClicked : undefined}
          rowClass={onRowClicked || rowLink ? "cursor-pointer" : undefined}
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
