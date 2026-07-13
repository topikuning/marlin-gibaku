"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { PetaMarker, LocationSnapshot } from "@/lib/peta";
import { PhotoGallery } from "@/components/knmp/photo-gallery";

const STATUS_COLOR: Record<string, string> = {
  planning: "#64748B",
  in_progress: "#16A34A",
  paused: "#B45309",
  completed: "#1e3a8a",
  handed_over: "#7C3AED",
  cancelled: "#DC2626",
};
const STATUS_LABEL: Record<string, string> = {
  planning: "Perencanaan",
  in_progress: "Berjalan",
  paused: "Ditunda",
  completed: "Selesai",
  handed_over: "Serah Terima",
  cancelled: "Dibatalkan",
};

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 12, { duration: 0.8 });
  }, [target, map]);
  return null;
}

export function PetaMap({ markers }: { markers: PetaMarker[] }) {
  const [snap, setSnap] = useState<LocationSnapshot | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [province, setProvince] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const provinces = useMemo(
    () => [...new Set(markers.map((m) => m.province))].sort(),
    [markers]
  );
  const statuses = useMemo(
    () => [...new Set(markers.map((m) => m.status))],
    [markers]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markers.filter(
      (m) =>
        (!province || m.province === province) &&
        (!status || m.status === status) &&
        (!q || `${m.name} ${m.regency} ${m.province}`.toLowerCase().includes(q))
    );
  }, [markers, query, province, status]);

  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const flyTarget: [number, number] | null = selected ? [selected.lat, selected.lon] : null;
  const center: [number, number] =
    markers.length > 0 ? [markers[0].lat, markers[0].lon] : [-7.0, 112.0];

  async function select(id: string) {
    setSelectedId(id);
    setLoadingId(id);
    setSnap(null);
    try {
      const r = await fetch(`/api/peta/${id}`);
      if (r.ok) setSnap(await r.json());
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="flex h-[calc(100vh-130px)] min-h-[520px] overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
      {/* Panel kiri: cari + filter + daftar */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200">
        <div className="space-y-2 border-b border-slate-200 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari lokasi / kabupaten…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]"
          />
          <div className="flex gap-2">
            <select value={province} onChange={(e) => setProvince(e.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-[#1e3a8a]">
              <option value="">Semua area</option>
              {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-[#1e3a8a]">
              <option value="">Semua status</option>
              {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
            </select>
          </div>
          <div className="text-[11px] text-slate-400">{filtered.length} dari {markers.length} lokasi</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => select(m.id)}
              className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                selectedId === m.id ? "bg-[#eff6ff]" : ""
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[m.status] ?? "#64748B" }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{m.name}</span>
                <span className="block truncate text-xs text-slate-400">{m.regency} · {m.province}</span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-slate-400">Tidak ada lokasi cocok.</p>
          )}
        </div>
      </aside>

      {/* Peta */}
      <div className="relative min-w-0 flex-1">
        <MapContainer center={center} zoom={6} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <FlyTo target={flyTarget} />
          {filtered.map((m) => {
            const active = selectedId === m.id;
            return (
              <CircleMarker
                key={m.id}
                center={[m.lat, m.lon]}
                radius={active ? 11 : 7}
                pathOptions={{
                  color: active ? "#1e3a8a" : "#fff",
                  weight: active ? 3 : 1.2,
                  fillColor: STATUS_COLOR[m.status] ?? "#64748B",
                  fillOpacity: 0.92,
                }}
                eventHandlers={{ click: () => select(m.id) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <span className="text-xs font-semibold">{m.name}</span>
                  <br />
                  <span className="text-[11px]">{m.regency} · {m.province}</span>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Panel detail */}
        {(snap || loadingId) && (
          <div className="absolute right-3 top-3 z-[1000] max-h-[calc(100%-24px)] w-[300px] overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-lg">
            {loadingId && !snap ? (
              <p className="text-sm text-slate-400">Memuat…</p>
            ) : snap ? (
              <>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{snap.name}</div>
                    <div className="text-xs text-slate-500">{snap.regency} · {snap.province}</div>
                  </div>
                  <button onClick={() => { setSnap(null); setSelectedId(null); }} className="text-slate-400 hover:text-slate-700" aria-label="Tutup">✕</button>
                </div>
                <span className="mb-3 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: STATUS_COLOR[snap.status] ?? "#64748B" }}>
                  {STATUS_LABEL[snap.status] ?? snap.status}
                </span>
                <div className="mb-1 mt-1 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Progress · minggu {snap.weekNumber}/{snap.totalWeeks}</span>
                  <span className="font-semibold text-[#0F172A]">{snap.realizedPct.toFixed(1)}%</span>
                </div>
                <div className="relative mb-1 h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
                  <div className="h-full rounded-full bg-[#1e3a8a]" style={{ width: `${Math.min(Math.max(snap.realizedPct, 0), 100)}%` }} />
                  <div className="absolute top-0 h-full w-0.5 bg-[#DC2626]" style={{ left: `${Math.min(Math.max(snap.planPct, 0), 100)}%` }} />
                </div>
                <div className="mb-3 text-[11px] text-slate-500">
                  Rencana {snap.planPct.toFixed(1)}% · deviasi{" "}
                  <span className={snap.deviationPct < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}>
                    {snap.deviationPct >= 0 ? "+" : ""}{snap.deviationPct.toFixed(1)}%
                  </span>
                </div>
                {snap.phase.length > 0 && (
                  <>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">Fase minggu ini</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {snap.phase.map((t) => (
                        <span key={t.key} className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[11px] text-[#1e3a8a]">{t.label} · {t.pct.toFixed(1)}%</span>
                      ))}
                    </div>
                  </>
                )}
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">Foto terbaru</div>
                {snap.photos.some((p) => p.thumbUrl) ? (
                  <div className="mb-3"><PhotoGallery photos={snap.photos} thumbClass="h-16 w-16" /></div>
                ) : (
                  <p className="mb-3 text-xs text-slate-400">Belum ada foto laporan.</p>
                )}
                <Link href={`/lokasi/${snap.slug}`} className="inline-block rounded-md bg-[#1e3a8a] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#172554]">
                  Buka detail lokasi →
                </Link>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
