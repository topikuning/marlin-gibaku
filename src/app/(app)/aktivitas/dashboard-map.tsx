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
  { key: "submit", label: "Sudah lapor" },
  { key: "belum", label: "Belum lapor" },
  { key: "kritis", label: "Kritis" },
];

/*
 * DUA FAKTA, DUA TANDA (DECISIONS 770) – keluhan user 2026-11-15: *"permainan
 * warna ini membingungkan. seharusnya warna utama adalah terhadap proyek itu
 * sendiri, baru lingkaran diluarnya itu mencerminkan sudah lapor atau belum"*.
 * Warna isi = kondisi proyek; cincin = laporan hari ini. Legendanya pun dua
 * kelompok, supaya tidak ada lagi label "lapor atau belum".
 */
const LEGENDA_WARNA: { tone: MarkerTone; label: string; dot: string }[] = [
  { tone: "success", label: "Sesuai jadwal", dot: "size-3 bg-success" },
  { tone: "warning", label: "Terlambat", dot: "size-3 bg-warning" },
  { tone: "danger", label: "Kritis (deviasi di bawah −10%)", dot: "size-3 bg-danger" },
  { tone: "neutral", label: "Belum ada angka progres", dot: "size-3 bg-ink-faint" },
  { tone: "idle", label: "Belum mulai", dot: "size-2 bg-ink-faint/50" },
];

// Cincin digambar KOSONG di legenda: isi abu di sini akan terbaca "belum ada
// angka progres" dari kelompok warna.
const LEGENDA_CINCIN: { key: string; label: string; dot: string }[] = [
  { key: "sudah", label: "Sudah lapor", dot: "border border-ink-faint" },
  { key: "belum", label: "Belum lapor", dot: "border-[3px] border-ink" },
];

export function DashboardMap({
  markers,
  markerTone,
  markerSubmit,
  sumber,
  kelompokAwal,
}: {
  markers: PetaMarker[];
  markerTone: Record<string, MarkerTone>;
  markerSubmit: Record<string, StatusLapor>;
  sumber: SumberPeta;
  /** Bawaan pengelompokan penanda, dari setelan Sistem. */
  kelompokAwal: boolean;
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
          kelompokAwal={kelompokAwal}
          markers={shown}
          selectedId={selected}
          toneById={markerTone}
          laporById={markerSubmit}
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
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] hidden rounded-md border border-border bg-surface/95 p-2.5 text-[11px] shadow-sm sm:block">
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
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      <div>
        <p className="mb-1 font-medium text-ink">Warna: kondisi proyek</p>
        <ul className="space-y-1">
          {LEGENDA_WARNA.map((l) => (
            <li key={l.tone} className="flex items-center gap-2">
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                <span className={`rounded-full ${l.dot}`} />
              </span>
              <span className="text-ink-muted">{l.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 font-medium text-ink">Cincin: laporan hari ini</p>
        <ul className="space-y-1">
          {LEGENDA_CINCIN.map((l) => (
            <li key={l.key} className="flex items-center gap-2">
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                <span className={`size-3.5 rounded-full ${l.dot}`} />
              </span>
              <span className="text-ink-muted">{l.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
