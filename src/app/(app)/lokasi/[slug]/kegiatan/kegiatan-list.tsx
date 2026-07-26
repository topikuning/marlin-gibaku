"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Inbox, Search } from "lucide-react";
import { EmptyState } from "@/components/ui";

/** Metadata untuk filter + node kartu (di-render di server, termasuk aksinya). */
export type ActivityCardItem = {
  id: string;
  typeLabel: string;
  statusLabel: string;
  text: string; // gabungan teks (lowercase) untuk pencarian
  node: ReactNode;
};

const controlClass =
  "h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

/**
 * Daftar kegiatan dengan toolbar cari + filter jenis/status (klien). Kartu
 * di-render di server (beserta form aksinya) & disaring berdasarkan metadata.
 */
export function KegiatanList({
  items,
  typeOptions,
  statusOptions,
}: {
  items: ActivityCardItem[];
  typeOptions: string[];
  statusOptions: string[];
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (it) =>
        (!needle || it.text.includes(needle)) &&
        (!type || it.typeLabel === type) &&
        (!status || it.statusLabel === status),
    );
  }, [items, q, type, status]);

  const hasFilter = q !== "" || type !== "" || status !== "";

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
        <div className="relative col-span-2 sm:col-span-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari judul, peserta, kendala, dokumen…"
            className={`${controlClass} w-full pl-8`}
            aria-label="Cari kegiatan"
          />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={`${controlClass} min-w-0`} aria-label="Filter jenis">
          <option value="">Semua jenis</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${controlClass} min-w-0`} aria-label="Filter status">
          <option value="">Semua status</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setQ("");
            setType("");
            setStatus("");
          }}
          disabled={!hasFilter}
          className="col-span-2 h-9 rounded-md border border-border px-3 text-[13px] font-medium text-ink-muted hover:bg-surface-muted disabled:opacity-40 sm:col-span-1"
        >
          Reset
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Inbox}
            title={hasFilter ? "Tak ada kegiatan cocok" : "Belum ada kegiatan"}
            description={hasFilter ? "Ubah kata kunci atau filter." : "Catat kegiatan lewat formulir di samping."}
          />
        </div>
      ) : (
        <div className="space-y-3 p-3">
          {filtered.map((it) => (
            <Fragment key={it.id}>{it.node}</Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
