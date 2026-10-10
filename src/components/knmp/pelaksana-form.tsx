"use client";

import { Banner, Button, HelpText, Input, Label, useAksiKlik } from "@/components/ui";
import { BerkasTtd } from "@/app/(app)/paket/[id]/kontrak/kontrak-forms";
import { JABATAN_PELAKSANA_BAWAAN } from "@/lib/laporan/penandatangan";
import { simpanPelaksana, type PelaksanaActionState } from "@/lib/laporan/pelaksana-actions";

/**
 * PENIMPAAN PENANDA TANGAN UNTUK SATU LOKASI (DECISIONS 402/404/409).
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
  warisan,
  pengawasNama,
  pengawasFirma,
  pengawasTtdUrl,
  warisanPengawas,
  wakilSahNama,
  wakilSahNip,
  wakilSahTtdUrl,
  warisanWakilSah,
  koordinatorTlNama,
  koordinatorTlTtdUrl,
  warisanKoordinatorTl,
}: {
  locationId: string;
  nama: string | null;
  jabatan: string | null;
  ttdUrl: string | null;
  /** Pelaksana paket yang berlaku bila lokasi ini dikosongkan. */
  warisan?: { nama: string | null; jabatan: string | null } | null;
  pengawasNama: string | null;
  pengawasFirma: string | null;
  pengawasTtdUrl: string | null;
  /** Pengawas kontrak yang berlaku bila lokasi ini dikosongkan. */
  warisanPengawas?: { nama: string | null; firma: string | null } | null;
  /** Wakil Sah PPK lokasi ini — laporan harian, mingguan, dan Kurva S lokasi (DECISIONS 662). */
  wakilSahNama: string | null;
  wakilSahNip: string | null;
  wakilSahTtdUrl: string | null;
  /** Wakil Sah kontrak yang berlaku bila lokasi ini dikosongkan. */
  warisanWakilSah?: { nama: string | null; nip: string | null } | null;
  /** Koordinator Team Leader lokasi ini (DECISIONS 662) – laporan mingguan & Kurva S lokasi. */
  koordinatorTlNama: string | null;
  koordinatorTlTtdUrl: string | null;
  warisanKoordinatorTl?: { nama: string | null } | null;
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
          description="Isi di Paket › Kontrak › Penanda tangan dokumen KKP. Selama belum diisi, bagian tanda tangan laporan harian tercetak tanpa nama, untuk ditandatangani dengan tangan. Nama Direktur TIDAK dipakai sebagai pengganti."
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


      {/*
        Peringatan ini penting justru ketika lokasi MENIMPA paket: nama diambil
        satu blok utuh, jadi lokasi yang menyebut nama sendiri tanpa mengunggah
        tanda tangan akan tercetak tanpa coretan – BUKAN memakai coretan milik
        pelaksana paket. Itu disengaja, dan orang perlu tahu sebelum mencetak.
      */}
      {nama && !ttdUrl ? (
        <HelpText>
          Lokasi ini memakai pelaksananya sendiri, tetapi tanda tangannya belum diunggah, jadi
          blok TTD-nya tercetak kosong. Tanda tangan pelaksana paket sengaja tidak dipakai, karena
          tanda tangan seseorang tidak boleh muncul di bawah nama orang lain.
        </HelpText>
      ) : null}

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-ink">Konsultan Pengawas</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Isi HANYA bila lokasi ini diperiksa pengawas yang berbeda dari paketnya.
        </p>

        {!pengawasNama && warisanPengawas?.nama ? (
          <Banner
            className="mt-3"
            tone="info"
            title={`Mengikuti paket: ${warisanPengawas.nama}${warisanPengawas.firma ? ` – ${warisanPengawas.firma}` : ""}`}
            description="Kosongkan kolom di bawah supaya tetap mengikuti paket."
          />
        ) : null}

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pw-nama-lokasi">Nama Konsultan Pengawas</Label>
            <Input
              id="pw-nama-lokasi"
              name="pengawasNama"
              defaultValue={pengawasNama ?? ""}
              maxLength={150}
              placeholder="kosongkan = ikut paket"
            />
          </div>
          <div>
            <Label htmlFor="pw-firma-lokasi">Firma pengawas</Label>
            <Input
              id="pw-firma-lokasi"
              name="pengawasFirma"
              defaultValue={pengawasFirma ?? ""}
              maxLength={150}
              placeholder={warisanPengawas?.firma ?? "kosongkan = ikut paket"}
            />
          </div>
        </div>

        <div className="mt-4">
          <BerkasTtd
            id="pw-ttd-lokasi"
            medan="supervisorTtdKey"
            label="Tanda tangan"
            url={pengawasTtdUrl}
            kelasPratinjau="h-12 w-full"
          />
        </div>

        {/*
          Stempel pengawas TIDAK diunggah di sini: ia milik FIRMA, diambil dari
          kontrak (DECISIONS 408). Kalau lokasi ini menyebut firma yang BERBEDA,
          stempel kontrak adalah stempel firma lain — jadi blok stempelnya
          sengaja dikosongkan untuk dibubuhi stempel basah, bukan diisi stempel
          yang salah.
        */}
        {pengawasNama && pengawasFirma && warisanPengawas?.firma &&
        pengawasFirma.trim() !== warisanPengawas.firma.trim() ? (
          <HelpText>
            Firma pengawas lokasi ini berbeda dari paketnya, jadi stempel firma di laporan cetak
            DIKOSONGKAN, karena stempel yang tersimpan milik firma lain. Bubuhkan stempel basah
            pada laporan yang sudah dicetak.
          </HelpText>
        ) : null}

        {pengawasNama && !pengawasTtdUrl ? (
          <HelpText>
            Lokasi ini memakai pengawasnya sendiri, tetapi tanda tangannya belum diunggah, jadi
            blok TTD pengawas tercetak kosong. Tanda tangan pengawas paket sengaja tidak dipakai,
            karena tanda tangan pengawas menyatakan siapa yang memeriksa pekerjaan ini.
          </HelpText>
        ) : null}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-ink">Wakil Sah PPK</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Mengetahui laporan harian, mingguan, dan Kurva S lokasi atas nama KKP. Isi HANYA bila
          Wakil Sah PPK lokasi ini berbeda dari paketnya.
        </p>

        {!wakilSahNama && warisanWakilSah?.nama ? (
          <Banner
            className="mt-3"
            tone="info"
            title={`Mengikuti paket: ${warisanWakilSah.nama}${warisanWakilSah.nip ? ` – NIP. ${warisanWakilSah.nip}` : ""}`}
            description="Kosongkan kolom di bawah supaya tetap mengikuti paket."
          />
        ) : null}

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ws-nama-lokasi">Nama Wakil Sah PPK</Label>
            <Input
              id="ws-nama-lokasi"
              name="wakilSahNama"
              defaultValue={wakilSahNama ?? ""}
              maxLength={150}
              placeholder="kosongkan = ikut paket"
            />
          </div>
          <div>
            <Label htmlFor="ws-nip-lokasi">NIP</Label>
            <Input
              id="ws-nip-lokasi"
              name="wakilSahNip"
              defaultValue={wakilSahNip ?? ""}
              maxLength={60}
              placeholder="opsional"
            />
          </div>
        </div>

        <div className="mt-4">
          <BerkasTtd
            id="ws-ttd-lokasi"
            medan="wakilSahTtdKey"
            label="Tanda tangan"
            url={wakilSahTtdUrl}
            kelasPratinjau="h-12 w-full"
          />
        </div>

        {wakilSahNama && !wakilSahTtdUrl ? (
          <HelpText>
            Lokasi ini memakai Wakil Sah PPK-nya sendiri, tetapi tanda tangannya belum diunggah, jadi
            blok TTD-nya tercetak kosong. Tanda tangan Wakil Sah PPK paket sengaja tidak dipakai.
          </HelpText>
        ) : null}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium text-ink">Koordinator Team Leader</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Memeriksa laporan mingguan dan Kurva S lokasi atas nama konsultan pengawas. Isi HANYA bila
          lokasi ini dikoordinasi orang lain dari yang tercatat di paket.
        </p>

        {!koordinatorTlNama && warisanKoordinatorTl?.nama ? (
          <Banner
            className="mt-3"
            tone="info"
            title={`Mengikuti paket: ${warisanKoordinatorTl.nama}`}
            description="Kosongkan kolom di bawah supaya tetap mengikuti paket."
          />
        ) : null}

        <div className="mt-3">
          <Label htmlFor="kortl-nama-lokasi">Nama Koordinator Team Leader</Label>
          <Input
            id="kortl-nama-lokasi"
            name="koordinatorTlNama"
            defaultValue={koordinatorTlNama ?? ""}
            maxLength={150}
            placeholder="kosongkan = ikut paket"
          />
        </div>

        <div className="mt-4">
          <BerkasTtd
            id="kortl-ttd-lokasi"
            medan="coTeamLeaderTtdKey"
            label="Tanda tangan"
            url={koordinatorTlTtdUrl}
            kelasPratinjau="h-12 w-full"
          />
        </div>

        {koordinatorTlNama && !koordinatorTlTtdUrl ? (
          <HelpText>
            Lokasi ini memakai Koordinator Team Leader-nya sendiri, tetapi tanda tangannya belum
            diunggah, jadi blok TTD-nya tercetak kosong. Tanda tangan dari paket sengaja tidak dipakai.
          </HelpText>
        ) : null}
      </div>

      <HelpText>
        Pindai di kertas PUTIH POLOS, tanpa garis. PNG/JPG/WebP maks 2 MB; gambar dikecilkan
        otomatis ke 800px. Jabatan kosong tercetak sebagai &quot;{JABATAN_PELAKSANA_BAWAAN}&quot;.
      </HelpText>

      <Button type="submit" loading={sibuk}>
        Simpan penanda tangan lokasi ini
      </Button>
    </form>
  );
}
