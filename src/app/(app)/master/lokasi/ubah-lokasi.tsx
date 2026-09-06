"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import type { UbahLokasiState } from "@/lib/master-location/actions";
import type { BarisKatalog } from "./lokasi-client";

/**
 * FORM UBAH LOKASI KATALOG + PETA PERKIRAAN LETAKNYA.
 *
 * Permintaan user 2026-09-06, dua kalimat yang jadi satu layar ini:
 * *"di super admin halaman katalog lokasi, bisa edit langsung untuk koordinat,
 * nama, dsb. kalau sudah dipakai kasih warning saja"* dan *"lokasinya diklik
 * muncul edit itu sekalian perkiraan lokasi mapnya"*.
 *
 * Yang dipegang teguh:
 *
 * - Lokasi yang SUDAH dipakai proyek tetap bisa disunting — koordinat salah
 *   tidak berhenti salah karena lokasinya sudah berjalan. Yang muncul
 *   peringatan, bukan gembok, dan peringatannya menyebut apa yang TIDAK ikut
 *   berubah: lokasi proyeknya sendiri.
 * - Peta dua arah. Mengetik enam desimal dari ingatan adalah cara termudah
 *   menaruh kampung nelayan di tengah sawah; menggeser penanda memperlihatkan
 *   salahnya seketika.
 */

// Leaflet menyentuh `window` saat dimuat → wajib client-only.
const PetaTitik = dynamic(() => import("./peta-titik").then((m) => m.PetaTitik), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] w-full animate-pulse rounded-md border border-border bg-surface-muted" />
  ),
});

const angka = (s: string | null): number | null => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function FormUbahLokasi({
  baris,
  aksi,
  onSelesai,
}: {
  baris: BarisKatalog;
  aksi: (prev: UbahLokasiState, fd: FormData) => Promise<UbahLokasiState>;
  onSelesai: () => void;
}) {
  const [state, formAction, pending] = useAksi<UbahLokasiState>(aksi, undefined);
  const [lat, setLat] = useState(baris.latitude ?? "");
  const [lng, setLng] = useState(baris.longitude ?? "");

  const titikLat = angka(lat);
  const titikLng = angka(lng);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={baris.id} />

      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? (
        <Banner
          tone="success"
          title={state.success}
          description={
            <button type="button" onClick={onSelesai} className="font-medium text-primary hover:underline">
              Tutup
            </button>
          }
        />
      ) : null}

      {baris.dipakaiOleh ? (
        <Banner
          tone="warning"
          title={`Lokasi ini sudah dipakai proyek "${baris.dipakaiOleh.name}".`}
          description={
            <>
              Perubahan di sini hanya mengubah KATALOG. Nama, wilayah, dan koordinat lokasi
              proyeknya tidak ikut berubah – ubah di{" "}
              <a href={`/lokasi/${baris.dipakaiOleh.slug}`} className="font-medium text-primary hover:underline">
                halaman lokasi itu
              </a>{" "}
              bila memang keliru di sana juga.
            </>
          }
        />
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-[12px] font-semibold text-ink">Nama & wilayah</legend>
        <div>
          <Label htmlFor="ub-nama">Nama kampung nelayan</Label>
          <Input id="ub-nama" name="name" defaultValue={baris.name ?? ""} maxLength={120} placeholder={baris.village} />
          <p className="mt-1 text-[11px] text-ink-muted">
            Kosongkan bila sama dengan nama desa – daftar akan memakai nama desanya.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="ub-prov">Provinsi *</Label>
            <Input id="ub-prov" name="province" required defaultValue={baris.province} />
          </div>
          <div>
            <Label htmlFor="ub-kab">Kabupaten / Kota *</Label>
            <Input id="ub-kab" name="regency" required defaultValue={baris.regency} />
          </div>
          <div>
            <Label htmlFor="ub-kec">Kecamatan</Label>
            <Input id="ub-kec" name="district" defaultValue={baris.district ?? ""} />
          </div>
          <div>
            <Label htmlFor="ub-desa">Desa / Kelurahan *</Label>
            <Input id="ub-desa" name="village" required defaultValue={baris.village} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[12px] font-semibold text-ink">Koordinat & perkiraan letak</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="ub-lat">Lintang (latitude)</Label>
            <Input
              id="ub-lat"
              name="latitude"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="-6.8150"
            />
          </div>
          <div>
            <Label htmlFor="ub-lng">Bujur (longitude)</Label>
            <Input
              id="ub-lng"
              name="longitude"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="110.6270"
            />
          </div>
        </div>
        <PetaTitik
          lat={titikLat}
          lng={titikLng}
          onPindah={(la, ln) => {
            setLat(String(la));
            setLng(String(ln));
          }}
        />
        <p className="text-[11px] text-ink-muted">
          {titikLat != null && titikLng != null
            ? "Klik peta atau seret penandanya untuk memperbaiki titiknya – kotak di atas ikut terisi."
            : "Belum berkoordinat. Klik di peta untuk menaruh titiknya, atau ketik angkanya."}
          {baris.coordinateStatus ? ` Keterangan dari berkas sumber: ${baris.coordinateStatus}.` : ""}
        </p>
        {titikLat != null && titikLng != null ? (
          <a
            href={`https://www.google.com/maps?q=${titikLat},${titikLng}`}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Buka di Google Maps
          </a>
        ) : null}
      </fieldset>

      {/* Data dari MASTER DATA KNMP yang tidak disunting di sini – ditampilkan
          apa adanya supaya orang tahu isi barisnya tanpa membuka berkas asli. */}
      <fieldset className="space-y-1.5">
        <legend className="text-[12px] font-semibold text-ink">Dari berkas sumber</legend>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          <Fakta label="ID Lokasi" nilai={baris.sourceCode} />
          <Fakta label="Status di sumber" nilai={baris.statusLabel} />
          <Fakta label="Wilayah" nilai={baris.region} />
          <Fakta label="Klaster" nilai={baris.cluster} />
          <Fakta label="Hasil pleno" nilai={baris.plenoResult} />
          <Fakta label="Tahap" nilai={baris.sourceBatch} />
          <Fakta label="Luas lahan (Ha)" nilai={baris.landAreaHa} />
          <Fakta label="Jumlah nelayan" nilai={baris.fishermenCount?.toLocaleString("id-ID") ?? null} />
          <Fakta
            label="Kapal"
            nilai={
              baris.boatsTotal != null
                ? `${baris.boatsTotal.toLocaleString("id-ID")} (${baris.boatsNoEngine ?? 0} tanpa mesin · ${baris.boatsEngine ?? 0} bermesin)`
                : null
            }
          />
          <Fakta
            label="Nilai EE"
            nilai={baris.eeValue ? `Rp ${Number(baris.eeValue).toLocaleString("id-ID")}` : null}
          />
          {baris.candidateVendor ? (
            <Fakta label="Calon penyedia (data lama)" nilai={baris.candidateVendor} />
          ) : null}
        </dl>
      </fieldset>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button type="submit" loading={pending}>
          Simpan perubahan
        </Button>
        <Button type="button" variant="ghost" onClick={onSelesai}>
          Tutup
        </Button>
      </div>
    </form>
  );
}

function Fakta({ label, nilai }: { label: string; nilai: string | null }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={nilai ? "text-ink" : "text-ink-faint"}>{nilai || "–"}</dd>
    </>
  );
}
