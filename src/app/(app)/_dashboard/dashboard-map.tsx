"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { PetaMarker } from "@/lib/peta";
import { cocokFilter, type FilterPeta, type MarkerTone, type StatusLapor } from "@/lib/dashboard-filter";

// Leaflet client-only (sama seperti /peta) — hindari SSR.
const PetaMap = dynamic(() => import("@/app/(app)/proyek/peta/peta-map").then((m) => m.PetaMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-md bg-surface-inset" />,
});

const FILTERS: { key: FilterPeta; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "submit", label: "Sudah Submit" },
  { key: "belum", label: "Belum Submit" },
  { key: "kritis", label: "Kritis" },
];

// Merah sengaja MENANG atas status lapor (keputusan user 2026-08-03), jadi
// labelnya harus mengaku: pin merah tidak berkata apa pun soal sudah/belum
// lapor. Legenda yang menyiratkan sebaliknya membuat orang menghitung pin.
const LEGEND: { tone: MarkerTone; label: string; dot: string }[] = [
  { tone: "success", label: "Sudah lapor & on track", dot: "bg-success" },
  { tone: "warning", label: "Sudah lapor, deviasi negatif", dot: "bg-warning" },
  { tone: "danger", label: "Deviasi kritis (lapor atau belum)", dot: "bg-danger" },
  { tone: "neutral", label: "Belum lapor hari ini", dot: "bg-ink-faint" },
  { tone: "idle", label: "Belum mulai (target)", dot: "border border-ink-faint bg-surface" },
];

export function DashboardMap({
  markers,
  markerTone,
  markerSubmit,
}: {
  markers: PetaMarker[];
  markerTone: Record<string, MarkerTone>;
  markerSubmit: Record<string, StatusLapor>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterPeta>("semua");
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (filter === "semua") return markers;
    return markers.filter((m) => cocokFilter(filter, markerTone[m.id]!, markerSubmit[m.id]!));
  }, [markers, markerTone, markerSubmit, filter]);

  const slugById = useMemo(() => new Map(markers.map((m) => [m.id, m.slug])), [markers]);

  return (
    <div className="flex h-full flex-col gap-3">
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

      <div className="relative min-h-[300px] flex-1 overflow-hidden rounded-lg border border-border">
        <PetaMap
          markers={shown}
          selectedId={selected}
          toneById={markerTone}
          onSelect={(id) => {
            setSelected(id);
            const slug = slugById.get(id);
            if (slug) router.push(`/proyek/lokasi/${slug}`);
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
