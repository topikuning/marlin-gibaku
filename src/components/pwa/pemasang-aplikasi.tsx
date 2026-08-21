"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui";
import {
  KUNCI_TOLAK,
  iniIos,
  tawaranPasang,
  type TawaranPasang,
} from "@/lib/pwa/pasang";
import { adaTawaran, pakaiTawaran } from "./simpanan-tawaran";

/**
 * TOMBOL "PASANG APLIKASI" DI DALAM MARLIN (DECISIONS 405).
 *
 * Permintaan user: *"di chrome ada pilihan install. apakah kamu bisa force
 * memberi pilihan install tanpa harus masuk menu chrome untuk install"*
 *
 * Bisa. Chrome menembakkan `beforeinstallprompt`; kita menahannya lalu
 * memunculkan tombol sendiri, dan menekannya membuka dialog pasang Android
 * langsung — tanpa menu ⋮. Alasannya bukan kerapian: mandor lapangan tidak akan
 * menemukan "Tambahkan ke layar utama" di dalam menu peramban, dan tanpa
 * terpasang ia kehilangan ikon di layar depan, mode layar penuh, dan pintasan
 * Foto Cepat (DECISIONS 399) — justru yang paling berguna di lapangan.
 *
 * Yang TIDAK dijanjikan, dan sengaja tidak dipalsukan:
 * pemasangan tetap butuh SATU ketukan pemakai, dan tombolnya hanya bisa muncul
 * bila peramban memang menawarkan. Di iOS `beforeinstallprompt` tidak ada sama
 * sekali, jadi di sana yang ditampilkan petunjuk, bukan tombol yang pura-pura
 * bekerja.
 */

function bacaTolak(): number | null {
  try {
    const v = window.localStorage.getItem(KUNCI_TOLAK);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    // Mode privat / penyimpanan diblokir. Bukan alasan menyembunyikan tombol;
    // paling banter tawarannya muncul lagi lebih sering.
    return null;
  }
}

export function PemasangAplikasi({ varian = "banner" }: { varian?: "banner" | "ringkas" }) {
  const [tawaran, setTawaran] = useState<TawaranPasang>("tidak");
  const [terpasang, setTerpasang] = useState(false);
  /*
   * "Peramban menawarkan" DIPEGANG SEBAGAI STATE, bukan dibaca dari `window`
   * saat render.
   *
   * Cacat yang sudah terjadi: varian ringkas menghitung `adaTawaran()` langsung
   * di badan komponen. Nilainya benar, tapi React tidak melacaknya — dan karena
   * `hitung()` menyetel state ke nilai yang SAMA ("tidak" → "tidak"), React
   * membatalkan render ulangnya. Tombolnya tidak pernah terbit. Ketahuan hanya
   * karena dicoba di peramban; tidak ada uji unit yang bisa melihatnya.
   */
  const [punyaTawaran, setPunyaTawaran] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  const hitung = useCallback(() => {
    if (typeof window === "undefined") return;
    /*
     * "Sudah terpasang" dibaca dari MODE TAMPILAN, bukan dari catatan sendiri:
     * aplikasi bisa dicopot dari luar MARLIN kapan saja, dan catatan apa pun
     * yang kita simpan akan berbohong sesudah itu.
     */
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      // Safari iOS memakai properti non-standar ini.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    setTerpasang(standalone);
    setPunyaTawaran(adaTawaran());
    setTawaran(
      tawaranPasang({
        adaTawaran: adaTawaran(),
        sudahTerpasang: standalone,
        ios: iniIos(navigator.userAgent, navigator.maxTouchPoints, navigator.platform),
        ditolakPada: bacaTolak(),
        sekarang: Date.now(),
      }),
    );
  }, []);

  useEffect(() => {
    /*
     * Perhitungan pertama ditunda satu putaran, bukan dijalankan langsung di
     * dalam efek: `setState` serentak di dalam efek memicu render berantai
     * (dijaga lint). Penundaannya juga kebetulan benar — Chrome kerap
     * menembakkan `beforeinstallprompt` beberapa milidetik sesudah halaman
     * interaktif, jadi menghitung sedikit belakangan justru lebih sering tepat.
     */
    const t = window.setTimeout(hitung, 0);
    // `marlin:pasang-siap` diterbitkan penangkap awal di root layout — event
    // aslinya bisa sudah lewat sebelum komponen ini terpasang.
    window.addEventListener("marlin:pasang-siap", hitung);
    window.addEventListener("marlin:terpasang", hitung);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("marlin:pasang-siap", hitung);
      window.removeEventListener("marlin:terpasang", hitung);
    };
  }, [hitung]);

  const pasang = async () => {
    // Diambil sekali pakai: `prompt()` kedua pada event yang sama ditolak
    // peramban, jadi keadaan "sudah dipakai" tidak boleh bisa terlewat.
    const ev = pakaiTawaran();
    if (!ev) return;
    // Event-nya habis sekali pakai; state ikut turun supaya tombolnya tidak
    // tertinggal dalam keadaan yang tidak bisa lagi bekerja.
    setPunyaTawaran(false);
    setSibuk(true);
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === "dismissed") tutup();
      else setTawaran("tidak");
    } catch {
      // Peramban menolak (bukan dari gestur, atau dialognya sedang terbuka).
      // Tidak ada yang perlu dikatakan; tombolnya tetap ada untuk dicoba lagi.
    } finally {
      setSibuk(false);
    }
  };

  /*
   * Untuk varian ringkas: peramban benar-benar menawarkan DAN belum terpasang.
   * Peredam penolakan sengaja tidak dilihat — lihat catatan di bawah.
   */
  const bisaOtomatis = !terpasang && (tawaran === "tombol" || punyaTawaran);

  const tutup = () => {
    try {
      window.localStorage.setItem(KUNCI_TOLAK, String(Date.now()));
    } catch {
      /* penyimpanan diblokir – tawarannya muncul lagi nanti, bukan galat */
    }
    setTawaran("tidak");
  };

  /*
   * Varian RINGKAS mengabaikan peredam 14 hari dengan sengaja (DECISIONS 405).
   *
   * Tanpa ini ada lubang yang saya buat sendiri: menutup banner sekali berarti
   * dua minggu TANPA satu pun jalan pasang di dalam MARLIN — persis kembali ke
   * menu ⋮ yang justru dikeluhkan. Peredamnya menahan yang MENGGANGGU (banner
   * selebar layar), bukan yang tersedia (satu tombol kecil yang cuma muncul
   * kalau peramban memang menawarkan).
   */
  if (varian === "ringkas") {
    if (!bisaOtomatis) return null;
    return (
      <button
        type="button"
        onClick={pasang}
        disabled={sibuk}
        aria-label="Pasang MARLIN di layar depan"
        title="Pasang MARLIN di layar depan HP"
        className="flex h-9 items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2.5 text-[13px] font-medium text-primary hover:bg-primary-100 disabled:opacity-60"
      >
        <Download aria-hidden className="size-4" />
        <span className="hidden sm:inline">{sibuk ? "Membuka…" : "Pasang"}</span>
      </button>
    );
  }

  if (tawaran === "tidak") return null;

  return (
    <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-white">
          <Download aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">Pasang MARLIN di layar depan HP</p>
          {tawaran === "tombol" ? (
            <>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
                Ikonnya masuk ke layar depan, terbuka layar penuh tanpa alamat peramban, dan
                Foto Cepat bisa dibuka lewat tekan-lama ikonnya – termasuk saat tidak ada sinyal.
              </p>
              <Button className="mt-3 w-full sm:w-auto" onClick={pasang} loading={sibuk}>
                {sibuk ? "Membuka pemasang…" : "Pasang sekarang"}
              </Button>
            </>
          ) : (
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
              Di iPhone/iPad pemasangannya lewat Safari: ketuk tombol Bagikan{" "}
              <Share aria-hidden className="inline size-3.5 align-[-2px]" /> di bawah layar, lalu
              pilih <b>Tambahkan ke Layar Utama</b>. iOS tidak menyediakan tombol pasang di dalam
              halaman, jadi langkah ini tidak bisa dipendekkan.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={tutup}
          aria-label="Tutup tawaran pasang"
          className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
