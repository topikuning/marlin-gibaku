"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { PetaMarker } from "@/lib/peta";
import type { MarkerTone } from "@/lib/dashboard";

// Leaflet client-only (sama seperti /peta) — hindari SSR.
const PetaMap = dynamic(() => import("../peta/peta-map").then((m) => m.PetaMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-md bg-surface-inset" />,
});

type Filter = "semua" | "submit" | "belum" | "kritis";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "submit", label: "Sudah Submit" },
  { key: "belum", label: "Belum Submit" },
  { key: "kritis", label: "Kritis" },
];

const LEGEND: { tone: MarkerTone; label: string; dot: string }[] = [
  { tone: "success", label: "Sudah submit & on track", dot: "bg-success" },
  { tone: "warning", label: "Sudah submit, perlu perhatian", dot: "bg-warning" },
  { tone: "danger", label: "Deviasi negatif / kendala kritis", dot: "bg-danger" },
  { tone: "neutral", label: "Belum submit hari ini", dot: "bg-ink-faint" },
];

export function DashboardMap({
  markers,
  markerTone,
}: {
  markers: PetaMarker[];
  markerTone: Record<string, MarkerTone>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("semua");
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (filter === "semua") return markers;
    return markers.filter((m) => {
      const t = markerTone[m.id];
      if (filter === "belum") return t === "neutral";
      if (filter === "submit") return t && t !== "neutral";
      if (filter === "kritis") return t === "danger";
      return true;
    });
  }, [markers, markerTone, filter]);

  const slugById = useMemo(() => new Map(markers.map((m) => [m.id, m.slug])), [markers]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "bg-primary text-white"
                : "bg-surface-inset text-ink-muted hover:bg-surface-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-lg border border-border">
        <PetaMap
          markers={shown}
          selectedId={selected}
          toneById={markerTone}
          onSelect={(id) => {
            setSelected(id);
            const slug = slugById.get(id);
            if (slug) router.push(`/lokasi/${slug}`);
          }}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] max-w-[15rem] rounded-md border border-border bg-surface/95 p-2.5 text-[11px] shadow-sm">
          <ul className="space-y-1">
            {LEGEND.map((l) => (
              <li key={l.tone} className="flex items-center gap-2">
                <span className={`size-2.5 shrink-0 rounded-full ${l.dot}`} />
                <span className="text-ink-muted">{l.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
