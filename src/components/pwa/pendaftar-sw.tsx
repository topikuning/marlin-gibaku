"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui";
import { formatTanggalWaktu } from "@/lib/format";
import { tanya, type InfoSimpanan } from "./tanya-sw";

/**
 * Pemasang service worker + pengakuan "halaman ini dari simpanan"
 * (DECISIONS 397/398).
 *
 * Tiga tugas, sengaja satu berkas, karena ketiganya tidak boleh terpisah:
 *
 * 1. memasang service worker;
 * 2. MENYIAPKAN halaman lapangan untuk dipakai luring – tanpa ini, simpanan
 *    hanya lahir dari kunjungan yang sudah terjadi, dan mandor yang berangkat
 *    tanpa pernah menekan menu Foto Cepat menemukan aplikasinya kosong persis
 *    saat dibutuhkan (DECISIONS 398);
 * 3. mengaku bila halaman yang sedang dibaca berasal dari simpanan. Begitu
 *    sebuah halaman bisa disajikan dari simpanan, ia WAJIB bisa mengatakannya –
 *    halaman lama yang tampil seperti halaman baru adalah cacat yang lebih
 *    buruk daripada halaman yang tidak bisa dibuka: yang satu bisa dilihat,
 *    yang satunya diam.
 *
 * Hanya di production: di `pnpm dev`, service worker menyimpan berkas build yang
 * berganti tiap ketikan dan membuat HMR tampak rusak.
 */

export interface PendaftarServiceWorkerProps {
  /** Id pemakai; ganti pemilik = simpanan halaman ber-sesi dibuang. */
  pemilik: string;
  /**
   * Siapkan `/foto-cepat` untuk dipakai luring. Hanya untuk yang memang boleh
   * membukanya – menyiapkan halaman yang berujung 404 bagi rolenya cuma
   * membuang kuota dan render server.
   */
  siapkanFotoCepat: boolean;
}

export function PendaftarServiceWorker({ pemilik, siapkanFotoCepat }: PendaftarServiceWorkerProps) {
  const [info, setInfo] = useState<InfoSimpanan | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let batal = false;

    /** Sapaan + penyiapan luring. Keduanya tanpa balasan, aman ditembakkan. */
    const sapa = (sw: ServiceWorker) => {
      // Siapa yang memakai HP ini + build mana. Ganti pemilik = simpanan
      // halaman ber-sesi dibuang di sisi service worker.
      sw.postMessage({ jenis: "halo", pemilik, build: process.env.MARLIN_BUILD_ID ?? "" });
      // Penyiapan hanya masuk akal saat ada jaringan. `navigator.onLine`
      // dipakai untuk MELEWATI, bukan sebagai bukti ada jaringan: kalau
      // ternyata bohong, penjemputannya gagal dan simpanan lama tetap utuh.
      if (siapkanFotoCepat && navigator.onLine) {
        sw.postMessage({ jenis: "siapkan-luring", jalur: "/foto-cepat" });
      }
    };

    const jalankan = async () => {
      // Halaman yang SUDAH dikendalikan diurus lebih dulu, lewat
      // `controller` — tanpa menunggu pendaftaran ulang.
      //
      // Ini bukan penghematan: `register()` menjemput ulang /sw.js dari
      // JARINGAN, jadi saat luring ia bisa gagal. Menaruh pertanyaan
      // "halaman ini dari simpanan?" di belakangnya berarti justru dalam
      // keadaan luring – satu-satunya keadaan banner itu dibutuhkan – ia
      // tidak pernah ditanyakan. Cacat ini nyata: bannernya hilang di
      // sebagian muat ulang luring sebelum urutannya dibalik.
      const pengendali = navigator.serviceWorker.controller;
      if (pengendali) {
        sapa(pengendali);
        const jawaban = await tanya(pengendali, {
          jenis: "info-simpanan",
          url: window.location.href,
        });
        if (!batal && jawaban?.dariSimpanan) setInfo(jawaban);
      }

      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // Peramban menolak service worker (mode privat, kuota, HTTP polos)
        // atau tidak ada jaringan untuk memeriksa versinya. Aplikasinya tetap
        // jalan seperti sebelum DECISIONS 397 – tidak ada yang perlu
        // dikatakan ke pemakai tentang ini.
      }

      // Kunjungan pertama: belum ada pengendali. Halamannya sudah pasti dari
      // jaringan (tidak ada yang menyimpankannya), jadi yang tersisa cuma
      // menyapa begitu service worker-nya hidup.
      if (!pengendali) {
        try {
          const reg = await navigator.serviceWorker.ready;
          if (reg.active && !batal) sapa(reg.active);
        } catch {
          // Idem.
        }
      }
    };
    void jalankan();
    return () => {
      batal = true;
    };
  }, [pemilik, siapkanFotoCepat]);

  if (!info?.dariSimpanan) return null;

  const waktu = info.disimpanPada ? new Date(info.disimpanPada) : null;
  const capWaktu =
    waktu && !Number.isNaN(waktu.getTime()) ? `${formatTanggalWaktu(waktu)} WIB` : null;

  return (
    <Banner
      tone="warning"
      className="mb-4"
      title="Ditampilkan dari simpanan HP ini"
      description={
        <>
          Halaman ini dimuat tanpa jaringan, jadi isinya rekaman terakhir kali HP ini
          punya sinyal{capWaktu ? ` (${capWaktu})` : ""}. Daftar lokasi dan pilihan lain
          bisa sudah berubah di server. Foto yang Anda jepret sekarang tetap masuk antrean
          dan terkirim sendiri begitu sinyal kembali.
        </>
      }
      action={
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800"
        >
          <RefreshCw aria-hidden className="size-3.5" /> Muat ulang
        </button>
      }
    />
  );
}
