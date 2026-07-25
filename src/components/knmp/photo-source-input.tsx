"use client";

import { useRef, useState } from "react";
import { Camera, Images } from "lucide-react";

/**
 * Input foto sadar-sumber (Kamera vs Galeri) untuk kontrol tagging lokasi:
 * - Kamera → merekam GPS real-time perangkat + waktu sekarang (foto baru di lokasi).
 * - Galeri → server MENGUTAMAKAN EXIF asli foto; bila tak ada GPS di EXIF, pakai
 *   cadangan `galleryFallback` ("project" = titik lokasi proyek, "none" = tanpa tag).
 *   GPS perangkat saat upload TIDAK dikirim untuk galeri (hindari salah tag saat batch).
 *
 * Mengirim hidden field: photoSource, galleryFallback, photoTakenAt, dan koordinat
 * perangkat (nama field bisa diatur via latName/lngName). Dua input file berbagi
 * name "photos"; input yang tak dipakai dikosongkan saat memilih.
 */
export function PhotoSourceInput({
  latName = "gpsLat",
  lngName = "gpsLng",
  onPicked,
  compact = false,
}: {
  latName?: string;
  lngName?: string;
  /** Dipanggil setelah file dipilih (untuk auto-submit). */
  onPicked?: () => void;
  /** true → sembunyikan pratinjau (mode inline auto-submit). */
  compact?: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<"camera" | "gallery">("camera");
  const [fallback, setFallback] = useState<"project" | "none">("project");
  const [takenAt, setTakenAt] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);

  const clearGps = () => {
    if (latRef.current) latRef.current.value = "";
    if (lngRef.current) lngRef.current.value = "";
  };
  const makePreviews = (files: FileList) => {
    if (compact) return;
    const urls: string[] = [];
    for (let i = 0; i < Math.min(files.length, 6); i++) urls.push(URL.createObjectURL(files[i]));
    setPreviews(urls);
  };

  const pickCamera = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (galRef.current) galRef.current.value = "";
    setSource("camera");
    setTakenAt(new Date().toISOString());
    makePreviews(files);
    clearGps();
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (latRef.current) latRef.current.value = String(pos.coords.latitude);
          if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
          onPicked?.();
        },
        () => onPicked?.(),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    } else {
      onPicked?.();
    }
  };

  const pickGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (camRef.current) camRef.current.value = "";
    clearGps(); // galeri: JANGAN kirim GPS perangkat
    setSource("gallery");
    setTakenAt(new Date().toISOString());
    makePreviews(files);
    onPicked?.();
  };

  const btn =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted";

  return (
    <div className="space-y-2">
      <input type="hidden" name="photoSource" value={source} />
      <input type="hidden" name="galleryFallback" value={fallback} />
      <input type="hidden" name="photoTakenAt" value={takenAt} />
      <input ref={latRef} type="hidden" name={latName} defaultValue="" />
      <input ref={lngRef} type="hidden" name={lngName} defaultValue="" />

      <div className="flex flex-wrap gap-2">
        <label className={btn}>
          <Camera aria-hidden className="size-4" /> Kamera
          <input
            ref={camRef}
            type="file"
            name="photos"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            onChange={pickCamera}
          />
        </label>
        <label className={btn}>
          <Images aria-hidden className="size-4" /> Galeri
          <input
            ref={galRef}
            type="file"
            name="photos"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={pickGallery}
          />
        </label>
      </div>

      <label className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <span>Foto galeri tanpa GPS →</span>
        <select
          value={fallback}
          onChange={(e) => setFallback(e.target.value === "none" ? "none" : "project")}
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-ink"
        >
          <option value="project">pakai titik lokasi proyek</option>
          <option value="none">tanpa tag lokasi</option>
        </select>
      </label>

      {!compact && previews.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {previews.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal (objectURL) sebelum unggah
            <img key={i} src={src} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
