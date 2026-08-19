"use client";

import { useState } from "react";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { PemilihKantong, UbinAmbilDariKantong } from "@/components/knmp/ambil-dari-kantong";
import { removeReportPhotoAction } from "@/lib/daily-report/actions";
import type { PhotoView } from "@/lib/photos";

/**
 * FOTO SATU BARIS material / alat — LANGSUNG di barisnya (DECISIONS 343).
 *
 * ### Tiga keluhan, satu sebab
 *
 * User 2026-08-17: *"mana pilihan foto cepat di alat dan bahan"*, *"ada semen
 * yang aku sudah simpan dan upload foto … tapi di atas 0 foto"*, dan *"buat apa
 * ada button simpan & foto, seharusnya langsung saja 3 pilihan sumber foto
 * seperti biasa"* — ditutup *"kenapa sih bikin gini aja gak beres langsung"*.
 *
 * Ketiganya berasal dari satu keputusan yang salah: fotonya diurus lewat JALUR
 * SENDIRI (aksi terpisah, lembar melayang) alih-alih ikut simpanan formnya.
 * Akibatnya berantai — jalur sendiri berarti kantong Foto Cepat harus
 * disambungkan ulang (tidak pernah dilakukan, jadi pilihannya tidak ada),
 * berarti barisnya harus tersimpan lebih dulu (tombol "Simpan & foto"), dan
 * berarti jumlah fotonya dibaca dari state yang tidak ikut diperbarui sesudah
 * unggah (angka "0 foto" yang keras kepala).
 *
 * Sekarang fotonya IKUT SIMPANAN, persis seperti form item pekerjaan sejak
 * lama: tiga sumber langsung di barisnya, dipilih kapan saja — termasuk pada
 * baris yang belum pernah disimpan — dan tersimpan bersama "Simpan Pelengkap".
 *
 * ### Kenapa jumlahnya dibaca dari `foto`, bukan disimpan di state
 *
 * Itu sebab persisnya angka "0 foto" tadi. `foto` datang dari render server dan
 * ikut segar setiap kali data laporan dimuat ulang; angka yang disalin ke state
 * hanya benar sampai unggahan pertama.
 */

export function FotoBarisPelengkap({
  awalan,
  locationId,
  label,
  foto,
  bolehHapus,
  sunyiIzin = false,
}: {
  /** Awalan nama medan, mis. "m0_" — memisahkan foto antarbaris dalam satu form. */
  awalan: string;
  locationId: string;
  /** Nama baris, untuk keterangan tempel. */
  label: string;
  /** Foto yang SUDAH menempel pada baris ini — dari server, bukan state. */
  foto: PhotoView[];
  bolehHapus: boolean;
  /** true = jangan ulangi kotak peringatan izin lokasi (baris ke-2 dst). */
  sunyiIzin?: boolean;
}) {
  const [bukaKantong, setBukaKantong] = useState(false);
  const [kantong, setKantong] = useState<ReadonlySet<string>>(new Set());

  return (
    <div className="space-y-1.5 border-t border-dashed border-border pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-muted">
          Foto {label ? `– ${label}` : "bukti"}
        </span>
        {/* Jumlahnya DISEBUT, termasuk nol: "0 foto" memberi tahu bahwa foto
            memang bisa ditambahkan di sini. */}
        <span className="text-[11px] text-ink-muted">
          {foto.length} foto
          {kantong.size > 0 ? ` · ${kantong.size} dipilih` : ""}
        </span>
      </div>

      {foto.length > 0 ? (
        <PhotoGallery
          photos={foto}
          thumbClass="h-12 w-12"
          canDelete={bolehHapus}
          deleteAction={removeReportPhotoAction}
        />
      ) : null}

      <PhotoSourceInput
        prefix={awalan}
        latName="photoLat"
        lngName="photoLng"
        compact
        sunyiIzin={sunyiIzin}
        ringkas
        slotKetiga={
          <UbinAmbilDariKantong
            ringkas
            onClick={() => setBukaKantong((v) => !v)}
            aktif={bukaKantong}
            jumlahTerpilih={kantong.size}
          />
        }
      />

      {/* Foto kantong belum bisa DITAUTKAN sekarang (baris baru belum punya id),
          tapi bisa DIPILIH sekarang dan ditautkan tepat sesudah barisnya
          tersimpan — sama seperti `kantongPhotoIds` pada item pekerjaan. */}
      {[...kantong].map((id) => (
        <input key={id} type="hidden" name={`${awalan}kantongPhotoIds`} value={id} />
      ))}

      {bukaKantong ? (
        <div className="rounded-md border border-border bg-surface p-2">
          <PemilihKantong locationId={locationId} terpilih={kantong} onUbah={setKantong} />
        </div>
      ) : null}
    </div>
  );
}
