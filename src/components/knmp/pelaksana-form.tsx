"use client";

import { Banner, Button, HelpText, Input, Label, useAksiKlik } from "@/components/ui";
import { BerkasTtd } from "@/app/(app)/paket/[id]/kontrak/kontrak-forms";
import { JABATAN_PELAKSANA_BAWAAN } from "@/lib/laporan/penandatangan";
import { simpanPelaksana, type PelaksanaActionState } from "@/lib/laporan/pelaksana-actions";

/**
 * PELAKSANA LAPANGAN — formulir yang SAMA untuk paket dan lokasi (DECISIONS 402).
 *
 * Dipakai di dua tempat karena aturannya satu: laporan harian & mingguan diteken
 * Pelaksana Lapangan; lokasi boleh menimpa milik paket kalau pelaksananya
 * berbeda. Dua formulir kembar akan cepat berbeda kata-katanya, dan orang yang
 * membaca dua penjelasan berbeda untuk satu aturan akan menyimpulkan salah satu
 * di antaranya salah.
 */
export function PelaksanaForm({
  sasaran,
  id,
  nama,
  jabatan,
  ttdUrl,
  stempelUrl,
  warisan,
}: {
  sasaran: "paket" | "lokasi";
  id: string;
  nama: string | null;
  jabatan: string | null;
  ttdUrl: string | null;
  stempelUrl: string | null;
  /** Untuk sasaran lokasi: pelaksana paket yang berlaku bila ini dikosongkan. */
  warisan?: { nama: string | null; jabatan: string | null } | null;
}) {
  const [state, kirim, sibuk] = useAksiKlik<PelaksanaActionState>(simpanPelaksana, undefined);

  const lokasi = sasaran === "lokasi";
  const memakaiWarisan = lokasi && !nama;
  // Belum ada pelaksana di mana pun – dokumen akan terbit tanpa nama.
  const kosongTotal = !nama && !(warisan?.nama ?? null) && lokasi;

  return (
    <form
      action={(fd) => kirim(fd)}
      className="space-y-4"
      encType="multipart/form-data"
    >
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="sasaran" value={sasaran} />
      <input type="hidden" name="id" value={id} />

      {kosongTotal ? (
        <Banner
          tone="warning"
          title="Pelaksana Lapangan belum diisi di paket maupun lokasi ini"
          description="Blok tanda tangan laporan harian dan mingguan akan tercetak tanpa nama, untuk ditandatangani tangan. Nama Direktur TIDAK dipakai sebagai pengganti – dokumen resmi tidak boleh menyebut orang yang tidak membuatnya."
        />
      ) : null}

      {memakaiWarisan && warisan?.nama ? (
        <Banner
          tone="info"
          title={`Mengikuti paket: ${warisan.nama}${warisan.jabatan ? ` – ${warisan.jabatan}` : ""}`}
          description="Isi kolom di bawah hanya bila lokasi ini dikerjakan pelaksana yang berbeda."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`pl-nama-${sasaran}`}>Nama Pelaksana Lapangan</Label>
          <Input
            id={`pl-nama-${sasaran}`}
            name="nama"
            defaultValue={nama ?? ""}
            maxLength={150}
            placeholder={lokasi ? "kosongkan = ikut paket" : "mis. Joko Susilo"}
          />
        </div>
        <div>
          <Label htmlFor={`pl-jabatan-${sasaran}`}>Jabatan</Label>
          <Input
            id={`pl-jabatan-${sasaran}`}
            name="jabatan"
            defaultValue={jabatan ?? ""}
            maxLength={120}
            placeholder={JABATAN_PELAKSANA_BAWAAN}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <BerkasTtd
          id={`pl-ttd-${sasaran}`}
          medan="pelaksanaTtdKey"
          label="Tanda tangan"
          url={ttdUrl}
          kelasPratinjau="h-12 w-full"
        />
        <BerkasTtd
          id={`pl-stempel-${sasaran}`}
          medan="pelaksanaStempelKey"
          label="Stempel (opsional)"
          url={stempelUrl}
          kelasPratinjau="size-16"
          catatan="Kosong – memakai stempel perusahaan dari master vendor."
        />
      </div>

      {/*
        Peringatan ini penting justru ketika lokasi MENIMPA paket: nama diambil
        satu blok utuh, jadi lokasi yang menyebut nama sendiri tanpa mengunggah
        tanda tangan akan tercetak tanpa coretan – BUKAN memakai coretan milik
        pelaksana paket. Itu disengaja, dan orang perlu tahu sebelum mencetak.
      */}
      {lokasi && nama && !ttdUrl ? (
        <HelpText>
          Lokasi ini memakai pelaksananya sendiri tetapi belum mengunggah tanda tangan, jadi
          blok TTD-nya tercetak kosong. Tanda tangan milik pelaksana paket sengaja tidak
          dipinjam – coretan seseorang tidak boleh muncul di bawah nama orang lain.
        </HelpText>
      ) : null}

      <HelpText>
        Pindai di kertas PUTIH POLOS, tanpa garis. PNG/JPG/WebP maks 2 MB; gambar dikecilkan
        otomatis ke 800px. Jabatan kosong tercetak sebagai &quot;{JABATAN_PELAKSANA_BAWAAN}&quot;.
      </HelpText>

      <Button type="submit" loading={sibuk}>
        Simpan Pelaksana Lapangan
      </Button>
    </form>
  );
}
