"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import type { CellClassParams, CellValueChangedEvent, ColDef, EditableCallbackParams } from "ag-grid-community";
import { Plus, Trash2 } from "lucide-react";
import { Banner, Button } from "@/components/ui";
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
        cellClass: (p) => (p.data?.isNew && p.data.kind === "item" ? "text-ink" : "text-ink-muted"),
      },
      {
        field: "name",
        headerName: "Uraian pekerjaan",
        flex: 2,
        minWidth: 280,
        sortable: false,
        filter: false,
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
          p.value == null ? (p.data?.kind === "item" ? "—" : "") : volFmt.format(p.value),
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
        headerTooltip: "Item lama terkunci (harga kontrak tetap). Item BARU bebas — harga negosiasi.",
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
          p.data?.isNew ? "—" : p.value == null ? "" : rupiah.format(BigInt(p.value)),
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
              <span title="Punya realisasi — pekerjaan-kurang lewat volume, bukan hapus.">
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
        editMode
        onCellValueChanged={onCellValueChanged}
        rowClassRules={rowClassRules}
        emptyText="Draft kosong"
      />
    </div>
  );
}

/** Form tambah item baru — pilih induk (kategori/sub/grup) lalu isi satu baris. */
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
  const [pending, startTransition] = useTransition();
  if (parents.length === 0) return null;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-3.5" /> Item baru
      </Button>
    );
  }
  const submit = (formData: FormData) => {
    startTransition(() => {
      void addItemAction(undefined, formData).then((res) => {
        setState(res);
        if (res?.success) setOpen(false);
      });
    });
  };
  return (
    <form
      action={submit}
      className="flex w-full flex-wrap items-end gap-1.5 rounded-lg border border-dashed border-border bg-surface p-2"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <select name="parentId" className="rounded border border-border bg-surface px-1.5 py-1 text-[12px]">
        {parents.map((p) => (
          <option key={p.id} value={p.id}>
            {`${"—".repeat(p.depth)} ${p.code} ${p.name}`}
          </option>
        ))}
      </select>
      <input name="code" placeholder="Kode" className="w-16 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="name" placeholder="Nama item pekerjaan baru" className="w-56 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="unit" placeholder="Sat" className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="volume" type="number" step="0.001" min="0.001" placeholder="Volume" className="w-20 rounded border border-border bg-surface px-1.5 py-1 text-right text-[12px]" />
      <input name="unitPrice" type="number" step="1" min="0" placeholder="Harga satuan" className="w-28 rounded border border-border bg-surface px-1.5 py-1 text-right text-[12px]" />
      <Button type="submit" size="sm" loading={pending}>Tambah</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
      {state?.error ? <span className="w-full text-[11px] text-danger">{state.error}</span> : null}
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
    <form
      action={submit}
      className="flex w-full flex-wrap items-end gap-1.5 rounded-lg border border-dashed border-border bg-surface p-2"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input name="code" placeholder="Kode (mis. XV)" className="w-24 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="name" placeholder="Nama kategori (mis. PEKERJAAN BANGUNAN POS JAGA)" className="w-80 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <Button type="submit" size="sm" loading={pending}>Tambah</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
      {state?.error ? <span className="w-full text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
