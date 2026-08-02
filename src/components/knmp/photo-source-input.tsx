"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Images, MapPin, MapPinOff } from "lucide-react";
import { Combobox } from "@/components/ui";
import { catatIzinPerangkat } from "@/lib/device-permission";

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
 *
 * IZIN LOKASI DIURUS DI DEPAN, BUKAN SAAT RANA DITEKAN (DECISIONS 219).
 * Permintaan user 2026-08-02: "aku perlu agak memaksa ini, karena saat ini
 * kebanyakan foto ditag dengan lokasi default."
 *
 * Sebabnya struktural: dulu GPS baru diminta SESUDAH file dipilih, dan bila
 * user menutup/menolak dialog izin, `onPicked()` tetap jalan — fotonya terunggah
 * tanpa koordinat lalu dicap memakai titik proyek. Dari sisi pelapor tidak ada
 * apa pun yang tampak salah, jadi kebiasaan itu terus berulang.
 *
 * Sekarang: keadaan izin dibaca saat komponen tampil, ditampilkan terang-terangan,
 * dan tombol "Izinkan akses lokasi" memicu dialog SEBELUM memotret. Keadaannya
 * juga dicatat ke server supaya bisa ditelusuri per orang & perangkat.
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
  // "unknown" = belum diperiksa. Nilai awal sengaja BUKAN "prompt": menebak
  // keadaan izin lalu menampilkan peringatan yang salah lebih buruk daripada
  // diam sebentar.
  // Jawaban "sedang di lokasi proyek?" untuk unggahan GALERI (DECISIONS 220).
  // null = belum dijawab → pemilih berkas belum dibuka.
  const [diLokasi, setDiLokasi] = useState<boolean | null>(null);
  const [tanyaLokasi, setTanyaLokasi] = useState(false);
  const [izin, setIzin] = useState<"granted" | "denied" | "prompt" | "unsupported" | "unknown">("unknown");
  const [mintaIzin, setMintaIzin] = useState(false);

  /** Catat ke server; kegagalan mencatat TIDAK boleh menghalangi memotret. */
  const catat = useCallback((state: "granted" | "denied" | "prompt" | "unsupported") => {
    setIzin(state);
    void catatIzinPerangkat({ kind: "geolocation", state }).catch(() => {});
  }, []);

  useEffect(() => {
    let batal = false;
    // Pemeriksaan ditunda ke microtask supaya tidak menyetel state saat render
    // effect berjalan (aturan react-hooks/set-state-in-effect).
    void (async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        if (!batal) catat("unsupported");
        return;
      }
      // Permissions API tidak ada di semua browser (Safari lama). Tanpa itu
      // keadaannya memang tidak diketahui — ditulis apa adanya sebagai
      // "prompt", bukan ditebak "granted".
      if (!navigator.permissions?.query) {
        if (!batal) setIzin("prompt");
        return;
      }
      try {
        const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        if (batal) return;
        catat(st.state as "granted" | "denied" | "prompt");
        st.onchange = () => catat(st.state as "granted" | "denied" | "prompt");
      } catch {
        if (!batal) setIzin("prompt");
      }
    })();
    return () => {
      batal = true;
    };
  }, [catat]);

  /** Picu dialog izin browser. Hanya `getCurrentPosition` yang bisa memunculkannya. */
  const izinkan = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return catat("unsupported");
    setMintaIzin(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMintaIzin(false);
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        catat("granted");
      },
      (err) => {
        setMintaIzin(false);
        catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

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
          catat("granted");
          onPicked?.();
        },
        (err) => {
          // maximumAge 0: JANGAN pakai koordinat basi. Foto yang diambil di
          // lokasi B tidak boleh membawa titik lokasi A yang tersimpan satu
          // menit lalu — itu bukan sekadar tidak akurat, itu keliru.
          catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt");
          onPicked?.();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } else {
      catat("unsupported");
      onPicked?.();
    }
  };

  /**
   * Jawab "sedang di lokasi proyek?" lalu buka pemilih berkas (DECISIONS 220).
   *
   * Kalau YA, posisi perangkat SEKARANG diambil dan dikirim sebagai cadangan —
   * dipakai hanya bila foto tidak punya GPS sendiri. Kalau TIDAK, tidak ada
   * koordinat perangkat yang dikirim sama sekali: mengunggah dari kantor lalu
   * menandai fotonya dengan posisi kantor jauh lebih buruk daripada tidak
   * menandai apa pun.
   */
  const jawabLokasi = (ya: boolean) => {
    setDiLokasi(ya);
    setTanyaLokasi(false);
    setSource("gallery");
    clearGps();
    if (ya && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (latRef.current) latRef.current.value = String(pos.coords.latitude);
          if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
          catat("granted");
          galRef.current?.click();
        },
        (err) => {
          catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt");
          galRef.current?.click();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
      return;
    }
    galRef.current?.click();
  };

  const pickGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (camRef.current) camRef.current.value = "";
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
      <input type="hidden" name="galleryAtSite" value={diLokasi === true ? "1" : ""} />
      <input type="hidden" name="photoTakenAt" value={takenAt} />
      <input ref={latRef} type="hidden" name={latName} defaultValue="" />
      <input ref={lngRef} type="hidden" name={lngName} defaultValue="" />

      {/* Keadaan izin lokasi — disebut TERANG-TERANGAN sebelum memotret.
          Dulu ini diam saja dan fotonya diam-diam dicap titik proyek. */}
      {izin === "granted" ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <MapPin aria-hidden className="size-3.5" /> Izin lokasi aktif — foto kamera akan membawa
          koordinat asli.
        </p>
      ) : izin === "unsupported" ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <MapPinOff aria-hidden className="mt-0.5 size-3.5 shrink-0" /> Perangkat/browser ini tidak
          mendukung GPS. Foto akan dicap memakai titik lokasi proyek, bukan posisi sebenarnya.
        </p>
      ) : izin === "unknown" ? null : (
        <div
          className={`rounded-md border px-3 py-2 ${izin === "denied" ? "border-danger-border bg-danger-soft" : "border-warning-border bg-warning-soft"}`}
        >
          <p className={`text-xs font-medium ${izin === "denied" ? "text-danger" : "text-warning"}`}>
            {izin === "denied"
              ? "Izin lokasi DITOLAK di browser ini"
              : "Izin lokasi belum diberikan"}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tanpa izin, foto dicap memakai <strong>titik lokasi proyek</strong> — bukan posisi
            sebenarnya saat memotret.
            {izin === "denied"
              ? " Buka setelan situs di browser (ikon di kiri address bar) → izinkan Lokasi, lalu muat ulang halaman."
              : ""}
          </p>
          {izin !== "denied" ? (
            <button
              type="button"
              onClick={izinkan}
              disabled={mintaIzin}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-60"
            >
              <MapPin aria-hidden className="size-3.5" />
              {mintaIzin ? "Meminta izin…" : "Izinkan akses lokasi"}
            </button>
          ) : null}
        </div>
      )}

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
        <button type="button" className={btn} onClick={() => setTanyaLokasi(true)}>
          <Images aria-hidden className="size-4" /> Galeri
        </button>
        <input
          ref={galRef}
          type="file"
          name="photos"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={pickGallery}
        />
      </div>

      {/* Konfirmasi sebelum memilih berkas galeri (DECISIONS 220). Pertanyaannya
          sengaja tentang KEADAAN NYATA pelapor, bukan tentang teknis GPS —
          "apakah kamu sedang di lokasi" bisa dijawab mandor mana pun. */}
      {tanyaLokasi ? (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <p className="text-sm font-medium text-ink">Kamu sedang berada di lokasi proyek?</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Kalau ya, posisimu sekarang dipakai sebagai cadangan bila foto tidak membawa GPS
            sendiri. Kalau tidak, foto tanpa GPS akan ditandai titik lokasi proyek.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => jawabLokasi(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800"
            >
              <MapPin aria-hidden className="size-3.5" /> Ya, saya di lokasi
            </button>
            <button
              type="button"
              onClick={() => jawabLokasi(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
            >
              <MapPinOff aria-hidden className="size-3.5" /> Tidak, unggah dari tempat lain
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <span>Foto galeri tanpa GPS →</span>
        <div className="w-56">
          <Combobox
            value={fallback}
            onChange={(val) => setFallback(val === "none" ? "none" : "project")}
            options={[
              { value: "project", label: "pakai titik lokasi proyek" },
              { value: "none", label: "tanpa tag lokasi" },
            ]}
          />
        </div>
      </div>

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
