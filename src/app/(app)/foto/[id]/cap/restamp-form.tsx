"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { restampPhotoAction, type RestampState } from "@/lib/photo-restamp/actions";

export type NilaiForm = {
  takenAtLocal: string;
  jamDiketahui: boolean;
  lat: string;
  lng: string;
  locationLabel: string;
  companyName: string;
  reporterName: string;
  categoryName: string;
};

/**
 * Form perbaikan cap (DECISIONS 198). Nilai awalnya adalah hasil AMBIL ULANG
 * dari data terkini — jadi kasus yang paling sering (koordinat lokasi sudah
 * dibetulkan, nama perusahaan berubah) cukup ditekan Simpan tanpa mengetik.
 *
 * Setiap field boleh diubah, tapi tiap perubahan tercatat sebagai "diisi
 * manual" dan waktu/koordinat manual DITANDAI di capnya sendiri. Itu memang
 * disengaja: cap adalah bukti, dan pembacanya berhak tahu mana yang bacaan alat
 * dan mana yang pernyataan manusia.
 */
export function RestampForm({
  photoId,
  awal,
  usulan,
}: {
  photoId: string;
  awal: NilaiForm;
  usulan: NilaiForm;
}) {
  const [state, action, pending] = useAksi<RestampState>(restampPhotoAction, undefined);
  const [v, setV] = useState<NilaiForm>(usulan);
  const set = <K extends keyof NilaiForm>(k: K, val: NilaiForm[K]) => setV((p) => ({ ...p, [k]: val }));
  const berubah = (k: keyof NilaiForm) => v[k] !== awal[k];

  const tanda = (k: keyof NilaiForm) =>
    berubah(k) ? <span className="ml-1 text-[11px] text-warning">· akan tercatat manual</span> : null;

  if (state?.ok) {
    return (
      <div className="space-y-3">
        <Banner tone="success" title={state.ok} />
        <p className="text-sm text-ink-muted">
          Muat ulang halaman galeri untuk melihat versi barunya (URL gambar lama sudah tidak berlaku).
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="photoId" value={photoId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rs-waktu">
            Waktu jepret {tanda("takenAtLocal")}
          </Label>
          <Input
            id="rs-waktu"
            name="takenAt"
            type="datetime-local"
            value={v.takenAtLocal}
            onChange={(e) => set("takenAtLocal", e.target.value)}
          />
          <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              name="jamDiketahui"
              checked={v.jamDiketahui}
              onChange={(e) => set("jamDiketahui", e.target.checked)}
            />
            Jam jepretnya diketahui
          </label>
          {!v.jamDiketahui ? (
            <p className="mt-1 text-[11px] text-ink-faint">
              Tidak dicentang → cap menulis TANGGAL saja, dan tanggalnya diberi warna penanda
              (asal nilai ditandai warna, tidak ditulis).
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="rs-lat">Latitude {tanda("lat")}</Label>
            <Input id="rs-lat" name="lat" value={v.lat} onChange={(e) => set("lat", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rs-lng">Longitude {tanda("lng")}</Label>
            <Input id="rs-lng" name="lng" value={v.lng} onChange={(e) => set("lng", e.target.value)} />
          </div>
          <p className="col-span-2 text-[11px] text-ink-faint">
            Kosongkan keduanya untuk membuang koordinat dari cap. Nilai yang diketik ditandai lewat
            WARNA koordinat di cap – kecuali persis sama dengan titik proyek, yang punya warnanya
            sendiri.
          </p>
        </div>

        <div>
          <Label htmlFor="rs-lokasi">Nama lokasi di cap {tanda("locationLabel")}</Label>
          <Input
            id="rs-lokasi"
            name="locationLabel"
            value={v.locationLabel}
            onChange={(e) => set("locationLabel", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rs-perusahaan">Perusahaan {tanda("companyName")}</Label>
          <Input
            id="rs-perusahaan"
            name="companyName"
            value={v.companyName}
            onChange={(e) => set("companyName", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rs-pelapor">Dilaporkan oleh {tanda("reporterName")}</Label>
          <Input
            id="rs-pelapor"
            name="reporterName"
            value={v.reporterName}
            onChange={(e) => set("reporterName", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rs-kategori">Badge kategori {tanda("categoryName")}</Label>
          <Input
            id="rs-kategori"
            name="categoryName"
            value={v.categoryName}
            onChange={(e) => set("categoryName", e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="rs-alasan">Alasan perbaikan (wajib, tercatat permanen)</Label>
        <Input
          id="rs-alasan"
          name="reason"
          required
          minLength={5}
          maxLength={500}
          placeholder="mis. koordinat lokasi salah saat foto diunggah, sudah dibetulkan"
        />
      </div>

      <Banner
        tone="warning"
        title="Cap lama akan diganti dan tidak bisa dikembalikan"
        description="Foto ber-cap yang sekarang dibuang; berkas ASLI tetap tersimpan, dan nilai cap lama tercatat di riwayat revisi."
      />

      <Button type="submit" loading={pending}>
        Simpan perbaikan cap
      </Button>
    </form>
  );
}
