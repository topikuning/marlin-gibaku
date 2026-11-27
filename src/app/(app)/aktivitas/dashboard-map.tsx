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
  { tone: "success", label: "Sesuai jadwal", dot: "size-2.5 bg-success" },
  { tone: "warning", label: "Terlambat", dot: "size-2.5 bg-warning" },
  { tone: "danger", label: "Kritis (deviasi < −10%)", dot: "size-2.5 bg-danger" },
  { tone: "neutral", label: "Belum ada angka", dot: "size-2.5 bg-ink-faint" },
  { tone: "idle", label: "Belum mulai", dot: "size-2 bg-ink-faint/50" },
];

// Sama dengan penanda di peta (799): sudah lapor = lingkaran cahaya lembut,
// belum lapor = cincin abu tipis berjarak. Titiknya abu supaya tidak terbaca
// sebagai salah satu warna kondisi.
const LEGENDA_CINCIN: { key: string; label: string; dot: string }[] = [
  { key: "sudah", label: "Sudah lapor", dot: "size-2.5 bg-ink-faint ring-4 ring-ink-faint/30" },
  { key: "belum", label: "Belum lapor", dot: "size-2.5 bg-ink-faint ring-[1.5px] ring-ink-muted/75 ring-offset-2 ring-offset-surface" },
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
      </div>

      {/*
        LEGENDA DI BAWAH PETA, TIDAK PERNAH MENUMPANG – teguran user
        2026-11-27 (DECISIONS 799): *"keterangan itu menutupi informasi
        utamanya"*. Kotak legenda di pojok kiri-bawah menutup titik-titik
        Jawa–Bali, tempat sebagian besar lokasi berada. Sekarang satu baris
        chip ringkas di luar peta, di semua ukuran layar (di HP sudah begitu
        sejak 2026-09-06).
      */}
      <Legenda />
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 font-medium text-ink">Kondisi</span>
        {LEGENDA_WARNA.map((l) => (
          <Chip key={l.tone} dot={l.dot} label={l.label} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 font-medium text-ink">Laporan hari ini</span>
        {LEGENDA_CINCIN.map((l) => (
          <Chip key={l.key} dot={l.dot} label={l.label} />
        ))}
      </div>
    </div>
  );
}

function Chip({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5">
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <span className={`rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}
