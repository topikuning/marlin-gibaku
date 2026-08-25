"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import type { CellClassParams, CellValueChangedEvent, ColDef, EditableCallbackParams } from "ag-grid-community";
import { Plus, Trash2 } from "lucide-react";
import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import { MarlinGrid } from "@/components/grid/marlin-grid";
import {
  addItemAction,
  addKategoriAction,
  removeNodeAction,
  updateNewItemFieldAction,
  updateVolumeAction,
  type AdendumActionState,
} from "./actions";

/**
 * EDITOR DRAFT ADENDUM — grid gaya Excel: satu klik pada sel langsung mengetik,
 * Enter menyimpan dan turun ke baris berikutnya. Tanpa tombol OK per baris.
 *
 * Kolom lama vs baru berdampingan supaya perubahan terbaca sekali lihat:
 * Vol. kontrak → Vol. adendum, Jumlah kontrak → Jumlah adendum, Δ.
 *
 * Yang bisa diketik (aturan ditegakkan server, grid hanya mencerminkan):
 * - Volume: semua item (batas bawah = realisasi).
 * - Kode/Nama/Sat/Harga satuan: HANYA item BARU — item kontrak lama terkunci.
 */

const rupiah = new Intl.NumberFormat("id-ID");
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export type EditorNode = {
  id: string;
  parentId: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  /** Volume di revisi aktif (null bila item baru). */
  volumeLama: number | null;
  unitPrice: number | null;
  amount: string; // BigInt string
  /** Jumlah di revisi aktif ("0" bila baru). */
  amountLama: string;
  /** amount − amountLama, dihitung server. */
  delta: string;
  lineageKey: string;
  /** Volume terealisasi (batas bawah volume baru); 0 untuk item baru. */
  realized: number;
  /** Jalur induk ("II. STRUKTUR › Lantai 1") — ikut dicari kotak Cari. */
  jalur: string;
  isNew: boolean;
  isChanged: boolean;
  /** false bila node/subtree punya realisasi — tombol hapus dimatikan. */
  canDelete: boolean;
  depth: number;
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

export function AdendumEditor({
  slug,
  revisionId,
  nodes,
}: {
  slug: string;
  revisionId: string;
  nodes: EditorNode[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Mencegah loop: revert programatik men-trigger onCellValueChanged lagi.
  const reverting = useRef(false);

  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<EditorNode>) => {
      if (reverting.current || !e.data || e.newValue === e.oldValue) return;
      const field = e.colDef.field as "volume" | "unitPrice" | "code" | "name" | "unit";
      const revert = () => {
        reverting.current = true;
        e.node.setDataValue(e.column, e.oldValue);
        reverting.current = false;
      };
      const run = async () => {
        const res: AdendumActionState =
          field === "volume"
            ? await updateVolumeAction(
                undefined,
                fd({ slug, revisionId, nodeId: e.data!.id, volume: String(e.newValue ?? "") }),
              )
            : await updateNewItemFieldAction(
                undefined,
                fd({ slug, revisionId, nodeId: e.data!.id, field, value: String(e.newValue ?? "") }),
              );
        if (res?.error) {
          setError(res.error);
          revert();
        } else {
          setError(null);
        }
      };
      startTransition(() => void run());
    },
    [slug, revisionId],
  );

  const onDelete = useCallback(
    (n: EditorNode) => {
      if (!window.confirm(`Hapus "${n.name}" dari draft? Jejaknya tetap ada di riwayat & diff.`)) return;
      startTransition(() => {
        void removeNodeAction(undefined, fd({ slug, revisionId, nodeId: n.id })).then((res) => {
          if (res?.error) setError(res.error);
          else setError(null);
        });
      });
    },
    [slug, revisionId],
  );

  const isItem = (p: EditableCallbackParams<EditorNode> | CellClassParams<EditorNode>) =>
    p.data?.kind === "item";

  const columnDefs = useMemo<ColDef<EditorNode>[]>(
    () => [
      {
        field: "code",
        headerName: "Kode",
        width: 90,
        sortable: false,
        filter: false,
        editable: (p) => Boolean(p.data?.isNew && p.data.kind === "item"),
        // Suffix dedup internal `#N` (artefak lineageKey) tidak ditampilkan.
        valueFormatter: (p) => (p.value == null ? "" : kodeTampil(String(p.value))),
        cellClass: (p) => (p.data?.isNew && p.data.kind === "item" ? "text-ink" : "text-ink-muted"),
      },
      {
        field: "name",
        headerName: "Uraian pekerjaan",
        flex: 2,
        minWidth: 280,
        sortable: false,
        filter: false,
        /*
         * Kotak Cari juga mencocokkan JALUR induk, supaya "cari galian di
         * bangunan B" bisa dijawab dengan mengetik nama bangunannya —
         * baris kategori sendiri tersaring keluar saat mencari, dan tanpa ini
         * hasil pencarian kehilangan konteks tempatnya. DECISIONS 423.
         */
        getQuickFilterText: (p) => `${p.data?.jalur ?? ""} ${p.value ?? ""}`,
        editable: (p) => Boolean(p.data?.isNew && p.data.kind === "item"),
        cellRenderer: (p: { data?: EditorNode; value?: string }) => {
          const n = p.data;
          if (!n) return p.value ?? "";
          return (
            <span
              style={{ paddingLeft: `${n.depth * 16}px` }}
              className={n.kind === "item" ? "" : "font-semibold"}
            >
              {p.value}
              {n.isNew ? (
                <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-success">
                  BARU
                </span>
              ) : null}
              {n.isChanged && !n.isNew ? (
                <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-warning">
                  UBAH
                </span>
              ) : null}
              {n.kind === "item" && n.realized > 0 ? (
                <span className="ml-2 align-middle text-[11px] text-ink-muted">
                  realisasi {volFmt.format(n.realized)}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        field: "unit",
        headerName: "Sat",
        width: 70,
        sortable: false,
        filter: false,
        editable: (p) => Boolean(p.data?.isNew && p.data.kind === "item"),
      },
      {
        field: "volumeLama",
        headerName: "Vol. kontrak",
        width: 110,
        sortable: false,
        filter: false,
        cellClass: "text-right tabular-nums text-ink-muted",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) =>
          p.value == null ? (p.data?.kind === "item" ? "–" : "") : volFmt.format(p.value),
      },
      {
        field: "volume",
        headerName: "Vol. adendum ✎",
        width: 130,
        sortable: false,
        filter: false,
        editable: isItem,
        cellEditor: "agNumberCellEditor",
        cellEditorParams: (p: { data?: EditorNode }) => ({ min: p.data?.realized ?? 0, precision: 3 }),
        headerClass: "ag-right-aligned-header",
        cellClass: (p) =>
          `text-right tabular-nums ${isItem(p) ? "font-medium" : ""} ${p.data?.isChanged ? "bg-warning/10" : ""}`,
        valueFormatter: (p) => (p.value == null ? "" : volFmt.format(p.value)),
        headerTooltip: "Klik sel untuk mengetik. Batas bawah = volume terealisasi.",
      },
      {
        field: "unitPrice",
        headerName: "Harga satuan",
        width: 130,
        sortable: false,
        filter: false,
        editable: (p) => Boolean(p.data?.isNew && p.data.kind === "item"),
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 0 },
        headerClass: "ag-right-aligned-header",
        cellClass: (p) =>
          `text-right tabular-nums ${p.data?.kind === "item" && !p.data.isNew ? "text-ink-muted" : ""}`,
        valueFormatter: (p) => (p.value == null ? "" : rupiah.format(p.value)),
        headerTooltip: "Item lama terkunci (harga kontrak tetap). Item BARU bebas – harga negosiasi.",
      },
      {
        field: "amountLama",
        headerName: "Jumlah kontrak",
        width: 130,
        sortable: false,
        filter: false,
        headerClass: "ag-right-aligned-header",
        cellClass: "text-right tabular-nums text-ink-muted",
        valueFormatter: (p) =>
          p.data?.isNew ? "–" : p.value == null ? "" : rupiah.format(BigInt(p.value)),
      },
      {
        field: "amount",
        headerName: "Jumlah adendum",
        width: 135,
        sortable: false,
        filter: false,
        headerClass: "ag-right-aligned-header",
        cellClass: "text-right tabular-nums font-medium",
        valueFormatter: (p) => (p.value == null ? "" : rupiah.format(BigInt(p.value))),
      },
      {
        field: "delta",
        headerName: "Δ",
        width: 120,
        sortable: false,
        filter: false,
        headerClass: "ag-right-aligned-header",
        cellClass: (p) => {
          const d = BigInt((p.value as string) ?? "0");
          return `text-right tabular-nums ${d > 0n ? "text-success" : d < 0n ? "text-danger" : "text-ink-faint"}`;
        },
        valueFormatter: (p) => {
          const d = BigInt((p.value as string) ?? "0");
          if (d === 0n) return "";
          return `${d > 0n ? "+" : "−"}${rupiah.format(d < 0n ? -d : d)}`;
        },
      },
      {
        colId: "aksi",
        headerName: "",
        width: 56,
        sortable: false,
        filter: false,
        resizable: false,
        cellClass: "text-center",
        cellRenderer: (p: { data?: EditorNode }) => {
          const n = p.data;
          if (!n) return null;
          if (!n.canDelete) {
            return (
              <span title="Punya realisasi – pekerjaan-kurang lewat volume, bukan hapus.">
                <Trash2 aria-hidden className="inline size-4 text-ink-faint" />
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={() => onDelete(n)}
              aria-label={`Hapus ${n.name}`}
              title="Hapus dari draft (berjejak di riwayat & diff)"
            >
              <Trash2 aria-hidden className="inline size-4 text-danger" />
            </button>
          );
        },
      },
    ],
    [onDelete],
  );

  const rowClassRules = useMemo(
    () => ({
      "bg-success/5": (p: { data?: EditorNode }) => Boolean(p.data?.isNew),
      "bg-warning/5": (p: { data?: EditorNode }) => Boolean(p.data?.isChanged && !p.data?.isNew),
    }),
    [],
  );

  const parents = useMemo(() => nodes.filter((n) => n.kind !== "item"), [nodes]);

  return (
    <div className="space-y-3">
      {error ? <Banner tone="error" title={error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <TambahItem slug={slug} revisionId={revisionId} parents={parents} />
        <TambahKategori slug={slug} revisionId={revisionId} />
        <span className="ml-auto text-[12px] text-ink-muted">
          Klik sel langsung ketik · Enter = simpan &amp; turun · Esc = batal
        </span>
      </div>
      <MarlinGrid<EditorNode>
        rowData={nodes}
        columnDefs={columnDefs}
        getRowId={(n) => n.id}
        pagination={false}
        quickFilter
        editMode
        onCellValueChanged={onCellValueChanged}
        rowClassRules={rowClassRules}
        emptyText="Draft kosong"
      />
    </div>
  );
}

/** Kode tampilan: buang suffix dedup internal `#2`, `#3`, … (artefak lineageKey). */
const kodeTampil = (code: string) => code.replace(/#\d+$/, "");

/**
 * Form tambah item baru — induk dipilih lewat Combobox SEARCHABLE (aturan
 * DECISIONS 094/115: semua dropdown filterable, apalagi opsi ratusan), field
 * berlabel jelas, bukan deretan input polos.
 */
function TambahItem({
  slug,
  revisionId,
  parents,
}: {
  slug: string;
  revisionId: string;
  parents: EditorNode[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AdendumActionState>(undefined);
  const [parentId, setParentId] = useState("");
  const [pending, startTransition] = useTransition();
  const parentOptions = useMemo(
    () =>
      parents.map((p) => ({
        value: p.id,
        label: `${"– ".repeat(p.depth)}${kodeTampil(p.code)} · ${p.name}`,
      })),
    [parents],
  );
  if (parents.length === 0) return null;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-3.5" /> Item baru
      </Button>
    );
  }
  const submit = (formData: FormData) => {
    if (!formData.get("parentId")) {
      setState({ error: "Pilih dulu induk (kategori/sub) tempat item baru masuk." });
      return;
    }
    startTransition(() => {
      void addItemAction(undefined, formData).then((res) => {
        setState(res);
        if (res?.success) {
          setOpen(false);
          setParentId("");
        }
      });
    });
  };
  return (
    <form action={submit} className="w-full rounded-lg border border-dashed border-border bg-surface p-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <p className="mb-2 text-[13px] font-semibold text-ink">Item pekerjaan baru</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full lg:min-w-96 lg:flex-1">
          <Label htmlFor="ti-parent" required>Induk (kategori / sub pekerjaan)</Label>
          <Combobox
            id="ti-parent"
            name="parentId"
            required
            value={parentId}
            onChange={setParentId}
            options={parentOptions}
            placeholder="Ketik untuk mencari kategori/sub…"
          />
        </div>
        <div className="w-20">
          <Label htmlFor="ti-code" required>Kode</Label>
          <Input id="ti-code" name="code" required placeholder="cth. 8" />
        </div>
        <div className="w-full sm:min-w-64 sm:flex-1">
          <Label htmlFor="ti-name" required>Nama item pekerjaan</Label>
          <Input id="ti-name" name="name" required placeholder="cth. Pekerjaan Bollard 15/15 cm" />
        </div>
        <div className="w-16">
          <Label htmlFor="ti-unit">Sat</Label>
          <Input id="ti-unit" name="unit" placeholder="m3" />
        </div>
        <div className="w-24">
          <Label htmlFor="ti-volume" required>Volume</Label>
          <Input id="ti-volume" name="volume" required type="number" step="0.001" min="0.001" placeholder="0,000" className="text-right" />
        </div>
        <div className="w-32">
          <Label htmlFor="ti-harga" required>Harga satuan</Label>
          <Input id="ti-harga" name="unitPrice" required type="number" step="1" min="0" placeholder="Rp" className="text-right" />
        </div>
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" loading={pending}>Tambah</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
        </div>
      </div>
      {state?.error ? <p className="mt-2 text-[12px] text-danger">{state.error}</p> : null}
    </form>
  );
}

/** Form tambah kategori baru (bangunan/unit baru). */
function TambahKategori({ slug, revisionId }: { slug: string; revisionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AdendumActionState>(undefined);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-3.5" /> Kategori / bangunan baru
      </Button>
    );
  }
  const submit = (formData: FormData) => {
    startTransition(() => {
      void addKategoriAction(undefined, formData).then((res) => {
        setState(res);
        if (res?.success) setOpen(false);
      });
    });
  };
  return (
    <form action={submit} className="w-full rounded-lg border border-dashed border-border bg-surface p-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <p className="mb-2 text-[13px] font-semibold text-ink">Kategori / bangunan baru</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24">
          <Label htmlFor="tk-code" required>Kode</Label>
          <Input id="tk-code" name="code" required placeholder="cth. XV" />
        </div>
        <div className="w-full sm:min-w-80 sm:flex-1">
          <Label htmlFor="tk-name" required>Nama kategori</Label>
          <Input id="tk-name" name="name" required placeholder="cth. PEKERJAAN BANGUNAN POS JAGA" />
        </div>
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" loading={pending}>Tambah</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
        </div>
      </div>
      {state?.error ? <p className="mt-2 text-[12px] text-danger">{state.error}</p> : null}
    </form>
  );
}
