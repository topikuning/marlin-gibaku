"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { PetaMarker } from "@/lib/peta";
import type { SumberPeta } from "@/lib/peta/gaya";
import { cocokFilter, type FilterPeta, type MarkerTone, type StatusLapor } from "@/lib/dashboard-filter";

// MapLibre butuh window/WebGL → client-only (sama seperti /peta).
const PetaMap = dynamic(() => import("../peta/peta-map").then((m) => m.PetaMap), {
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
  sumber,
}: {
  markers: PetaMarker[];
  markerTone: Record<string, MarkerTone>;
  markerSubmit: Record<string, StatusLapor>;
  sumber: SumberPeta;
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
          sumber={sumber}
          markers={shown}
          selectedId={selected}
          toneById={markerTone}
          onSelect={(id) => {
            setSelected(id);
            const slug = slugById.get(id);
            if (slug) router.push(`/lokasi/${slug}`);
          }}
        />
        {/*
          LEGENDA MENUMPANG PETA HANYA DI LAYAR LEBAR.
          Di HP kotak ini menutup separuh peta — teguran user 2026-09-06:
          *"peta di dashboard di tampilan mobile jadi seperti tidak berguna
          karena tertutup legend"*. Benar: lebarnya 15rem di atas peta selebar
          ±20rem, jadi yang tersisa cuma pinggirannya. Di HP legendanya turun ke
          bawah peta (lihat di luar kotak ini).
        */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] hidden max-w-[15rem] rounded-md border border-border bg-surface/95 p-2.5 text-[11px] shadow-sm sm:block">
          <Legenda />
        </div>
      </div>

      {/* Legenda versi HP: di BAWAH peta, tidak menutupi apa pun. */}
      <div className="text-[11px] sm:hidden">
        <Legenda />
      </div>
    </div>
  );
}

function Legenda() {
  return (
    <ul className="space-y-1">
      {LEGEND.map((l) => (
        <li key={l.tone} className="flex items-center gap-2">
          <span className={`size-2.5 shrink-0 rounded-full ${l.dot}`} />
          <span className="text-ink-muted">{l.label}</span>
        </li>
      ))}
    </ul>
  );
}
