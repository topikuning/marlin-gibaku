"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import {
  addItemAction,
  addKategoriAction,
  removeNodeAction,
  updateVolumeAction,
  type AdendumActionState,
} from "./actions";

/**
 * EDITOR DRAFT ADENDUM — tabel item dengan edit volume per baris, tambah item
 * per kategori, tambah kategori (bangunan baru), dan hapus node.
 *
 * Aturan yang DITEGAKKAN server dan DIPERLIHATKAN di sini supaya tidak jadi
 * kejutan: harga satuan item lama terkunci (ikon pensil hanya di kolom volume),
 * volume minimal = realisasi (ditampilkan per baris), item ber-realisasi tidak
 * bisa dihapus (tombol hapusnya dimatikan dengan alasan).
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
  unitPrice: number | null;
  amount: string; // BigInt string
  lineageKey: string;
  /** Volume terealisasi (batas bawah volume baru); 0 untuk item baru. */
  realized: number;
  /** Item ini belum ada di revisi aktif (baru ditambah di draft). */
  isNew: boolean;
  /** Volume berbeda dari revisi aktif. */
  isChanged: boolean;
  depth: number;
};

export function AdendumEditor({
  slug,
  revisionId,
  nodes,
}: {
  slug: string;
  revisionId: string;
  nodes: EditorNode[];
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-175 text-[13px]">
          <thead>
            <tr className="bg-surface-inset/60 text-left text-[11px] font-semibold text-ink-muted uppercase">
              <th className="px-3 py-2">Kode</th>
              <th className="px-3 py-2">Uraian</th>
              <th className="px-3 py-2 text-center">Sat</th>
              <th className="px-3 py-2 text-right">Volume</th>
              <th className="px-3 py-2 text-right">Harga Satuan</th>
              <th className="px-3 py-2 text-right">Jumlah</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {nodes.map((n) => (
              <Row key={n.id} slug={slug} revisionId={revisionId} n={n} />
            ))}
          </tbody>
        </table>
      </div>
      <TambahKategori slug={slug} revisionId={revisionId} />
    </div>
  );
}

function Row({ slug, revisionId, n }: { slug: string; revisionId: string; n: EditorNode }) {
  const isItem = n.kind === "item";
  const tone = n.isNew
    ? "bg-success/5"
    : n.isChanged
      ? "bg-warning/5"
      : "";
  return (
    <>
      <tr className={tone}>
        <td className="px-3 py-1.5 whitespace-nowrap text-ink-muted" style={{ paddingLeft: `${12 + n.depth * 16}px` }}>
          {n.code}
        </td>
        <td className={`px-3 py-1.5 ${isItem ? "" : "font-semibold text-ink"}`}>
          {n.name}
          {n.isNew ? <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">BARU</span> : null}
          {n.isChanged && !n.isNew ? (
            <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">UBAH</span>
          ) : null}
          {isItem && n.realized > 0 ? (
            <span className="ml-2 text-[11px] text-ink-muted">terealisasi {volFmt.format(n.realized)}</span>
          ) : null}
        </td>
        <td className="px-3 py-1.5 text-center">{n.unit ?? ""}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {isItem ? <VolumeCell slug={slug} revisionId={revisionId} n={n} /> : null}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {isItem && n.unitPrice != null ? rupiah.format(n.unitPrice) : ""}
        </td>
        <td className="px-3 py-1.5 text-right font-medium tabular-nums">{rupiah.format(BigInt(n.amount))}</td>
        <td className="px-3 py-1.5 text-right whitespace-nowrap">
          {isItem ? <HapusButton slug={slug} revisionId={revisionId} n={n} /> : null}
          {n.kind === "kategori" ? <TambahItem slug={slug} revisionId={revisionId} parent={n} /> : null}
        </td>
      </tr>
    </>
  );
}

/** Sel volume: tampilan angka + mode edit inline (form kecil per baris). */
function VolumeCell({ slug, revisionId, n }: { slug: string; revisionId: string; n: EditorNode }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<AdendumActionState, FormData>(updateVolumeAction, undefined);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-inset"
        title="Ubah volume (harga satuan item lama terkunci)"
      >
        {n.volume != null ? volFmt.format(n.volume) : "—"}
        <Pencil aria-hidden className="size-3 text-ink-muted" />
      </button>
    );
  }
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="nodeId" value={n.id} />
      <span className="inline-flex items-center gap-1">
        <input
          name="volume"
          type="number"
          step="0.001"
          min={n.realized}
          defaultValue={n.volume ?? 0}
          autoFocus
          className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-[13px]"
        />
        <Button type="submit" size="sm" loading={pending}>OK</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Batal</Button>
      </span>
      {n.realized > 0 ? <span className="text-[10px] text-ink-muted">min {volFmt.format(n.realized)} (realisasi)</span> : null}
      {state?.error ? <span className="max-w-56 text-right text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}

function HapusButton({ slug, revisionId, n }: { slug: string; revisionId: string; n: EditorNode }) {
  const [state, formAction, pending] = useActionState<AdendumActionState, FormData>(removeNodeAction, undefined);
  const blocked = n.realized > 0;
  if (blocked) {
    return (
      <span title="Punya realisasi — pekerjaan-kurang lewat volume, bukan hapus.">
        <Trash2 aria-hidden className="inline size-4 text-ink-faint" />
      </span>
    );
  }
  return (
    <form
      action={formAction}
      className="inline"
      onSubmit={(e) => {
        if (!window.confirm(`Hapus "${n.name}" dari draft? Jejaknya tetap ada di riwayat & diff.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="nodeId" value={n.id} />
      <button type="submit" disabled={pending} aria-label={`Hapus ${n.name}`} title="Hapus dari draft">
        <Trash2 aria-hidden className="inline size-4 text-danger" />
      </button>
      {state?.error ? <span className="ml-1 text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}

/** Form tambah item baru di bawah sebuah kategori (collapsible per kategori). */
function TambahItem({ slug, revisionId, parent }: { slug: string; revisionId: string; parent: EditorNode }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<AdendumActionState, FormData>(addItemAction, undefined);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        <Plus aria-hidden className="size-3.5" /> Item
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-end justify-end gap-1.5 py-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="parentId" value={parent.id} />
      <input name="code" placeholder="Kode" className="w-16 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="name" placeholder="Nama item pekerjaan baru" className="w-52 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="unit" placeholder="Sat" className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-[12px]" />
      <input name="volume" type="number" step="0.001" min="0.001" placeholder="Volume" className="w-20 rounded border border-border bg-surface px-1.5 py-1 text-right text-[12px]" />
      <input name="unitPrice" type="number" step="1" min="0" placeholder="Harga satuan" className="w-28 rounded border border-border bg-surface px-1.5 py-1 text-right text-[12px]" />
      <Button type="submit" size="sm" loading={pending}>Tambah</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
      {state?.error ? <span className="w-full text-right text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}

/** Form tambah kategori baru (bangunan/unit baru). */
function TambahKategori({ slug, revisionId }: { slug: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState<AdendumActionState, FormData>(addKategoriAction, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface p-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <div className="text-[13px] font-medium text-ink">Tambah bangunan / kategori baru:</div>
      <input name="code" placeholder="Kode (mis. XV)" className="w-24 rounded border border-border bg-surface px-2 py-1 text-[13px]" />
      <input name="name" placeholder="Nama kategori (mis. PEKERJAAN BANGUNAN POS JAGA)" className="w-80 rounded border border-border bg-surface px-2 py-1 text-[13px]" />
      <Button type="submit" size="sm" loading={pending}>Tambah kategori</Button>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <span className="text-[12px] text-success">{state.success}</span> : null}
    </form>
  );
}
