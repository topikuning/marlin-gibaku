"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationStatus } from "@/generated/prisma/enums";
import type { PetaMarker } from "@/lib/peta";
import { statusColorToken } from "./status-color";

/**
 * Peta Leaflet MURNI tanpa react-leaflet (client-only — di-load via next/dynamic
 * ssr:false dari peta-client). react-leaflet dibuang: lisensinya Hippocratic-2.1
 * (pembatasan penggunaan — di luar allowlist open-source kebijakan repo);
 * leaflet sendiri BSD-2-Clause. Marker lingkaran berwarna per status; yang
 * dipilih diberi ring lebih besar + flyTo.
 */

// Titik tengah default kira-kira pesisir utara Jawa (mayoritas lokasi KNMP).
const DEFAULT_CENTER: [number, number] = [-6.9, 111.5];

/**
 * Leaflet menulis warna sebagai atribut SVG — tidak paham `var()`, jadi token
 * di-resolve sekali ke nilai literal via getComputedStyle (aman: client-only).
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

/** Warna pin opsional per-id (mis. status submit di dashboard) — menimpa warna
 *  default per LocationStatus. Token CSS var, di-resolve client-side. */
const TONE_TOKEN: Record<"success" | "warning" | "danger" | "neutral", string> = {
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  neutral: "--color-ink-faint",
};

export interface PetaMapProps {
  markers: PetaMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Timpa warna pin per-id dengan tone (dashboard: status submit). */
  toneById?: Record<string, "success" | "warning" | "danger" | "neutral">;
}

export function PetaMap({ markers, selectedId, onSelect, toneById }: PetaMapProps) {
  const tokenColor = useTokenColor();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Inisialisasi peta sekali; view awal AUTO-FIT ke seluruh marker (bukan
  // hardcode Jawa) — lokasi baru di NTB/luar Jawa langsung terlihat.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true });
    if (markers.length > 1) {
      map.fitBounds(L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number])), {
        padding: [28, 28],
        maxZoom: 11,
      });
    } else if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lng], 10);
    } else {
      map.setView(DEFAULT_CENTER, 7);
    }
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // markers hanya untuk view awal — pembaruan berikutnya lewat effect marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set marker BERUBAH (filter/tambah lokasi) & tak ada seleksi → refit bounds
  // supaya sebaran baru (mis. NTB muncul) selalu masuk viewport.
  const markersKey = useMemo(
    () =>
      markers
        .map((m) => m.id)
        .sort()
        .join(","),
    [markers],
  );
  const prevKeyRef = useRef(markersKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || prevKeyRef.current === markersKey) return;
    prevKeyRef.current = markersKey;
    if (selectedId || markers.length === 0) return;
    if (markers.length === 1) {
      map.flyTo([markers[0].lat, markers[0].lng], 10, { duration: 0.6 });
    } else {
      map.flyToBounds(L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number])), {
        padding: [28, 28],
        maxZoom: 11,
        duration: 0.6,
      });
    }
  }, [markersKey, markers, selectedId]);

  // Gambar ulang marker saat data/seleksi berubah.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const statusColor = (status: LocationStatus) => tokenColor(statusColorToken(status));
    for (const m of markers) {
      const active = selectedId === m.id;
      const tone = toneById?.[m.id];
      const fill = tone ? tokenColor(TONE_TOKEN[tone]) : statusColor(m.status);
      const marker = L.circleMarker([m.lat, m.lng], {
        radius: active ? 11 : 7,
        color: active ? tokenColor("--color-primary") : tokenColor("--color-surface"),
        weight: active ? 3 : 1.2,
        fillColor: fill,
        fillOpacity: 0.92,
      });
      marker.bindTooltip(
        `<span style="font-size:12px;font-weight:600">${m.name}</span><br/><span style="font-size:11px">${m.regency} · ${m.province}</span>`,
        { direction: "top", offset: L.point(0, -6) },
      );
      marker.on("click", () => onSelectRef.current(m.id));
      marker.addTo(layer);
    }
  }, [markers, selectedId, tokenColor, toneById]);

  // Terbang ke lokasi terpilih.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const m = markers.find((x) => x.id === selectedId);
    if (m) map.flyTo([m.lat, m.lng], 12, { duration: 0.8 });
  }, [selectedId, markers]);

  return <div ref={containerRef} className="h-full w-full" />;
}
