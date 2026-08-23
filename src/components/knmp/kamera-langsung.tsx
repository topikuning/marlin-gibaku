"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import { Camera, CameraOff, MapPin, MapPinOff, X } from "lucide-react";
import { posisiJepret, type PosisiJepret } from "@/lib/foto-cepat/gps-segar";

export type { PosisiJepret };

/**
 * Berapa derajat bingkai video harus diputar agar tegak seperti yang dilihat
 * pemotret. 0 = tidak perlu (DECISIONS 424).
 *
 * MURNI + diekspor supaya bisa diuji tanpa kamera: aturan yang hanya hidup di
 * dalam handler rana adalah aturan yang tidak pernah diuji.
 *
 * `screen.orientation.angle` = berapa derajat LAYAR diputar dari orientasi
 * alami perangkat. Untuk HP (alaminya potret): 0 = dipegang tegak,
 * 90/270 = dimiringkan.
 */
export function putaranBingkai(
  lebar: number,
  tinggi: number,
  sudutLayar: number = typeof screen !== "undefined" ? (screen.orientation?.angle ?? 0) : 0,
): 0 | 90 | 270 {
  const bingkaiLanskap = lebar > tinggi;
  const layarPotret = sudutLayar === 0 || sudutLayar === 180;
  // Sepakat → jangan disentuh. Peramban yang sudah memutar bingkainya sendiri
  // akan rusak kalau diputar lagi.
  if (bingkaiLanskap !== layarPotret) return 0;
  if (!bingkaiLanskap) return 0; // layar miring tapi bingkai sudah tegak
  // Layar potret, bingkai lanskap → putar mengikuti arah miringnya sensor.
  return sudutLayar === 180 ? 270 : 90;
}

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
 *
 * ### SATU LAYAR PENUH, tanpa gulir (keluhan user 2026-08-06)
 *
 * *"user harus scroll dulu saat kamera aktif, saat menyimpan harus naik turun
 * itu viewportnya, tidak nyaman"*. Dulu kamera dirender INLINE di tengah
 * halaman: di bawah judul, keterangan, spanduk, dan panel antrean. Di HP itu
 * berarti (a) harus menggulir dulu untuk melihat rananya, dan (b) tiap jepretan
 * mengubah tinggi panel antrean DI ATASNYA, sehingga pratinjau ikut bergeser —
 * memotret sambil mengejar tombol yang berpindah.
 *
 * Sekarang lapisan LAYAR PENUH (`fixed inset-0`): begitu kamera dibuka, tidak
 * ada lagi yang bisa mendorongnya. Yang dipakai:
 *
 * - **`100dvh`, bukan `100vh`** — bilah alamat peramban HP menyusut/muncul saat
 *   digulir; `vh` mengunci ke tinggi TERBESAR, jadi rana melorot ke bawah layar.
 * - **gulir badan dikunci** selama kamera terbuka, plus `overscroll-contain` —
 *   tanpa itu, gerakan menyeret di atas pratinjau menggulir halaman di baliknya
 *   dan efek "pull to refresh" bisa memuat ulang halaman di tengah pemotretan.
 * - **`object-contain`, bukan `cover`** — pratinjau harus memperlihatkan PERSIS
 *   yang tersimpan. `cover` memotong tepi bingkai di layar padahal kanvas tetap
 *   menyalin bingkai penuh: yang dilihat bukan yang didapat.
 * - **padding aman (`env(safe-area-inset-*)`)** — poni & bilah gestur iOS.
 *
 * Keadaan antrean ikut ditempel di lapisan ini supaya jumlah foto yang belum
 * terkirim tetap terlihat TANPA menutup kamera.
 */

/** Jeda minimal antar ketukan rana — mencegah satu ketukan terbaca dua kali. */
const JEDA_RANA_MS = 400;

type KeadaanKamera = "belum" | "meminta" | "hidup" | "ditolak" | "tak_didukung" | "gagal";

export function KameraLangsung({
  onFoto,
  onTutup,
  menunggu = 0,
}: {
  /** Dipanggil tiap kali rana ditekan. Pengunggahan urusan pemanggil. */
  onFoto: (file: File, posisi: PosisiJepret) => void;
  onTutup: () => void;
  /** Jumlah foto di antrean yang belum sampai server — ditempel di layar kamera. */
  menunggu?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [keadaan, setKeadaan] = useState<KeadaanKamera>("belum");
  const [kilat, setKilat] = useState(false);
  /** Pelepas listener kesiapan video — dipanggil saat kamera dimatikan. */
  const lepasSiap = useRef<(() => void) | null>(null);
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
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        void v.play().catch(() => {});
        /*
         * "hidup" BARU diumumkan setelah video benar-benar punya frame.
         *
         * `getUserMedia` yang selesai TIDAK berarti gambarnya sudah ada:
         * `videoWidth` masih 0 selama beberapa saat sesudahnya. Dulu rana
         * langsung diaktifkan di titik ini, padahal `jepret()` membuang
         * ketukan saat `videoWidth` nol — DIAM-DIAM, tanpa kilat, tanpa
         * pesan, tanpa masuk antrean.
         *
         * Di lapangan itu berarti orang menekan rana begitu kamera terbuka,
         * merasa sudah memotret, dan tidak ada apa pun yang tersimpan. Bukti
         * yang hilang tidak pernah ketahuan pada saat kejadian.
         *
         * Dengan menunda "hidup" sampai ada dimensi, rana NONAKTIF tepat
         * selama ketukan akan hilang — jadi ketukan yang bisa ditekan selalu
         * menghasilkan foto.
         */
        const siap = () => {
          if (batal) return;
          if (v.videoWidth > 0 && v.videoHeight > 0) setKeadaan("hidup");
        };
        // `resize` ikut didengar: sebagian peramban baru mengisi videoWidth
        // sesudah loadedmetadata, dan menunggu satu event saja bisa menggantung.
        v.addEventListener("loadedmetadata", siap);
        v.addEventListener("resize", siap);
        lepasSiap.current = () => {
          v.removeEventListener("loadedmetadata", siap);
          v.removeEventListener("resize", siap);
        };
        siap();
      })
      .catch((err: unknown) => {
        if (batal) return;
        const nama = err instanceof Error ? err.name : "";
        setKeadaan(nama === "NotAllowedError" || nama === "SecurityError" ? "ditolak" : "gagal");
      });
    })();
    return () => {
      batal = true;
      lepasSiap.current?.();
      lepasSiap.current = null;
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

  // ── Kunci gulir badan selama kamera terbuka ──
  // Tanpa ini, menyeret di atas pratinjau menggulir halaman di baliknya dan
  // "pull to refresh" bisa memuat ulang halaman di tengah pemotretan.
  useEffect(() => {
    const el = document.body;
    const gulirLama = el.style.overflow;
    const overscrollLama = el.style.overscrollBehavior;
    el.style.overflow = "hidden";
    el.style.overscrollBehavior = "none";
    return () => {
      el.style.overflow = gulirLama;
      el.style.overscrollBehavior = overscrollLama;
    };
  }, []);

  const jepret = useCallback(() => {
    const sekarang = Date.now();
    if (sekarang - ranaTerakhir.current < JEDA_RANA_MS) return;
    ranaTerakhir.current = sekarang;

    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;

    /*
     * ORIENTASI: diputar DI SINI, bukan di server (DECISIONS 424).
     *
     * Canvas tidak menghasilkan EXIF sama sekali, jadi `sharp().rotate()` di
     * pipeline foto tidak punya apa pun untuk dibaca — bukan gagal mendeteksi,
     * memang tidak ada datanya. Sensor HP hampir selalu mengirim bingkai
     * LANDSCAPE berapa pun cara orang memegangnya, sehingga foto yang dijepret
     * sambil berdiri tersimpan miring 90°. Dilaporkan user 2026-08-23.
     *
     * Satu-satunya tempat informasinya masih ada adalah detik rana ditekan, di
     * HP itu sendiri: `screen.orientation.angle`. Yang dipakai hanya bila ada
     * PERTENTANGAN nyata — layar potret tapi bingkai lanskap (atau sebaliknya).
     * Tanpa syarat itu, peramban yang sudah memutar bingkainya sendiri akan
     * diputar dua kali.
     */
    const sudut = putaranBingkai(v.videoWidth, v.videoHeight);
    const tegak = sudut === 90 || sudut === 270;

    const canvas = document.createElement("canvas");
    canvas.width = tegak ? v.videoHeight : v.videoWidth;
    canvas.height = tegak ? v.videoWidth : v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (sudut === 0) {
      ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight);
    } else {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((sudut * Math.PI) / 180);
      ctx.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2, v.videoWidth, v.videoHeight);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

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
      <Lapisan>
        <div className="flex h-full items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-md border border-warning-border bg-warning-soft p-4">
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
                : "Tutup layar ini, lalu pakai jalur cadangan “Kamera dalam aplikasi tidak jalan?” – hasilnya sama, hanya ada satu layar konfirmasi dari aplikasi kamera HP."}
            </p>
            <button
              type="button"
              onClick={onTutup}
              className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink"
            >
              Tutup
            </button>
          </div>
        </div>
      </Lapisan>
    );
  }

  return (
    <Lapisan>
      {/* Pratinjau memenuhi layar. `object-contain`: yang terlihat = yang tersimpan. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-label="Pratinjau kamera"
        className="absolute inset-0 size-full bg-ink object-contain"
      />
      {/* Kilat putih singkat = tanda rana benar-benar terpicu. Tanpa ini,
          memotret cepat terasa seperti tidak terjadi apa-apa. */}
      {kilat ? <div aria-hidden className="absolute inset-0 bg-white/70" /> : null}

      {/* Bilah atas — di dalam area aman (poni). */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="flex items-center gap-1 rounded-full bg-ink/60 px-2.5 py-1.5 text-[11px] font-medium text-white">
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
        <button
          type="button"
          onClick={onTutup}
          aria-label="Tutup kamera"
          className="rounded-full bg-ink/60 p-2.5 text-white"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      {keadaan !== "hidup" ? (
        <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white">Menyalakan kamera…</p>
      ) : null}

      {/* Bilah bawah — rana + keadaan antrean, di dalam area aman (bilah gestur). */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-ink/85 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p aria-live="polite" className="text-center text-[11px] text-white/80">
          {keadaan !== "hidup"
            ? "Menyiapkan kamera… rana aktif begitu gambar muncul."
            : menunggu > 0
              ? `${menunggu} foto menunggu kirim – aman tersimpan di HP.`
              : "Ketuk untuk memotret. Foto langsung tersimpan – tanpa konfirmasi."}
        </p>
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
          className="flex size-18 items-center justify-center rounded-full border-4 border-white bg-white/20 active:bg-white/50 disabled:opacity-40"
        >
          <Camera aria-hidden className="size-8 text-white" />
        </button>
      </div>
    </Lapisan>
  );
}

/**
 * Lapisan layar penuh untuk kamera.
 *
 * `100dvh` (bukan `100vh`): bilah alamat peramban HP menyusut & muncul kembali,
 * dan `vh` mengunci ke tinggi TERBESAR — rana akan melorot ke luar layar.
 * `overscroll-contain` menahan gerakan seret supaya tidak merembet menggulir
 * halaman di belakangnya.
 */
function Lapisan({ children }: { children: React.ReactNode }) {
  // DI-PORTAL ke <body>: `position: fixed` diukur terhadap ancestor terdekat
  // yang punya `transform`/`filter`/`contain` — satu utility Tailwind semacam
  // itu di kartu mana pun akan diam-diam mengurung lapisan ini di dalam kartu,
  // dan keluhan "harus scroll" balik lagi.
  // Komponen ini hanya dipasang setelah user menekan "Buka kamera", jadi tidak
  // pernah dirender di server; penjaga ini murni supaya tidak meledak kalau
  // suatu saat dipakai di jalur yang ikut SSR.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kamera"
      className="no-print fixed inset-0 z-60 h-[100dvh] w-screen overflow-hidden overscroll-contain bg-ink"
    >
      {children}
    </div>,
    document.body,
  );
}
