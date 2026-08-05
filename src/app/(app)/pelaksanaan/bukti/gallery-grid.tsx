"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, X } from "lucide-react";
import { StatusPill } from "@/components/ui";
import { PHOTO_STATUS_LABEL, PHOTO_STATUS_TONE } from "@/lib/photo-status";
import type { GalleryGroup, GalleryPhoto } from "@/lib/photos-gallery";

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

/**
 * Tiga keadaan, bukan dua (DECISIONS 197). Dulu foto ber-koordinat cadangan
 * titik proyek ikut berlabel "GPS ✓" — pembaca menyangka posisinya terbukti
 * dari fotonya sendiri, padahal itu koordinat dari database.
 */
function gpsLabel(p: GalleryPhoto): string {
  if (p.hasGps) return "GPS ✓";
  return p.gpsFromProject ? "GPS titik proyek" : "Tanpa GPS";
}
function gpsTone(p: GalleryPhoto): string {
  return p.hasGps ? "text-success" : p.gpsFromProject ? "text-ink-faint" : "text-warning";
}

/**
 * Galeri foto: kartu dikelompokkan per tanggal + lightbox in-page. Thumbnail
 * pakai URL presigned (ringan); full dibuka saat diklik. Klik lokasi → workspace.
 */
export function GalleryGrid({ groups, canRestamp = false }: { groups: GalleryGroup[]; canRestamp?: boolean }) {
  const flat = useMemo(() => groups.flatMap((g) => g.photos), [groups]);
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const go = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + flat.length) % flat.length)), [flat.length]);

  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  const active = open != null ? flat[open] : null;
  const indexOf = (p: GalleryPhoto) => flat.indexOf(p);

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-ink">{g.label}</h3>
            <span className="text-xs text-ink-muted">{g.sublabel}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {g.photos.map((p) => (
              <article
                key={p.id}
                className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <button type="button" onClick={() => setOpen(indexOf(p))} className="relative block h-36 w-full overflow-hidden bg-surface-inset">
                  {p.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
                    <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : null}
                  <span className="absolute right-2 top-2">
                    <StatusPill tone={PHOTO_STATUS_TONE[p.status]} label={PHOTO_STATUS_LABEL[p.status]} />
                  </span>
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white tabular">
                    {p.timeLabel}
                  </span>
                </button>
                <div className="p-2.5">
                  <strong className="block truncate text-xs font-semibold text-ink">{p.title}</strong>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {p.locationName} · {p.sourceLabel}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-ink-faint">
                    <span className="truncate">{p.reporterName}</span>
                    <span className={gpsTone(p)}>{gpsLabel(p)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {active ? (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-4" onClick={close} role="dialog" aria-modal="true">
          <div className="relative flex max-h-full max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara */}
            <img src={active.fullUrl ?? active.thumbUrl} alt="" className="max-h-[80vh] w-auto rounded-lg object-contain" />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">{active.title}</span>
              {active.locationSlug ? (
                <Link href={`/proyek/lokasi/${active.locationSlug}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <MapPin aria-hidden className="size-3" />
                  {active.locationName}
                </Link>
              ) : (
                <span>{active.locationName}</span>
              )}
              <span>{active.reporterName}</span>
              <span>{dateFmt.format(new Date(active.takenAtIso))}</span>
              <span className={active.hasGps ? "text-emerald-600" : "text-amber-600"}>{gpsLabel(active)}</span>
              {active.hasOriginal ? (
                <a href={`/api/foto-asli/${active.id}`} className="text-primary hover:underline">
                  Unduh foto asli (tanpa cap)
                </a>
              ) : (
                <span className="text-slate-400">Foto asli tidak diarsipkan</span>
              )}
              {canRestamp && active.hasOriginal ? (
                <Link href={`/pelaksanaan/bukti/${active.id}/cap`} className="text-primary hover:underline">
                  Perbaiki cap →
                </Link>
              ) : null}
              <span className="ml-auto text-slate-400">
                {open! + 1} / {flat.length}
              </span>
            </div>
            <button type="button" onClick={close} className="absolute -right-3 -top-3 grid size-8 place-items-center rounded-full bg-white text-slate-700 shadow" aria-label="Tutup">
              <X aria-hidden className="size-4" />
            </button>
            {flat.length > 1 ? (
              <>
                <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-800 shadow" aria-label="Sebelumnya">
                  ‹
                </button>
                <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-800 shadow" aria-label="Berikutnya">
                  ›
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
