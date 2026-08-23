"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { MapPin, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import type { PhotoView } from "@/lib/photos";

type PhotoDeleteAction = (prev: undefined, fd: FormData) => Promise<{ error?: string } | undefined>;

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
  canDelete = false,
  deleteAction,
  reuse,
  rotateAction,
}: {
  photos: PhotoView[];
  thumbClass?: string;
  /** Tampilkan tombol hapus per foto (butuh deleteAction). */
  canDelete?: boolean;
  deleteAction?: PhotoDeleteAction;
  /**
   * Aksi kedua per foto — dipakai foto YATIM: "pakai lagi".
   *
   * Tanpa ini, satu-satunya aksi pada foto yang pekerjaannya terhapus adalah
   * HAPUS. Padahal fotonya bukti yang koordinat & waktunya benar; yang salah
   * cuma pekerjaan yang ditempelinya. Menyuruh membuangnya lalu memotret ulang
   * = menyuruh membuat bukti yang lebih buruk.
   */
  reuse?: { label: string; run: PhotoDeleteAction; confirm?: string };
  /**
   * Tombol PUTAR di lightbox (DECISIONS 424) — jaring pengaman untuk foto yang
   * terlanjur miring. Kamera dalam aplikasi memotret lewat canvas yang tidak
   * punya EXIF, dan sebagian HP melaporkan sudut layarnya keliru sehingga
   * penegakan otomatis meleset. Cap dibakar ulang dari berkas ASLI; tidak ada
   * satu pun nilai cap yang berubah.
   */
  rotateAction?: PhotoDeleteAction;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const removable = canDelete && !!deleteAction;

  const del = (photoId: string) => {
    if (typeof window !== "undefined" && !window.confirm("Hapus foto ini? Tidak bisa dibatalkan.")) return;
    const fd = new FormData();
    fd.set("photoId", photoId);
    startTransition(async () => {
      await deleteAction?.(undefined, fd);
      setOpen(null);
    });
  };

  const putar = (photoId: string, arah: "kiri" | "kanan") => {
    const fd = new FormData();
    fd.set("photoId", photoId);
    fd.set("arah", arah);
    startTransition(async () => {
      await rotateAction?.(undefined, fd);
      // Lightbox ditutup: URL foto berganti (objek R2 baru), jadi gambar di
      // layar sudah bukan yang tersimpan. Menahannya terbuka menampilkan
      // gambar lama yang sudah dihapus.
      setOpen(null);
    });
  };

  const pakaiLagi = (photoId: string) => {
    if (reuse?.confirm && typeof window !== "undefined" && !window.confirm(reuse.confirm)) return;
    const fd = new FormData();
    fd.set("photoId", photoId);
    startTransition(async () => {
      await reuse?.run(undefined, fd);
      setOpen(null);
    });
  };

  const shown = photos.filter((p) => p.thumbUrl);
  const close = useCallback(() => setOpen(null), []);
  const go = useCallback(
    (dir: number) => setOpen((i) => (i == null ? i : (i + dir + shown.length) % shown.length)),
    [shown.length],
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
          <div key={p.id} className={`group relative overflow-hidden rounded-md border border-border ${thumbClass}`}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block h-full w-full"
              aria-label="Buka foto"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara, bukan asset Next */}
              <img
                src={p.thumbUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            </button>
            {p.lat != null && (
              <span className="pointer-events-none absolute right-0 bottom-0 grid place-items-center rounded-tl bg-primary/85 p-0.5">
                <MapPin aria-hidden className="size-3 text-white" />
              </span>
            )}
            {removable && (
              <button
                type="button"
                onClick={() => del(p.id)}
                disabled={pending}
                aria-label="Hapus foto"
                title="Hapus foto"
                className="absolute top-0.5 right-0.5 grid place-items-center rounded bg-danger/90 p-1 text-white hover:bg-danger disabled:opacity-50"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
            )}
            {reuse && (
              <button
                type="button"
                onClick={() => pakaiLagi(p.id)}
                disabled={pending}
                aria-label={reuse.label}
                title={reuse.label}
                className="absolute bottom-0.5 left-0.5 grid place-items-center rounded bg-primary/90 p-1 text-white hover:bg-primary disabled:opacity-50"
              >
                <Undo2 aria-hidden className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative flex max-h-full max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara, bukan asset Next */}
            <img
              src={active.fullUrl ?? active.thumbUrl}
              alt=""
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />

            {/* Tag EXIF */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700">
              <span>{active.takenAt ? takenFmt.format(new Date(active.takenAt)) : "Tanggal tidak tersedia"}</span>
              {active.lat != null && active.lng != null ? (
                <a
                  href={`https://www.google.com/maps?q=${active.lat},${active.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <MapPin aria-hidden className="size-3" />
                  {active.lat.toFixed(5)}, {active.lng.toFixed(5)}
                </a>
              ) : (
                <span className="text-slate-400">Koordinat tidak tersedia</span>
              )}
              <span className="ml-auto text-slate-400">
                {open! + 1} / {shown.length}
              </span>
            </div>

            {rotateAction ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => putar(active.id, "kiri")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow disabled:opacity-60"
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                  Putar kiri
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => putar(active.id, "kanan")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow disabled:opacity-60"
                >
                  <RotateCw aria-hidden className="size-3.5" />
                  Putar kanan
                </button>
                <span className="text-[11px] text-white/70">
                  Cap dibakar ulang dari berkas asli – angkanya tidak berubah.
                </span>
              </div>
            ) : null}

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
      className={`absolute top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-800 shadow ${
        side === "left" ? "left-2" : "right-2"
      }`}
      aria-label={side === "left" ? "Sebelumnya" : "Berikutnya"}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
