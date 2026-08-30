"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellKeyDownEvent,
  type CellValueChangedEvent,
  type ColDef,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type RowClassRules,
  type RowClickedEvent,
  type RowSelectionOptions,
  type SelectionChangedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { bacaSimpananKolom, tulisSimpananKolom } from "./column-state";

export { dateCol, pctCol, rupiahCol } from "./kolom";

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

/**
 * Jalan keluar imperatif ke grid — sesempit mungkin, sengaja.
 *
 * Pilihan baris dipegang AG Grid, bukan state pemanggil (lihat prop
 * `rowSelection`). Karena `getRowId` dipasang, AG Grid MEMPERTAHANKAN pilihan
 * per-id saat data disegarkan — jadi panel yang mengosongkan hitungannya sendiri
 * sesudah aksi borongan bisa meninggalkan centang menyala di layar sementara
 * tombolnya menulis "0 dicentang" dan mati. Yang dilihat pengguna dan yang
 * dipercaya kode berbeda, tanpa pesan apa pun.
 *
 * Yang dibuka HANYA pelepasan pilihan. `GridApi` utuh sengaja tidak diteruskan:
 * begitu ia terbuka, pemanggil mulai mengatur kolom, saringan, dan urutan dari
 * luar, dan `MarlinGrid` berhenti jadi satu-satunya tempat aturan grid tinggal.
 */
export type MarlinGridApi = {
  /** Melepas SEMUA centang di grid, termasuk baris yang sedang tersaring. */
  kosongkanPilihan: () => void;
};

export interface MarlinGridProps<T> {
  /** Pegangan imperatif seperlunya — lihat {@link MarlinGridApi}. */
  ref?: Ref<MarlinGridApi>;
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
  ref,
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

  useImperativeHandle(
    ref,
    () => ({
      // Aman dipanggil sebelum grid siap: sebelum itu tidak ada pilihan apa pun.
      kosongkanPilihan: () => apiRef.current?.deselectAll(),
    }),
    [],
  );

  const autoHeight =
    !serverSide && height === "auto" && (rowData?.length ?? 0) <= 100;
  const fixedHeight = height !== "auto" ? height : "600px";

  const saveColumnState = useCallback(
    (e: { api: GridApi<T> }) => {
      if (!persistKey) return;
      try {
        localStorage.setItem(
          storageKey(persistKey),
          tulisSimpananKolom(e.api.getColumnState()),
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
        /*
         * Kolom yang ADA SEKARANG dibaca dari grid, bukan ditebak dari
         * `columnDefs`: colId sebuah kolom boleh berasal dari `colId`, dari
         * `field`, atau dibuatkan AG Grid sendiri. Yang menentukan cocok atau
         * tidaknya simpanan harus nama yang sama dengan yang dipakai
         * `applyColumnState`.
         */
        const kolomSekarang = e.api
          .getColumnState()
          .map((k) => k.colId)
          .filter((id): id is string => typeof id === "string");
        const simpanan = bacaSimpananKolom(
          localStorage.getItem(storageKey(persistKey)),
          kolomSekarang,
        );
        if (simpanan) {
          e.api.applyColumnState({ state: simpanan.state, applyOrder: simpanan.applyOrder });
        }
      } catch {
        // State korup / localStorage diblokir — abaikan, pakai default.
      }
    },
    [persistKey],
  );

  /**
   * Jalan pulang dari layout yang terlanjur kacau.
   *
   * Selama layoutnya tersimpan diam-diam, satu kolom yang tak sengaja
   * disembunyikan atau diseret keluar layar akan ikut berpindah ke kunjungan
   * berikutnya, dan satu-satunya obatnya adalah membersihkan localStorage —
   * yang tidak akan dilakukan Site Manager mana pun. Tombolnya sengaja ada di
   * bilah yang sama dengan pencarian, bukan di menu tersembunyi.
   */
  const aturUlangKolom = useCallback(() => {
    if (persistKey) {
      try {
        localStorage.removeItem(storageKey(persistKey));
      } catch {
        // Diblokir peramban — resetnya tetap berlaku untuk sesi ini.
      }
    }
    apiRef.current?.resetColumnState();
  }, [persistKey]);

  /**
   * Satu-satunya arti dari "baris ini diaktifkan" — dipakai ketukan MAUPUN
   * papan tik.
   *
   * Dipisah dari penangan ketukan karena sebelumnya arti itu hanya hidup di
   * dalam `onRowClicked` AG Grid, dan event itu lahir dari tetikus/sentuhan
   * saja. Akibatnya setiap grid yang barisnya membuka sesuatu — rincian RAPL,
   * padanan AHSP, halaman paket — tidak punya jalan papan tik sama sekali:
   * fokus bisa sampai ke selnya, Enter tidak melakukan apa pun. Itu WCAG 2.1.1
   * Level A, dan ia tidak terlihat di pemeriksaan mata karena dengan tetikus
   * semuanya bekerja.
   */
  const aktifkanBaris = useCallback(
    (src: EventTarget | null | undefined, data: T | null | undefined) => {
      /*
       * Aktivasi yang mendarat di ELEMEN INTERAKTIF di dalam sel (tautan nama
       * lokasi, tombol aksi) diurus elemen itu sendiri. Tanpa penjagaan ini,
       * satu ketukan pada tautan memicu DUA navigasi ke alamat yang sama —
       * tepat perilaku "request berulang" yang sedang diperbaiki, cuma kali
       * ini dibuat oleh kodenya sendiri, bukan oleh jari pengguna.
       */
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
      if (onRowClicked && data != null) onRowClicked(data);
    },
    [onRowClicked, rowLink],
  );

  const handleRowClicked = useCallback(
    (e: RowClickedEvent<T>) => aktifkanBaris(e.event?.target, e.data),
    [aktifkanBaris],
  );

  /**
   * Enter pada sel = ketukan pada barisnya.
   *
   * Space sengaja TIDAK diikutkan: pada grid berkotak-centang, Space sudah
   * berarti "pilih/batalkan baris ini" bagi AG Grid. Merebutnya berarti
   * menukar satu cacat papan tik dengan cacat lain — pengguna kehilangan
   * satu-satunya cara memilih baris tanpa tetikus.
   */
  const handleCellKeyDown = useCallback(
    (e: CellKeyDownEvent<T>) => {
      // Di mode edit, Enter milik editor sel (buka editor, lalu turun sebaris).
      if (editMode) return;
      const ev = e.event;
      if (!(ev instanceof KeyboardEvent) || ev.key !== "Enter") return;
      aktifkanBaris(ev.target, e.data);
    },
    [aktifkanBaris, editMode],
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

  const showToolbar = quickFilter || csvExport || !!persistKey;

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
          <div className="flex shrink-0 items-center gap-2">
            {persistKey ? (
              <button
                type="button"
                onClick={aturUlangKolom}
                title="Kembalikan lebar, urutan, dan kolom yang disembunyikan ke bawaan"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-4" />
                <span className="hidden sm:inline">Atur ulang kolom</span>
              </button>
            ) : null}
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
          onCellKeyDown={onRowClicked || rowLink ? handleCellKeyDown : undefined}
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
