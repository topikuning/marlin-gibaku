"use client";

import { useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
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

export function PetaMap({ markers }: { markers: PetaMarker[] }) {
  const [snap, setSnap] = useState<LocationSnapshot | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const center: [number, number] =
    markers.length > 0 ? [markers[0].lat, markers[0].lon] : [-7.0, 112.0];

  async function select(id: string) {
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
    <div className="relative overflow-hidden rounded-xl border border-[#E2E8F0]">
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom
        style={{ height: "72vh", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        {markers.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={7}
            pathOptions={{
              color: "#fff",
              weight: 1.2,
              fillColor: STATUS_COLOR[m.status] ?? "#64748B",
              fillOpacity: 0.92,
            }}
            eventHandlers={{ click: () => select(m.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="text-xs font-semibold">{m.name}</span>
              <br />
              <span className="text-[11px]">
                {m.regency} · {m.province}
              </span>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Panel detail (klik titik) */}
      {(snap || loadingId) && (
        <div className="absolute right-3 top-3 z-[1000] max-h-[calc(72vh-24px)] w-[300px] overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-lg">
          {loadingId && !snap ? (
            <p className="text-sm text-slate-400">Memuat…</p>
          ) : snap ? (
            <>
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{snap.name}</div>
                  <div className="text-xs text-slate-500">
                    {snap.regency} · {snap.province}
                  </div>
                </div>
                <button
                  onClick={() => setSnap(null)}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label="Tutup"
                >
                  ✕
                </button>
              </div>
              <span
                className="mb-3 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ background: STATUS_COLOR[snap.status] ?? "#64748B" }}
              >
                {STATUS_LABEL[snap.status] ?? snap.status}
              </span>

              <div className="mb-1 mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  Progress · minggu {snap.weekNumber}/{snap.totalWeeks}
                </span>
                <span className="font-semibold text-[#0F172A]">
                  {snap.realizedPct.toFixed(1)}%
                </span>
              </div>
              <div className="relative mb-1 h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
                <div
                  className="h-full rounded-full bg-[#1e3a8a]"
                  style={{ width: `${Math.min(Math.max(snap.realizedPct, 0), 100)}%` }}
                />
                <div
                  className="absolute top-0 h-full w-0.5 bg-[#DC2626]"
                  style={{ left: `${Math.min(Math.max(snap.planPct, 0), 100)}%` }}
                />
              </div>
              <div className="mb-3 text-[11px] text-slate-500">
                Rencana {snap.planPct.toFixed(1)}% · deviasi{" "}
                <span className={snap.deviationPct < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}>
                  {snap.deviationPct >= 0 ? "+" : ""}
                  {snap.deviationPct.toFixed(1)}%
                </span>
              </div>

              {snap.phase.length > 0 && (
                <>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
                    Fase minggu ini
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {snap.phase.map((t) => (
                      <span key={t.key} className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[11px] text-[#1e3a8a]">
                        {t.label} · {t.pct.toFixed(1)}%
                      </span>
                    ))}
                  </div>
                </>
              )}

              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
                Foto terbaru
              </div>
              {snap.photos.some((p) => p.thumbUrl) ? (
                <div className="mb-3">
                  <PhotoGallery photos={snap.photos} thumbClass="h-16 w-16" />
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-400">Belum ada foto laporan.</p>
              )}

              <Link
                href={`/lokasi/${snap.slug}`}
                className="inline-block rounded-md bg-[#1e3a8a] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#172554]"
              >
                Buka detail lokasi →
              </Link>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
