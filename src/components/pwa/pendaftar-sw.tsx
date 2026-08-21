"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui";
import { formatTanggalWaktu } from "@/lib/format";

/**
 * Pemasang service worker + pengakuan "halaman ini dari simpanan" (DECISIONS 392).
 *
 * Dua tugas, sengaja satu berkas, karena yang kedua tidak boleh dilupakan saat
 * yang pertama dipasang: begitu sebuah halaman bisa disajikan dari simpanan, ia
 * WAJIB bisa mengaku dirinya simpanan. Halaman lama yang tampil seperti halaman
 * baru adalah cacat yang lebih buruk daripada halaman yang tidak bisa dibuka –
 * yang satu bisa dilihat, yang satunya diam.
 *
 * Hanya di production: di `pnpm dev`, service worker menyimpan berkas build yang
 * berganti tiap ketikan dan membuat HMR tampak rusak.
 */

interface InfoSimpanan {
  dariSimpanan: boolean;
  disimpanPada: string | null;
}

const BATAS_TANYA_MS = 3000;

/** Tanya service worker lewat MessageChannel; null bila tidak menjawab. */
function tanya(sw: ServiceWorker, pesan: Record<string, unknown>): Promise<InfoSimpanan | null> {
  return new Promise((selesai) => {
    const kanal = new MessageChannel();
    const jam = window.setTimeout(() => selesai(null), BATAS_TANYA_MS);
    kanal.port1.onmessage = (e: MessageEvent) => {
      window.clearTimeout(jam);
      const d = e.data as Partial<InfoSimpanan> | null;
      selesai(
        d && typeof d === "object"
          ? {
              dariSimpanan: d.dariSimpanan === true,
              disimpanPada: typeof d.disimpanPada === "string" ? d.disimpanPada : null,
            }
          : null,
      );
    };
    sw.postMessage(pesan, [kanal.port2]);
  });
}

export function PendaftarServiceWorker({ pemilik }: { pemilik: string }) {
  const [info, setInfo] = useState<InfoSimpanan | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let batal = false;
    const jalankan = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const reg = await navigator.serviceWorker.ready;
        const sw = reg.active;
        if (!sw || batal) return;
        // Siapa yang memakai HP ini + build mana. Ganti pemilik = simpanan
        // halaman ber-sesi dibuang di sisi service worker.
        sw.postMessage({
          jenis: "halo",
          pemilik,
          build: process.env.MARLIN_BUILD_ID ?? "",
        });
        const jawaban = await tanya(sw, {
          jenis: "info-simpanan",
          url: window.location.href,
        });
        if (!batal && jawaban?.dariSimpanan) setInfo(jawaban);
      } catch {
        // Peramban menolak service worker (mode privat, kuota, HTTP polos).
        // Aplikasinya tetap jalan seperti sebelum DECISIONS 392 – tidak ada
        // yang perlu dikatakan ke pemakai tentang ini.
      }
    };
    void jalankan();
    return () => {
      batal = true;
    };
  }, [pemilik]);

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
          Halaman ini dimuat tanpa jaringan, jadi isinya rekaman kunjungan terakhir
          {capWaktu ? ` (${capWaktu})` : ""}. Daftar lokasi dan pilihan lain bisa sudah
          berubah di server. Foto yang Anda jepret sekarang tetap masuk antrean dan
          terkirim sendiri begitu sinyal kembali.
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
