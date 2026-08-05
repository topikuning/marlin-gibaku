"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, MapPin, MapPinOff, X } from "lucide-react";
import { posisiJepret, type PosisiJepret } from "@/lib/foto-cepat/gps-segar";

export type { PosisiJepret };

/**
 * KAMERA DI DALAM APLIKASI — jepret, masuk, jepret lagi (DECISIONS 256).
 *
 * Keluhan user: *"ada konfirmasi use this photo, bukan jepret langsung simpan.
 * apakah kamu punya solusi agar pengambilan foto ini bisa native dan cepat,
 * jepret, foto ambil, jepret foto masuk"*
 *
 * Layar "Use Photo / Retake" itu MILIK SISTEM OPERASI, bukan milik MARLIN.
 * `<input capture>` menyerahkan pekerjaan ke aplikasi kamera bawaan, dan
 * aplikasi itu selalu meminta konfirmasi sebelum mengembalikan berkasnya. Tidak
 * ada atribut, opsi, atau trik yang bisa mematikannya dari halaman web —
 * satu-satunya cara menghilangkannya adalah TIDAK menyerahkan pekerjaan itu.
 *
 * Jadi rananya dipindah ke dalam halaman: `getUserMedia` menyalakan pratinjau
 * langsung, ketukan menyalin bingkai video ke canvas, dan hasilnya langsung
 * diunggah. Tidak ada penyerahan, jadi tidak ada layar konfirmasi.
 *
 * ### Kualitasnya TIDAK berkurang
 *
 * Kekhawatiran yang wajar: tangkapan `getUserMedia` beresolusi video (±1920×1080),
 * sedangkan kamera bawaan bisa 12 MP. Tapi pipeline foto MARLIN menyusutkan
 * semua gambar ke sisi terpanjang 1920 px (`MAIN_MAX`) sebelum disimpan — foto
 * 12 MP itu toh berakhir di ukuran yang sama. Yang hilang cuma piksel yang
 * memang tidak pernah ikut tersimpan.
 *
 * ### Yang HILANG dan diganti sumber lain
 *
 * Canvas tidak menghasilkan EXIF. Untuk Foto Cepat itu tidak menjadi soal:
 * koordinat datang dari GPS perangkat pada detik rana ditekan, dan jamnya dari
 * jam perangkat saat itu juga — dua-duanya justru lebih tepat daripada EXIF,
 * karena tidak bergantung pada aplikasi kamera menulis metadata dengan benar.
 */

/** Jeda minimal antar ketukan rana — mencegah satu ketukan terbaca dua kali. */
const JEDA_RANA_MS = 400;

type KeadaanKamera = "belum" | "meminta" | "hidup" | "ditolak" | "tak_didukung" | "gagal";

export function KameraLangsung({
  onFoto,
  onTutup,
  sibuk = false,
}: {
  /** Dipanggil tiap kali rana ditekan. Pengunggahan urusan pemanggil. */
  onFoto: (file: File, posisi: PosisiJepret) => void;
  onTutup: () => void;
  /** true → ada unggahan berjalan; rana tetap boleh ditekan (antre di pemanggil). */
  sibuk?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [keadaan, setKeadaan] = useState<KeadaanKamera>("belum");
  const [kilat, setKilat] = useState(false);
  const ranaTerakhir = useRef(0);

  /** Bacaan GPS terakhir + kapan diterima — umurnya diperiksa saat rana ditekan. */
  const gps = useRef<{ lat: number; lng: number; waktu: number } | null>(null);
  const [gpsSegar, setGpsSegar] = useState(false);

  // ── Nyalakan kamera ──
  useEffect(() => {
    let batal = false;
    // Penyalaan ditunda ke microtask: menyetel state di badan effect memicu
    // render kaskade, dan lint repo ini memang melarangnya (pola yang sama
    // dipakai photo-source-input).
    void (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (!batal) setKeadaan("tak_didukung");
        return;
      }
      if (!batal) setKeadaan("meminta");
      await navigator.mediaDevices
      .getUserMedia({
        // `ideal`, bukan `exact`: perangkat tanpa kamera belakang (atau tablet
        // dengan satu kamera) harus tetap bisa memotret, bukan gagal total.
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((s) => {
        if (batal) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
        setKeadaan("hidup");
      })
      .catch((err: unknown) => {
        if (batal) return;
        const nama = err instanceof Error ? err.name : "";
        setKeadaan(nama === "NotAllowedError" || nama === "SecurityError" ? "ditolak" : "gagal");
      });
    })();
    return () => {
      batal = true;
      const s = streamRef.current;
      // Trek WAJIB dihentikan: kalau tidak, lampu kamera tetap menyala dan
      // baterai terus terkuras walau halamannya sudah ditinggalkan.
      if (s) for (const t of s.getTracks()) t.stop();
      streamRef.current = null;
    };
  }, []);

  // ── Ikuti posisi selama kamera terbuka ──
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    // Callback watchPosition berjalan ASINKRON (bukan badan effect), jadi
    // setState di dalamnya bukan render kaskade.
    const id = navigator.geolocation.watchPosition(
      (p) => {
        gps.current = { lat: p.coords.latitude, lng: p.coords.longitude, waktu: Date.now() };
        setGpsSegar(true);
      },
      () => setGpsSegar(false),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const jepret = useCallback(() => {
    const sekarang = Date.now();
    if (sekarang - ranaTerakhir.current < JEDA_RANA_MS) return;
    ranaTerakhir.current = sekarang;

    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    // Umur bacaan GPS diperiksa DI SINI, bukan saat diterima: yang menentukan
    // adalah seberapa baru koordinatnya pada detik foto diambil.
    const posisi = posisiJepret(gps.current, sekarang);

    setKilat(true);
    window.setTimeout(() => setKilat(false), 120);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const nama = `jepret-${new Date(sekarang).toISOString().replace(/[:.]/g, "-")}.jpg`;
        onFoto(new File([blob], nama, { type: "image/jpeg" }), posisi);
      },
      "image/jpeg",
      0.92,
    );
  }, [onFoto]);

  if (keadaan === "tak_didukung" || keadaan === "ditolak" || keadaan === "gagal") {
    return (
      <div className="rounded-md border border-warning-border bg-warning-soft p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <CameraOff aria-hidden className="size-4" />
          {keadaan === "ditolak"
            ? "Izin kamera ditolak"
            : keadaan === "tak_didukung"
              ? "Peramban ini tidak mendukung kamera langsung"
              : "Kamera tidak bisa dinyalakan"}
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          {keadaan === "ditolak"
            ? "Buka setelan situs di peramban (ikon di kiri address bar) → izinkan Kamera, lalu muat ulang halaman."
            : "Pakai tombol Kamera di bawah — hasilnya sama, hanya ada satu layar konfirmasi dari aplikasi kamera HP."}
        </p>
        <button
          type="button"
          onClick={onTutup}
          className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink"
        >
          Tutup
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-ink">
      <div className="relative">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Pratinjau kamera"
          className="block max-h-[60vh] w-full bg-ink object-contain"
        />
        {/* Kilat putih singkat = tanda rana benar-benar terpicu. Tanpa ini,
            memotret cepat terasa seperti tidak terjadi apa-apa. */}
        {kilat ? <div aria-hidden className="absolute inset-0 bg-white/70" /> : null}

        <button
          type="button"
          onClick={onTutup}
          aria-label="Tutup kamera"
          className="absolute right-2 top-2 rounded-full bg-ink/60 p-2 text-white"
        >
          <X aria-hidden className="size-4" />
        </button>

        <p className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-ink/60 px-2 py-1 text-[11px] font-medium text-white">
          {gpsSegar ? (
            <>
              <MapPin aria-hidden className="size-3" /> GPS aktif
            </>
          ) : (
            <>
              <MapPinOff aria-hidden className="size-3" /> GPS belum dapat
            </>
          )}
        </p>

        {keadaan !== "hidup" ? (
          <p className="absolute inset-x-0 bottom-1/2 text-center text-sm text-white">
            Menyalakan kamera…
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-4 bg-ink px-4 py-4">
        {/*
          Rana SENGAJA tetap aktif selagi unggahan berjalan: menonaktifkannya
          membuat ketukan berikutnya hilang tanpa jejak, dan di lapangan orang
          memotret beruntun. Antreannya diurus pemanggil.
        */}
        <button
          type="button"
          onClick={jepret}
          disabled={keadaan !== "hidup"}
          aria-label="Jepret"
          className="flex size-16 items-center justify-center rounded-full border-4 border-white bg-white/20 active:bg-white/50 disabled:opacity-40"
        >
          <Camera aria-hidden className="size-7 text-white" />
        </button>
      </div>

      <p className="bg-ink px-4 pb-3 text-center text-[11px] text-white/70">
        {sibuk ? "Mengirim foto…" : "Ketuk untuk memotret. Foto langsung tersimpan — tanpa konfirmasi."}
      </p>
    </div>
  );
}
