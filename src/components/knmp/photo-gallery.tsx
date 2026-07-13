"use client";

import { useCallback, useEffect, useState } from "react";
import type { PhotoView } from "@/lib/photos";

const takenFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

/**
 * Grid thumbnail kecil + lightbox in-page (tidak buka tab baru).
 * Thumbnail pakai gambar kecil (thumbUrl) supaya ringan; full hanya saat dibuka.
 * Menampilkan tag EXIF (tanggal ambil, koordinat) di lightbox.
 */
export function PhotoGallery({
  photos,
  thumbClass = "h-20 w-20",
}: {
  photos: PhotoView[];
  thumbClass?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);

  const shown = photos.filter((p) => p.thumbUrl);
  const close = useCallback(() => setOpen(null), []);
  const go = useCallback(
    (dir: number) =>
      setOpen((i) => (i == null ? i : (i + dir + shown.length) % shown.length)),
    [shown.length]
  );

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

  if (!shown.length) return null;

  const active = open != null ? shown[open] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {shown.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            className={`group relative overflow-hidden rounded-lg border border-[#E2E8F0] ${thumbClass}`}
            aria-label="Buka foto"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.thumbUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            {p.lat != null && (
              <span className="absolute bottom-0 right-0 bg-[#1e3a8a]/85 px-1 py-0.5 text-[9px] font-medium text-white">
                📍
              </span>
            )}
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative flex max-h-full max-w-4xl flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.fullUrl ?? active.thumbUrl}
              alt=""
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />

            {/* Tag EXIF */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700">
              <span>
                📅{" "}
                {active.takenAt
                  ? takenFmt.format(new Date(active.takenAt))
                  : "Tanggal tidak tersedia"}
              </span>
              {active.lat != null && active.lng != null ? (
                <a
                  href={`https://www.google.com/maps?q=${active.lat},${active.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#1e3a8a] hover:underline"
                >
                  📍 {active.lat.toFixed(5)}, {active.lng.toFixed(5)}
                </a>
              ) : (
                <span className="text-slate-400">📍 Koordinat tidak tersedia</span>
              )}
              <span className="ml-auto text-slate-400">
                {open! + 1} / {shown.length}
              </span>
            </div>

            <button
              type="button"
              onClick={close}
              className="absolute -top-3 -right-3 grid h-8 w-8 place-items-center rounded-full bg-white text-slate-700 shadow"
              aria-label="Tutup"
            >
              ✕
            </button>

            {shown.length > 1 && (
              <>
                <NavBtn side="left" onClick={() => go(-1)} />
                <NavBtn side="right" onClick={() => go(1)} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function NavBtn({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-slate-800 shadow ${
        side === "left" ? "left-2" : "right-2"
      }`}
      aria-label={side === "left" ? "Sebelumnya" : "Berikutnya"}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
