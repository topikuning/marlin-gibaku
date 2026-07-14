"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationStatus } from "@/generated/prisma/enums";
import type { PetaMarker } from "@/lib/peta";
import { statusColorToken } from "./status-color";

/**
 * Peta Leaflet (client-only — di-load via next/dynamic ssr:false dari peta-client).
 * Marker lingkaran berwarna per status; yang dipilih diberi ring lebih besar.
 */

// Titik tengah default kira-kira pesisir utara Jawa (mayoritas lokasi KNMP).
const DEFAULT_CENTER: [number, number] = [-6.9, 111.5];

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 12, { duration: 0.8 });
  }, [target, map]);
  return null;
}

/**
 * Leaflet menulis warna sebagai atribut SVG — tidak paham `var()`, jadi token
 * di-resolve sekali ke nilai literal via getComputedStyle (aman: file ini
 * hanya dirender di client).
 */
const MAP_TOKENS = [
  "--color-ink-faint",
  "--color-info",
  "--color-warning",
  "--color-success",
  "--color-danger",
  "--color-primary",
  "--color-surface",
] as const;

function useTokenColor(): (token: string) => string {
  const colors = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const t of MAP_TOKENS) out[t] = style.getPropertyValue(t).trim();
    return out;
  }, []);
  return (token: string) => colors[token] ?? "";
}

export interface PetaMapProps {
  markers: PetaMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PetaMap({ markers, selectedId, onSelect }: PetaMapProps) {
  const tokenColor = useTokenColor();
  const statusColor = (status: LocationStatus) => tokenColor(statusColorToken(status));

  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const flyTarget: [number, number] | null = selected ? [selected.lat, selected.lng] : null;
  const center: [number, number] =
    markers.length > 0 ? [markers[0].lat, markers[0].lng] : DEFAULT_CENTER;

  return (
    <MapContainer center={center} zoom={7} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FlyTo target={flyTarget} />
      {markers.map((m) => {
        const active = selectedId === m.id;
        return (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lng]}
            radius={active ? 11 : 7}
            pathOptions={{
              color: active ? tokenColor("--color-primary") : tokenColor("--color-surface"),
              weight: active ? 3 : 1.2,
              fillColor: statusColor(m.status),
              fillOpacity: 0.92,
            }}
            eventHandlers={{ click: () => onSelect(m.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="text-xs font-semibold">{m.name}</span>
              <br />
              <span className="text-[11px]">
                {m.regency} · {m.province}
              </span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
