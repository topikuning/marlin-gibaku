"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { X } from "lucide-react";
import type { LocationStatus } from "@/generated/prisma/enums";
import type { LocationSnapshot, PetaMarker } from "@/lib/peta";
import {
  LOCATION_STATUS_LABEL,
  LOCATION_STATUS_TONE,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
} from "@/lib/lifecycle";
import { formatPct, formatRupiahShort, formatTanggal } from "@/lib/format";
import { Input, Select, StatusPill } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { statusColorCss } from "./status-color";

// Leaflet butuh window → render hanya di client (ssr:false).
const PetaMap = dynamic(() => import("./peta-map").then((m) => m.PetaMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-ink-faint">
      Memuat peta…
    </div>
  ),
});

/** Layout dua pane ala versi lama: panel kiri (cari + filter + daftar), peta kanan. */
export function PetaClient({ markers }: { markers: PetaMarker[] }) {
  const [query, setQuery] = useState("");
  const [province, setProvince] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState<LocationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedId = useRef<string | null>(null);

  const provinces = useMemo(() => [...new Set(markers.map((m) => m.province))].sort(), [markers]);
  const statuses = useMemo(() => [...new Set(markers.map((m) => m.status))], [markers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markers.filter(
      (m) =>
        (!province || m.province === province) &&
        (!status || m.status === status) &&
        (!q || `${m.name} ${m.village} ${m.regency} ${m.province}`.toLowerCase().includes(q)),
    );
  }, [markers, query, province, status]);

  async function select(id: string) {
    setSelectedId(id);
    setSnap(null);
    setLoading(true);
    requestedId.current = id;
    try {
      const r = await fetch(`/api/peta/${id}`);
      if (requestedId.current !== id) return; // klik lain sudah menyusul
      if (r.ok) setSnap((await r.json()) as LocationSnapshot);
    } finally {
      if (requestedId.current === id) setLoading(false);
    }
  }

  function close() {
    requestedId.current = null;
    setSelectedId(null);
    setSnap(null);
    setLoading(false);
  }

  return (
    <div className="flex h-[calc(100dvh-14.5rem)] min-h-[480px] overflow-hidden rounded-lg border border-border bg-surface lg:h-[calc(100dvh-11.5rem)]">
      {/* Panel kiri: cari + filter + daftar */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border max-sm:w-[220px]">
        <div className="space-y-2 border-b border-border p-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari lokasi / desa / kabupaten…"
            aria-label="Cari lokasi"
          />
          <div className="flex gap-2">
            <Select
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              aria-label="Filter provinsi"
              className="h-8 min-w-0 flex-1 px-2 text-xs"
            >
              <option value="">Semua provinsi</option>
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter status"
              className="h-8 min-w-0 flex-1 px-2 text-xs"
            >
              <option value="">Semua status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {LOCATION_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="text-[11px] text-ink-faint">
            {filtered.length} dari {markers.length} lokasi
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => select(m.id)}
              className={`flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-muted ${
                selectedId === m.id ? "bg-info-soft" : ""
              }`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: statusColorCss(m.status) }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{m.name}</span>
                <span className="block truncate text-xs text-ink-faint">
                  {m.regency} · {m.province}
                </span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-ink-faint">Tidak ada lokasi cocok.</p>
          )}
        </div>
      </aside>

      {/* Peta kanan + panel detail overlay */}
      <div className="relative min-w-0 flex-1">
        <PetaMap markers={filtered} selectedId={selectedId} onSelect={select} />

        {(snap || loading) && (
          <div className="absolute top-3 right-3 z-[1000] max-h-[calc(100%-24px)] w-[300px] overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg">
            {loading && !snap ? (
              <p className="text-sm text-ink-faint">Memuat…</p>
            ) : snap ? (
              <SnapshotPanel snap={snap} onClose={close} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SnapshotPanel({ snap, onClose }: { snap: LocationSnapshot; onClose: () => void }) {
  const status = snap.status as LocationStatus;
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{snap.name}</div>
          <div className="text-xs text-ink-muted">
            {snap.village}, {snap.regency} · {snap.province}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup panel detail"
          className="rounded p-0.5 text-ink-faint transition-colors hover:bg-surface-inset hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <StatusPill tone={LOCATION_STATUS_TONE[status]} label={LOCATION_STATUS_LABEL[status]} />

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="shrink-0 text-ink-muted">Paket</dt>
          <dd className="truncate text-right font-medium text-ink" title={snap.packageName}>
            {snap.packageName}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="shrink-0 text-ink-muted">Pelaksana</dt>
          <dd className="truncate text-right font-medium text-ink">{snap.vendorName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="shrink-0 text-ink-muted">Kontrak</dt>
          <dd className="truncate text-right font-medium text-ink" title={snap.contractNumber ?? undefined}>
            {snap.contractNumber ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="shrink-0 text-ink-muted">Nilai</dt>
          <dd className="text-right font-medium text-ink tabular-nums">
            {snap.contractValue !== null ? formatRupiahShort(BigInt(snap.contractValue)) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="shrink-0 text-ink-muted">Periode</dt>
          <dd className="text-right font-medium text-ink">
            {snap.startDate && snap.endDate
              ? `${formatTanggal(new Date(snap.startDate))} – ${formatTanggal(new Date(snap.endDate))}`
              : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 mb-1 flex items-center justify-between text-xs">
        <span className="text-ink-muted">
          Progress · minggu {snap.weekNumber}/{snap.totalWeeks}
        </span>
        <span className="font-semibold text-ink tabular-nums">{formatPct(snap.realizedPct)}</span>
      </div>
      {/* Bar realisasi + garis penanda rencana (gaya versi lama) */}
      <div className="relative mb-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-inset">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(Math.max(snap.realizedPct, 0), 100)}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-danger"
          style={{ left: `${Math.min(Math.max(snap.planPct, 0), 100)}%` }}
        />
      </div>
      <div className="mb-3 flex items-center gap-1.5 text-[11px] text-ink-muted">
        <span>Rencana {formatPct(snap.planPct)} · deviasi</span>
        <DeltaBadge value={snap.deviationPct} />
      </div>

      <div className="mb-1 text-[10px] font-semibold tracking-widest text-primary uppercase">
        Laporan terakhir
      </div>
      {snap.lastReport ? (
        <div className="mb-3 flex items-center justify-between gap-2 text-xs">
          <span className="text-ink">{formatTanggal(new Date(snap.lastReport.date))}</span>
          <StatusPill
            tone={REPORT_STATUS_TONE[snap.lastReport.status]}
            label={REPORT_STATUS_LABEL[snap.lastReport.status]}
          />
        </div>
      ) : (
        <p className="mb-3 text-xs text-ink-faint">Belum ada laporan harian.</p>
      )}

      <Link
        href={`/lokasi/${snap.slug}`}
        className="inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-primary px-3 text-[13px] font-medium text-white transition-colors hover:bg-primary-800"
      >
        Buka detail lokasi →
      </Link>
    </>
  );
}
