"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, List, Map as MapIcon, Maximize2, Minimize2, X } from "lucide-react";
import type { PetaMarker } from "@/lib/peta";
import { cocokFilter, type FilterPeta, type MarkerTone, type StatusLapor } from "@/lib/dashboard-filter";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import { StatusPill } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { cn } from "@/lib/cn";

// Leaflet client-only (sama seperti /proyek/peta) — hindari SSR.
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

const LABEL_LAPOR: Record<StatusLapor, string> = {
  sudah: "Sudah lapor hari ini",
  belum: "Belum lapor hari ini",
  belum_mulai: "Belum mulai (lokasi target)",
};

/**
 * PETA MONITORING OPERASIONAL (Master Prompt §5 — "peta tidak boleh menjadi
 * background dekoratif").
 *
 * Tiga perubahan yang membuatnya bisa dipakai bekerja, bukan cuma dilihat:
 *
 * 1. MENGETUK MARKER MEMBUKA PANEL, BUKAN PINDAH HALAMAN. Sebelumnya sekali
 *    ketuk langsung melempar ke workspace lokasi — petanya hilang, dan untuk
 *    memeriksa lokasi kedua pengguna harus kembali lalu mencari pin-nya lagi.
 *    Membandingkan beberapa lokasi jadi mustahil, padahal justru itu gunanya
 *    melihat peta. Sekarang panel merangkum lokasi itu dan menyediakan tautan
 *    eksplisit ke workspace-nya.
 * 2. PETA/DAFTAR di layar sempit. Peta 300px di ponsel terlalu kecil untuk
 *    memilih pin dengan jempol; daftar memberi jalan yang sama tanpa menebak.
 * 3. LAYAR PENUH untuk desktop — 83 lokasi di kotak sepertiga layar berarti
 *    pin bertumpuk dan tak terpisahkan.
 */
export function DashboardMap({
  markers,
  markerTone,
  markerSubmit,
  deviationById,
}: {
  markers: PetaMarker[];
  markerTone: Record<string, MarkerTone>;
  markerSubmit: Record<string, StatusLapor>;
  /** Deviasi per lokasi (pp) untuk panel detail; `undefined` = belum ada baseline. */
  deviationById?: Record<string, number>;
}) {
  const [filter, setFilter] = useState<FilterPeta>("semua");
  const [selected, setSelected] = useState<string | null>(null);
  const [tampilan, setTampilan] = useState<"peta" | "daftar">("peta");
  const [penuh, setPenuh] = useState(false);

  // Esc menutup layar penuh — pintu keluar yang sama dengan dialog lain di
  // aplikasi ini, jadi tidak perlu dipelajari ulang.
  useEffect(() => {
    if (!penuh) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPenuh(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [penuh]);

  const shown = useMemo(() => {
    if (filter === "semua") return markers;
    return markers.filter((m) => cocokFilter(filter, markerTone[m.id]!, markerSubmit[m.id]!));
  }, [markers, markerTone, markerSubmit, filter]);

  // Pilihan yang tersaring keluar tidak boleh menyisakan panel menggantung
  // yang menunjuk pin yang sudah tidak terlihat.
  const terpilih = selected && shown.some((m) => m.id === selected)
    ? (markers.find((m) => m.id === selected) ?? null)
    : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        penuh
          ? "bg-surface fixed inset-0 z-[1200] p-4"
          : "h-full",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              filter === f.key
                ? "bg-primary text-white"
                : "bg-surface-inset text-ink-muted hover:bg-surface-muted",
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="text-[11px] text-ink-muted">
          {shown.length} dari {markers.length} lokasi
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Peta/Daftar hanya relevan di layar sempit; di desktop keduanya muat. */}
          <div className="flex overflow-hidden rounded-md border border-border lg:hidden">
            <button
              type="button"
              onClick={() => setTampilan("peta")}
              aria-pressed={tampilan === "peta"}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 text-xs font-medium",
                tampilan === "peta" ? "bg-primary text-white" : "text-ink-muted",
              )}
            >
              <MapIcon aria-hidden className="size-3.5" /> Peta
            </button>
            <button
              type="button"
              onClick={() => setTampilan("daftar")}
              aria-pressed={tampilan === "daftar"}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 text-xs font-medium",
                tampilan === "daftar" ? "bg-primary text-white" : "text-ink-muted",
              )}
            >
              <List aria-hidden className="size-3.5" /> Daftar
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPenuh((v) => !v)}
            aria-label={penuh ? "Keluar dari layar penuh" : "Peta layar penuh"}
            className="hidden size-7 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-muted hover:text-ink lg:flex"
          >
            {penuh ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
          </button>
        </div>
      </div>

      <div className="flex min-h-[300px] flex-1 gap-3">
        <div
          className={cn(
            "relative flex-1 overflow-hidden rounded-lg border border-border",
            tampilan === "daftar" ? "max-lg:hidden" : "",
          )}
        >
          <PetaMap
            markers={shown}
            selectedId={selected}
            toneById={markerTone}
            onSelect={(id) => setSelected(id)}
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

        {/* Daftar = pasangan peta, bukan penggantinya. Di desktop ia muncul
            hanya saat layar penuh (ruangnya cukup); di ponsel ia menggantikan
            peta lewat toggle di atas. */}
        <div
          className={cn(
            "w-full shrink-0 overflow-y-auto rounded-lg border border-border lg:w-80",
            tampilan === "peta" ? "max-lg:hidden" : "",
            penuh ? "" : "lg:hidden",
          )}
        >
          <DaftarLokasi
            markers={shown}
            tone={markerTone}
            lapor={markerSubmit}
            deviationById={deviationById}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      </div>

      {terpilih ? (
        <PanelLokasi
          m={terpilih}
          lapor={markerSubmit[terpilih.id]}
          deviasi={deviationById?.[terpilih.id]}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function DaftarLokasi({
  markers,
  tone,
  lapor,
  deviationById,
  selected,
  onSelect,
}: {
  markers: PetaMarker[];
  tone: Record<string, MarkerTone>;
  lapor: Record<string, StatusLapor>;
  deviationById?: Record<string, number>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const DOT: Record<MarkerTone, string> = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    neutral: "bg-ink-faint",
    idle: "border border-ink-faint bg-surface",
  };

  if (markers.length === 0) {
    return (
      <p className="p-4 text-[12.5px] text-ink-muted">
        Tidak ada lokasi yang cocok dengan penyaring ini.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {markers.map((m) => {
        const dev = deviationById?.[m.id];
        return (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onSelect(m.id)}
              aria-current={selected === m.id ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                selected === m.id ? "bg-primary-50" : "hover:bg-surface-muted",
              )}
            >
              <span className={cn("size-2.5 shrink-0 rounded-full", DOT[tone[m.id] ?? "neutral"])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{m.name}</span>
                <span className="block truncate text-[11px] text-ink-muted">{m.regency}</span>
              </span>
              {dev != null ? <DeltaBadge value={dev} /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Panel detail marker. Menjawab pertanyaan yang membuat orang mengetuk pin:
 * lokasi apa, paket mana, sudah lapor belum, seberapa menyimpang — lalu
 * menyediakan satu jalan eksplisit ke workspace-nya.
 */
function PanelLokasi({
  m,
  lapor,
  deviasi,
  onClose,
}: {
  m: PetaMarker;
  lapor: StatusLapor | undefined;
  deviasi: number | undefined;
  onClose: () => void;
}) {
  return (
    <aside className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-ink">{m.name}</h3>
            <StatusPill
              tone={LOCATION_STATUS_TONE[m.status]}
              label={LOCATION_STATUS_LABEL[m.status]}
            />
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
            {m.village}, {m.regency} — {m.province}
          </p>
          <p className="truncate text-[11.5px] text-ink-muted">{m.packageName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup panel lokasi"
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
        <div className="flex items-center gap-1.5">
          <dt className="text-ink-muted">Lapor hari ini:</dt>
          <dd className="font-medium text-ink">{lapor ? LABEL_LAPOR[lapor] : "—"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-ink-muted">Deviasi:</dt>
          <dd>
            {/* `undefined` TIDAK dijadikan 0: lokasi tanpa baseline belum punya
                pembanding, dan menampilkannya sebagai 0% terbaca "tepat
                rencana" padahal artinya "belum diketahui". */}
            {deviasi != null ? (
              <DeltaBadge value={deviasi} />
            ) : (
              <span className="text-ink-faint">belum ada baseline</span>
            )}
          </dd>
        </div>
      </dl>

      <Link
        href={`/proyek/lokasi/${m.slug}`}
        className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
      >
        Buka workspace lokasi <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </aside>
  );
}
