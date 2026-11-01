"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { MapPin, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { Button, Lapisan } from "@/components/ui";
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
 *
 * SASARAN SENTUH (DECISIONS 730). Keluhan user 2026-11-01: *"apa menurutmu ini
 * tidak super terlalu kecil? kamu gak mikir ux di mobile"*. Dulu tombol hapus
 * dan "kembalikan" ditempel di pojok thumbnail 56 px, ±22 px, berdempetan
 * dengan area "buka foto". Kini:
 * - kisi: seluruh thumbnail SATU sasaran (buka foto); hapus/putar/kembalikan
 *   ada di tampilan foto besar sebagai tombol berlabel setinggi 44 px;
 * - `tataLetak="baris"`: untuk panel yang tugasnya memang aksi (foto yatim) –
 *   tiap foto satu baris dengan tombol berlabel 44 px di sampingnya.
 */
export function PhotoGallery({
  photos,
  thumbClass = "h-20 w-20",
  canDelete = false,
  deletableIds,
  deleteAction,
  reuse,
  rotateAction,
  tataLetak = "kisi",
}: {
  photos: PhotoView[];
  thumbClass?: string;
  /** Tampilkan tombol hapus per foto (butuh deleteAction). */
  canDelete?: boolean;
  /**
   * Bila diisi, tombol hapus HANYA untuk foto dengan id di sini – dipakai foto
   * susulan, yang boleh dihapus pengunggahnya sendiri tapi tidak orang lain
   * (DECISIONS 696). Server tetap penegaknya.
   */
  deletableIds?: string[];
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
  /**
   * "kisi" (bawaan): thumbnail berjajar, aksi di tampilan foto besar.
   * "baris": tiap foto satu baris dengan tombol aksi berlabel di sampingnya.
   */
  tataLetak?: "kisi" | "baris";
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const removable = canDelete && !!deleteAction;
  const bolehHapus = (id: string) => removable && (!deletableIds || deletableIds.includes(id));

  const del = (photoId: string) => {
    if (typeof window !== "undefined" && !window.confirm("Hapus foto ini? Tidak bisa dibatalkan.")) return;
    const fd = new FormData();
    fd.set("photoId", photoId);
    startTransition(async () => {
      const hasil = await deleteAction?.(undefined, fd);
      // Penolakan server harus terbaca – tanpa ini tombolnya tampak tidak bekerja.
      if (hasil?.error && typeof window !== "undefined") window.alert(hasil.error);
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
  const adaAksi = !!rotateAction || !!reuse || shown.some((p) => bolehHapus(p.id));

  return (
    <>
      {tataLetak === "baris" ? (
        <ul className="space-y-3">
          {shown.map((p, i) => (
            <li key={p.id} className="flex items-center gap-3">
              <Thumb p={p} className="h-24 w-24 shrink-0" onOpen={() => setOpen(i)} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {reuse ? (
                  <Button
                    className="h-auto min-h-11 w-full py-1.5 leading-snug whitespace-normal"
                    disabled={pending}
                    onClick={() => pakaiLagi(p.id)}
                  >
                    <Undo2 aria-hidden className="size-4 shrink-0" />
                    {reuse.label}
                  </Button>
                ) : null}
                {bolehHapus(p.id) ? (
                  <Button
                    variant="secondary"
                    className="h-auto min-h-11 w-full py-1.5"
                    disabled={pending}
                    onClick={() => del(p.id)}
                  >
                    <Trash2 aria-hidden className="size-4 shrink-0" />
                    Hapus
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {shown.map((p, i) => (
              <Thumb key={p.id} p={p} className={thumbClass} onOpen={() => setOpen(i)} />
            ))}
          </div>
          {adaAksi ? (
            <p className="mt-1 text-[11px] text-ink-muted">
              Ketuk foto untuk {[rotateAction ? "memutar" : null, reuse ? "memakainya lagi" : null, removable ? "menghapus" : null]
                .filter(Boolean)
                .join(" atau ")}
              .
            </p>
          ) : null}
        </>
      )}

      {active && (
        <Lapisan
          lapis="penampil"
          className="flex items-center justify-center bg-black/80 p-4"
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

            {/* Aksi di tampilan besar: berlabel dan setinggi 44 px – fotonya
                terlihat jelas sebelum dihapus atau dipindah (DECISIONS 730). */}
            {active && (rotateAction || reuse || bolehHapus(active.id)) ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {reuse ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => pakaiLagi(active.id)}
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white shadow disabled:opacity-60"
                  >
                    <Undo2 aria-hidden className="size-4" />
                    {reuse.label}
                  </button>
                ) : null}
                {rotateAction ? (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => putar(active.id, "kiri")}
                      className="inline-flex h-11 items-center gap-2 rounded-md bg-white/95 px-4 text-sm font-medium text-slate-700 shadow disabled:opacity-60"
                    >
                      <RotateCcw aria-hidden className="size-4" />
                      Putar kiri
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => putar(active.id, "kanan")}
                      className="inline-flex h-11 items-center gap-2 rounded-md bg-white/95 px-4 text-sm font-medium text-slate-700 shadow disabled:opacity-60"
                    >
                      <RotateCw aria-hidden className="size-4" />
                      Putar kanan
                    </button>
                  </>
                ) : null}
                {bolehHapus(active.id) ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => del(active.id)}
                    className="ml-auto inline-flex h-11 items-center gap-2 rounded-md bg-danger px-4 text-sm font-medium text-white shadow disabled:opacity-60"
                  >
                    <Trash2 aria-hidden className="size-4" />
                    Hapus foto
                  </button>
                ) : null}
              </div>
            ) : null}
            {rotateAction ? (
              <p className="mt-1 text-[11px] text-white/70">
                Putar: cap dibuat ulang dari foto asli. Waktu dan koordinatnya tetap sama.
              </p>
            ) : null}

            <button
              type="button"
              onClick={close}
              className="absolute -top-3 -right-3 grid h-11 w-11 place-items-center rounded-full bg-white text-slate-700 shadow"
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
        </Lapisan>
      )}
    </>
  );
}

function NavBtn({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-800 shadow ${
        side === "left" ? "left-2" : "right-2"
      }`}
      aria-label={side === "left" ? "Sebelumnya" : "Berikutnya"}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

/** Satu thumbnail = satu sasaran sentuh: buka foto besar. Tanda GPS hanya penanda. */
function Thumb({ p, className, onOpen }: { p: PhotoView; className: string; onOpen: () => void }) {
  return (
    <div className={`group relative overflow-hidden rounded-md border border-border ${className}`}>
      <button type="button" onClick={onOpen} className="block h-full w-full" aria-label="Buka foto">
        {/* eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara, bukan asset Next */}
        <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
      </button>
      {p.lat != null && (
        <span className="pointer-events-none absolute right-0 bottom-0 grid place-items-center rounded-tl bg-primary/85 p-0.5">
          <MapPin aria-hidden className="size-3 text-white" />
        </span>
      )}
    </div>
  );
}
