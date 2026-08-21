"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { formatTanggalWaktu } from "@/lib/format";
import { tanyaSimpanan } from "./tanya-sw";

/**
 * Pintu ke Foto Cepat di halaman luring – beserta kejujuran soal siap atau
 * tidaknya (DECISIONS 399).
 *
 * Tombol yang selalu tampak "siap" adalah janji yang tidak bisa ditepati:
 * kalau halamannya belum pernah tersimpan, menekannya cuma kembali ke halaman
 * ini, dan orang yang berdiri di lokasi tanpa sinyal akan mengira aplikasinya
 * yang rusak. Karena itu status simpanannya ditanyakan ke service worker dan
 * dikatakan apa adanya, termasuk kapan rekamannya diambil.
 *
 * Tombolnya tetap ada dalam keadaan apa pun: kalau ternyata jaringannya hidup,
 * ia membuka Foto Cepat yang sungguhan.
 */

type Keadaan = "memeriksa" | "siap" | "belum";

export function PintuFotoCepat() {
  const [keadaan, setKeadaan] = useState<Keadaan>("memeriksa");
  const [disimpanPada, setDisimpanPada] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    void tanyaSimpanan(`${window.location.origin}/foto-cepat`).then((info) => {
      if (batal) return;
      setDisimpanPada(info?.disimpanPada ?? null);
      setKeadaan(info?.disimpanPada ? "siap" : "belum");
    });
    return () => {
      batal = true;
    };
  }, []);

  const waktu = disimpanPada ? new Date(disimpanPada) : null;
  const capWaktu =
    waktu && !Number.isNaN(waktu.getTime()) ? `${formatTanggalWaktu(waktu)} WIB` : null;

  return (
    <>
      <a
        href="/foto-cepat"
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
      >
        <Camera aria-hidden className="size-4" /> Buka Foto Cepat
      </a>
      <p className="mt-2 text-[11px] text-ink-muted">
        {keadaan === "memeriksa" ? "Memeriksa simpanan di HP ini…" : null}
        {keadaan === "siap"
          ? `Tersimpan di HP ini – siap dipakai memotret tanpa sinyal${capWaktu ? ` (rekaman ${capWaktu})` : ""}.`
          : null}
        {keadaan === "belum"
          ? "Belum tersimpan di HP ini – Foto Cepat perlu sekali terbuka saat ada sinyal sebelum bisa dipakai tanpa jaringan."
          : null}
      </p>
    </>
  );
}
