"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Images, MapPin, MapPinOff, X } from "lucide-react";
import { Combobox, useDismissable } from "@/components/ui";
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
  /** Permintaan GPS galeri yang sedang berjalan paralel dgn pemilih berkas. */
  const gpsRef = useRef<Promise<void> | null>(null);
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
  const tanya = useDismissable(tanyaLokasi, () => setTanyaLokasi(false));

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

  /** Ambil posisi ke hidden field. Selalu resolve — kegagalan bukan pengecualian. */
  const mintaPosisi = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          catat("unsupported");
          return resolve();
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (latRef.current) latRef.current.value = String(pos.coords.latitude);
            if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
            catat("granted");
            resolve();
          },
          (err) => {
            catat(err.code === err.PERMISSION_DENIED ? "denied" : "prompt");
            resolve();
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        );
      }),
    [catat],
  );

  /**
   * Jawab "sedang di lokasi proyek?" lalu buka pemilih berkas (DECISIONS 220).
   *
   * Kalau YA, posisi perangkat SEKARANG diambil dan dikirim sebagai cadangan —
   * dipakai hanya bila foto tidak punya GPS sendiri. Kalau TIDAK, tidak ada
   * koordinat perangkat yang dikirim sama sekali: mengunggah dari kantor lalu
   * menandai fotonya dengan posisi kantor jauh lebih buruk daripada tidak
   * menandai apa pun.
   *
   * Pemilih berkas dibuka SEKETIKA, GPS berjalan paralel. Dulu `click()`
   * menunggu `getCurrentPosition` selesai — dengan timeout 10 detik, menekan
   * "Ya, saya di lokasi" bisa berarti sepuluh detik layar diam tanpa satu pun
   * tanda bahwa sesuatu sedang terjadi. Lebih buruk lagi: `click()` dari dalam
   * callback asinkron sudah keluar dari gestur pengguna, dan sebagian browser
   * mobile memblokirnya — pemilih berkasnya tidak pernah muncul sama sekali.
   * Yang menunggu GPS sekarang hanya `onPicked` (lihat `pickGallery`), supaya
   * form ber-auto-submit tetap tidak terkirim sebelum koordinatnya siap.
   */
  const jawabLokasi = (ya: boolean) => {
    setDiLokasi(ya);
    setTanyaLokasi(false);
    setSource("gallery");
    clearGps();
    gpsRef.current = ya ? mintaPosisi() : null;
    galRef.current?.click();
  };

  const pickGallery = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (camRef.current) camRef.current.value = "";
    setSource("gallery");
    setTakenAt(new Date().toISOString());
    makePreviews(files);
    // Tunggu GPS yang berjalan paralel HANYA di sini: pemakai `onPicked`
    // mengirim form seketika, jadi mendahuluinya berarti mengunggah tanpa
    // koordinat cadangan yang sudah terlanjur dijanjikan ke pengguna.
    const gps = gpsRef.current;
    if (!gps) return onPicked?.();
    void gps.then(() => onPicked?.());
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
        <button
          type="button"
          className={btn}
          onClick={() => {
            tanya.capture();
            setTanyaLokasi(true);
          }}
        >
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

      <TanyaLokasiDialog open={tanyaLokasi} onJawab={jawabLokasi} dismiss={tanya} />

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

/**
 * Konfirmasi sebelum memilih berkas galeri (DECISIONS 220, direvisi 222).
 *
 * Pertanyaannya sengaja tentang KEADAAN NYATA pelapor, bukan tentang teknis
 * GPS — "apakah kamu sedang di lokasi" bisa dijawab mandor mana pun.
 *
 * Dulu ini panel kecil yang menyelip di bawah tombol Galeri, lengkap dengan dua
 * kalimat penjelasan dan dua tombol berukuran teks 11px. Di layar 375px sambil
 * berdiri di lapangan, itu terbaca sebagai catatan kaki, bukan sebagai
 * pertanyaan yang menghentikan alur — laporan user 2026-08-02: "terlalu kecil
 * ... terlalu banyak penjelasan di situ, langsung saja button."
 *
 * Sekarang: dialog di tengah layar, tanpa paragraf, dua tombol selebar dialog
 * dengan target ketuk 56px. Akibat tiap pilihan tidak lagi dijelaskan di sini
 * karena hasilnya toh tercetak pada cap fotonya sendiri (DECISIONS 197) —
 * penjelasan yang tidak dibaca bukan penjelasan.
 */
function TanyaLokasiDialog({
  open,
  onJawab,
  dismiss,
}: {
  open: boolean;
  /** WAJIB dipanggil sinkron dari onClick: pemilih berkas ikut di gestur itu. */
  onJawab: (diLokasi: boolean) => void;
  dismiss: { capture: () => void; close: () => void };
}) {
  if (!open) return null;
  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tanya-lokasi-judul"
    >
      <button
        type="button"
        aria-label="Batal"
        onClick={dismiss.close}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative m-3 w-full max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-xl">
        <button
          type="button"
          aria-label="Batal"
          onClick={dismiss.close}
          className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted"
        >
          <X aria-hidden className="size-4" />
        </button>
        <h2 id="tanya-lokasi-judul" className="pr-9 text-base font-semibold text-ink">
          Kamu sedang di lokasi proyek?
        </h2>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            autoFocus
            onClick={() => onJawab(true)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-white hover:bg-primary-800"
          >
            <MapPin aria-hidden className="size-5" /> Ya, saya di lokasi
          </button>
          <button
            type="button"
            onClick={() => onJawab(false)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface text-base font-semibold text-ink hover:bg-surface-muted"
          >
            <MapPinOff aria-hidden className="size-5" /> Tidak
          </button>
        </div>
      </div>
    </div>
  );
}
