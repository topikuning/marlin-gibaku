"use client";

import { Banner, Button, HelpText, Input, Label, useAksiKlik } from "@/components/ui";
import { BerkasTtd } from "@/app/(app)/paket/[id]/kontrak/kontrak-forms";
import { JABATAN_PELAKSANA_BAWAAN } from "@/lib/laporan/penandatangan";
import { simpanPelaksana, type PelaksanaActionState } from "@/lib/laporan/pelaksana-actions";

/**
 * PENIMPAAN PELAKSANA LAPANGAN UNTUK SATU LOKASI (DECISIONS 402/404).
 *
 * Hanya untuk LOKASI. Pelaksana tingkat paket diisi bersama PPK, pengawas, dan
 * Direktur di formulir penanda tangan kontrak — keberatan user 2026-08-21:
 * *"kamu terlalu mengistimewakan pelaksana di paket, jadikan saja satu form
 * dengan penginputan ppk pengawas dsb."*
 *
 * Yang tersisa di sini justru yang tidak punya rumah lain: halaman lokasi tidak
 * punya formulir penanda tangan kontrak, karena PPK dan pengawas memang urusan
 * paket. Formulir ini menjawab satu pertanyaan saja — lokasi ini dikerjakan
 * pelaksana yang berbeda atau tidak.
 */
export function PelaksanaForm({
  locationId,
  nama,
  jabatan,
  ttdUrl,
  stempelUsang,
  warisan,
}: {
  locationId: string;
  nama: string | null;
  jabatan: string | null;
  ttdUrl: string | null;
  /** Stempel lama di kotak yang sudah dihapus – hanya untuk diberitahukan. */
  stempelUsang?: string | null;
  /** Pelaksana paket yang berlaku bila lokasi ini dikosongkan. */
  warisan?: { nama: string | null; jabatan: string | null } | null;
}) {
  const [state, kirim, sibuk] = useAksiKlik<PelaksanaActionState>(simpanPelaksana, undefined);

  const memakaiWarisan = !nama;
  // Belum ada pelaksana di mana pun – dokumen akan terbit tanpa nama.
  const kosongTotal = !nama && !(warisan?.nama ?? null);

  return (
    <form
      action={(fd) => kirim(fd)}
      className="space-y-4"
      encType="multipart/form-data"
    >
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="locationId" value={locationId} />

      {kosongTotal ? (
        <Banner
          tone="warning"
          title="Pelaksana Lapangan belum diisi di paket maupun lokasi ini"
          description="Isi di Paket › Kontrak › Penanda tangan dokumen KKP. Sampai itu diisi, blok tanda tangan laporan harian dan mingguan tercetak tanpa nama untuk ditandatangani tangan – nama Direktur TIDAK dipakai sebagai pengganti."
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
          <Label htmlFor="pl-nama-lokasi">Nama Pelaksana Lapangan</Label>
          <Input
            id="pl-nama-lokasi"
            name="nama"
            defaultValue={nama ?? ""}
            maxLength={150}
            placeholder="kosongkan = ikut paket"
          />
        </div>
        <div>
          <Label htmlFor="pl-jabatan-lokasi">Jabatan</Label>
          <Input
            id="pl-jabatan-lokasi"
            name="jabatan"
            defaultValue={jabatan ?? ""}
            maxLength={120}
            placeholder={JABATAN_PELAKSANA_BAWAAN}
          />
        </div>
      </div>

      {/*
        HANYA tanda tangan – tidak ada kotak stempel (DECISIONS 408). Stempel
        milik PERUSAHAAN, dan pelaksana lokasi ini bekerja di perusahaan yang
        sama dengan Direktur yang meneken laporan bulanan. Satu perusahaan, satu
        stempel: diambil dari kontrak, lalu master vendor.
      */}
      <BerkasTtd
        id="pl-ttd-lokasi"
        medan="pelaksanaTtdKey"
        label="Tanda tangan"
        url={ttdUrl}
        kelasPratinjau="h-12 w-full"
      />
      {stempelUsang ? (
        <p className="text-xs text-warning">
          Stempel yang pernah diunggah di sini tidak dipakai lagi – stempel perusahaan diambil
          dari kontrak paket. Berkasnya tidak dihapus.
        </p>
      ) : null}

      {/*
        Peringatan ini penting justru ketika lokasi MENIMPA paket: nama diambil
        satu blok utuh, jadi lokasi yang menyebut nama sendiri tanpa mengunggah
        tanda tangan akan tercetak tanpa coretan – BUKAN memakai coretan milik
        pelaksana paket. Itu disengaja, dan orang perlu tahu sebelum mencetak.
      */}
      {nama && !ttdUrl ? (
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
        Simpan pelaksana lokasi ini
      </Button>
    </form>
  );
}
