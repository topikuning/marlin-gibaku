"use client";

import { useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { resetHarianLokasiAction, type ResetHarianState } from "@/lib/reset-harian/actions";
import type { RingkasResetHarian } from "@/lib/reset-harian/service";
import { formatTanggal } from "@/lib/format";

/**
 * Reset seluruh laporan harian lokasi ini – super admin utama saja
 * (DECISIONS 630). Tertutup sampai dibuka; yang akan hilang disebut
 * angkanya SEBELUM tombolnya bisa ditekan, dan nama lokasi harus diketik.
 */
export function ResetHarian({
  locationId,
  namaLokasi,
  ringkas,
}: {
  locationId: string;
  namaLokasi: string;
  ringkas: RingkasResetHarian;
}) {
  const [buka, setBuka] = useState(false);
  const [ketik, setKetik] = useState("");
  const [state, action, pending] = useAksi<ResetHarianState>(resetHarianLokasiAction, undefined);
  const kosong = ringkas.laporan === 0;
  const tgl = (k: string) => formatTanggal(new Date(`${k}T00:00:00Z`), "d MMMM yyyy");

  return (
    <Card className="border-danger-border">
      <CardHeader
        title="Reset laporan harian lokasi ini"
        subtitle="Hanya untuk super admin utama. Seluruh laporan harian lokasi ini akan dihapus TOTAL dan tidak bisa dibatalkan."
      />
      <CardBody className="space-y-3 text-sm">
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
        {state?.error ? <Banner tone="error" title={state.error} /> : null}

        {kosong ? (
          <p className="text-ink-muted">Lokasi ini belum punya laporan harian, jadi tidak ada yang perlu direset.</p>
        ) : !buka ? (
          <Button type="button" variant="danger" size="sm" onClick={() => setBuka(true)}>
            Reset laporan harian…
          </Button>
        ) : (
          <form action={action} className="space-y-3">
            <div className="rounded-md border border-danger-border bg-danger-soft p-3">
              <p className="font-semibold text-ink">Yang akan dihapus permanen:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">
                <li>
                  {ringkas.laporan} laporan harian
                  {ringkas.dari && ringkas.sampai ? ` (${tgl(ringkas.dari)} – ${tgl(ringkas.sampai)})` : ""} –
                  volume, tenaga, material, alat, cuaca, catatan, riwayat status
                </li>
                <li>
                  {ringkas.fotoLaporan} foto laporan, termasuk versi ber-cap, berkas asli, dan salinannya di arsip
                </li>
                <li>
                  {ringkas.temuan} temuan, {ringkas.verifikasi} verifikasi Wakil PPK, dan {ringkas.kendala} kendala yang
                  terkait dengan laporan-laporan itu
                </li>
              </ul>
              <p className="mt-2 text-ink-muted">
                Progres lokasi kembali ke 0% karena dihitung dari laporan harian. RAB, kurva-S rencana, keuangan,
                Kegiatan Lapangan, Foto Cepat yang belum dipasang ke laporan, dan laporan yang sudah terkirim ke WhatsApp/Drive tidak berubah.
              </p>
            </div>
            <input type="hidden" name="locationId" value={locationId} />
            <div>
              <Label htmlFor="reset-harian-konfirmasi" required>
                Ketik nama lokasi <span className="font-semibold">{namaLokasi}</span> untuk konfirmasi
              </Label>
              <Input
                id="reset-harian-konfirmasi"
                name="konfirmasi"
                autoComplete="off"
                value={ketik}
                onChange={(e) => setKetik(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="danger"
                size="sm"
                loading={pending}
                disabled={ketik.trim() !== namaLokasi.trim()}
              >
                Hapus semua laporan harian
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setBuka(false)}>
                Batal
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
