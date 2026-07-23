"use client";

import { Check, ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";
import { renameRabCategoryAction } from "./actions";

/** Node RAB tersalin ke client — BigInt/Decimal SUDAH diserialisasi di server. */
export type RabNodeRow = {
  id: string;
  parentId: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unitPrice: number | null;
  /** Rupiah integer sebagai string (BigInt → string). */
  amount: string;
  sortOrder: number;
};

const KIND_ROW_CLASS: Record<RabNodeRow["kind"], string> = {
  kategori: "bg-surface-inset font-semibold text-ink",
  sub: "bg-surface-muted font-medium text-ink",
  grup: "font-medium text-ink",
  item: "text-ink",
};

type TreeIndex = {
  childrenOf: Map<string | null, RabNodeRow[]>;
  parentOf: Map<string, string | null>;
};

function buildIndex(nodes: RabNodeRow[]): TreeIndex {
  const childrenOf = new Map<string | null, RabNodeRow[]>();
  const parentOf = new Map<string, string | null>();
  for (const n of nodes) {
    parentOf.set(n.id, n.parentId);
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return { childrenOf, parentOf };
}

/** Judul kategori dengan edit inline (pensil) — perbaiki kategori tanpa judul. */
function CategoryNameCell({ node }: { node: RabNodeRow }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function save() {
    const name = inputRef.current?.value.trim() ?? "";
    if (name.length < 2) {
      setError("Judul minimal 2 karakter.");
      return;
    }
    const fd = new FormData();
    fd.set("nodeId", node.id);
    fd.set("name", name);
    startTransition(async () => {
      const res = await renameRabCategoryAction(undefined, fd);
      if (res?.error) setError(res.error);
      else {
        setError(undefined);
        setEditing(false);
      }
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {node.name}
        <button
          type="button"
          onClick={() => { setError(undefined); setEditing(true); }}
          aria-label="Ganti judul kategori"
          title="Ganti judul kategori"
          className="shrink-0 text-ink-faint hover:text-primary"
        >
          <Pencil aria-hidden className="size-3.5" />
        </button>
        {error ? <span className="text-[12px] font-normal text-danger">{error}</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        ref={inputRef}
        defaultValue={node.name}
        autoFocus
        maxLength={200}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          else if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-72 max-w-full rounded border border-border bg-surface px-2 text-sm font-normal"
      />
      <button type="button" onClick={save} disabled={pending} aria-label="Simpan judul" className="text-success hover:opacity-80 disabled:opacity-40">
        <Check aria-hidden className="size-4" />
      </button>
      <button type="button" onClick={() => setEditing(false)} aria-label="Batal" className="text-ink-muted hover:text-ink">
        <X aria-hidden className="size-4" />
      </button>
      {error ? <span className="text-[12px] font-normal text-danger">{error}</span> : null}
    </span>
  );
}

export function RabTree({
  nodes,
  grandTotal,
  ppnPercent,
  ppnValue,
  totalWithPpn,
  canEdit = false,
}: {
  nodes: RabNodeRow[];
  /** Σ kategori (pra-PPN), rupiah string. */
  grandTotal: string;
  ppnPercent: number;
  ppnValue: string;
  totalWithPpn: string;
  /** Pemilik rab.manage → boleh ganti judul kategori. */
  canEdit?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const index = useMemo(() => buildIndex(nodes), [nodes]);

  // Pencarian: node tampil bila dirinya ATAU salah satu turunannya cocok
  // (nama/kode); saat mencari, semua cabang yang tampil otomatis terbuka.
  const matchSet = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const direct = new Set(
      nodes
        .filter((n) => n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q))
        .map((n) => n.id),
    );
    const visible = new Set(direct);
    for (const id of direct) {
      let parent = index.parentOf.get(id) ?? null;
      while (parent && !visible.has(parent)) {
        visible.add(parent);
        parent = index.parentOf.get(parent) ?? null;
      }
    }
    return visible;
  }, [query, nodes, index]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () =>
    setExpanded(new Set(nodes.filter((n) => (index.childrenOf.get(n.id)?.length ?? 0) > 0).map((n) => n.id)));
  const collapseAll = () => setExpanded(new Set());

  // Render depth-first hanya cabang yang terbuka/tersaring.
  const rows: { node: RabNodeRow; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of index.childrenOf.get(parentId) ?? []) {
      if (matchSet && !matchSet.has(n.id)) continue;
      rows.push({ node: n, depth });
      const open = matchSet ? true : expanded.has(n.id);
      if (open) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);

  if (nodes.length === 0) {
    return <p className="text-sm text-ink-muted">Belum ada revisi RAB aktif. Impor file HPS terlebih dahulu.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama / kode pekerjaan…"
          aria-label="Cari item RAB"
          className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-3 text-sm text-ink"
        />
        <button
          type="button"
          onClick={expandAll}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          Buka semua
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          Tutup semua
        </button>
        {matchSet ? (
          <span className="text-[13px] text-ink-muted">{rows.length} baris cocok</span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-175 text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase text-ink-muted">
              <th className="w-24 px-2 py-2">Kode</th>
              <th className="px-2 py-2">Uraian pekerjaan</th>
              <th className="w-20 px-2 py-2 text-right">Vol</th>
              <th className="w-16 px-2 py-2">Satuan</th>
              <th className="w-32 px-2 py-2 text-right">Harga satuan</th>
              <th className="w-36 px-2 py-2 text-right">Jumlah</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-ink-muted">
                  Tidak ada item yang cocok dengan pencarian.
                </td>
              </tr>
            ) : (
              rows.map(({ node, depth }) => {
                const hasChildren = (index.childrenOf.get(node.id)?.length ?? 0) > 0;
                const open = matchSet ? true : expanded.has(node.id);
                return (
                  <tr key={node.id} className={KIND_ROW_CLASS[node.kind]}>
                    <td className="px-2 py-1.5 align-top text-xs text-ink-muted">{node.code}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-start gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggle(node.id)}
                            disabled={matchSet != null}
                            aria-expanded={open}
                            aria-label={open ? `Tutup ${node.name}` : `Buka ${node.name}`}
                            className="mt-0.5 shrink-0 rounded text-ink-muted hover:text-ink disabled:opacity-40"
                          >
                            {open ? (
                              <ChevronDown aria-hidden className="size-4" />
                            ) : (
                              <ChevronRight aria-hidden className="size-4" />
                            )}
                          </button>
                        ) : (
                          <span aria-hidden className="w-4 shrink-0" />
                        )}
                        {canEdit && node.kind === "kategori" ? (
                          <CategoryNameCell node={node} />
                        ) : (
                          <span className={cn(node.kind === "item" && "font-normal")}>{node.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right align-top">
                      {node.volume != null ? formatNumber(node.volume) : ""}
                    </td>
                    <td className="px-2 py-1.5 align-top text-ink-muted">{node.unit ?? ""}</td>
                    <td className="tabular px-2 py-1.5 text-right align-top">
                      {node.unitPrice != null ? formatRupiah(node.unitPrice) : ""}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right align-top">
                      {formatRupiah(Number(node.amount))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot className="border-t border-border text-sm">
            <tr>
              <td colSpan={5} className="px-2 py-1.5 text-right font-medium text-ink-muted">
                Jumlah (pra-PPN)
              </td>
              <td className="tabular px-2 py-1.5 text-right font-semibold text-ink">
                {formatRupiah(Number(grandTotal))}
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="px-2 py-1.5 text-right font-medium text-ink-muted">
                PPN {formatPct(ppnPercent, 0)}
              </td>
              <td className="tabular px-2 py-1.5 text-right text-ink">{formatRupiah(Number(ppnValue))}</td>
            </tr>
            <tr className="bg-surface-muted">
              <td colSpan={5} className="px-2 py-2 text-right font-semibold text-ink">
                Total (inkl. PPN)
              </td>
              <td className="tabular px-2 py-2 text-right font-semibold text-ink">
                {formatRupiah(Number(totalWithPpn))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
