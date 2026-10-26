"use client";

import { useAksi } from "@/lib/aksi-klien";
import { CheckCircle2, MessageCircle, Trash2 } from "lucide-react";
import { Banner, Button, Card, CardBody, CardHeader, Input } from "@/components/ui";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { buangUsulanAction, masukkanUsulanAction, type UsulanState } from "@/lib/wa-usulan/actions";
import type { PhotoView } from "@/lib/photos";

/**
 * USULAN DARI WHATSAPP di halaman laporan harian (DECISIONS 707).
 *
 * Volume dan foto yang dikirim PIC lewat WA berhenti di sini dulu, terpisah
 * dari isi laporan. Pemeriksa membetulkan volumenya bila perlu, lalu
 * Masukkan – atau Buang. Kotak ini sengaja di ATAS formulir laporan: tempat
 * yang memang dibuka orang setiap hari, bukan menu yang harus diingat.
 */

export type UsulanBaris = {
  id: string;
  namaPekerjaan: string;
  satuan: string | null;
  volume: number | null;
  pengusul: string;
  jam: string;
  volumeDiLaporan: number | null;
  masihDiRab: boolean;
  fotos: PhotoView[];
};

const angka = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 3 });

export function UsulanWa({
  usulan,
  bolehPutus,
  alasanTidakBisa,
}: {
  usulan: UsulanBaris[];
  /** Boleh mengisi laporan DAN laporan hari itu masih bisa diubah. */
  bolehPutus: boolean;
  /** Kenapa tombolnya tidak ada, bila `bolehPutus` false. */
  alasanTidakBisa: string | null;
}) {
  if (usulan.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle aria-hidden className="size-4 text-success" />
            Usulan dari WhatsApp ({usulan.length})
          </span>
        }
        subtitle="Belum masuk laporan. Periksa, betulkan volumenya bila perlu, lalu Masukkan."
      />
      <CardBody className="space-y-3">
        {!bolehPutus && alasanTidakBisa ? <Banner tone="info" title={alasanTidakBisa} /> : null}
        <ul className="space-y-3">
          {usulan.map((u) => (
            <BarisUsulan key={u.id} u={u} bolehPutus={bolehPutus} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function BarisUsulan({ u, bolehPutus }: { u: UsulanBaris; bolehPutus: boolean }) {
  const [masukState, masukAction, memasukkan] = useAksi<UsulanState>(masukkanUsulanAction, undefined);
  const [buangState, buangAction, membuang] = useAksi<UsulanState>(buangUsulanAction, undefined);
  const hasil = masukState ?? buangState;
  const sibuk = memasukkan || membuang;

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div>
        <div className="text-sm font-medium text-ink">
          {u.namaPekerjaan}
          {u.satuan ? <span className="font-normal text-ink-muted"> ({u.satuan})</span> : null}
        </div>
        <div className="text-[12px] text-ink-muted">
          Dikirim {u.pengusul} lewat WhatsApp · {u.jam}
          {u.volume != null ? ` · usulan ${angka(u.volume)}${u.satuan ? ` ${u.satuan}` : ""}` : " · foto saja"}
        </div>
        {u.volumeDiLaporan != null ? (
          <div className="mt-1 text-[12px] text-warning">
            Di laporan sekarang: {angka(u.volumeDiLaporan)}
            {u.satuan ? ` ${u.satuan}` : ""}. Masukkan akan menggantinya.
          </div>
        ) : null}
        {!u.masihDiRab ? (
          <div className="mt-1 text-[12px] text-danger">Pekerjaan ini sudah tidak ada di RAB yang berlaku.</div>
        ) : null}
      </div>

      {u.fotos.length > 0 ? <PhotoGallery photos={u.fotos} thumbClass="h-14 w-14" /> : null}

      {hasil?.error ? <Banner tone="error" title={hasil.error} /> : null}
      {hasil?.warning ? <Banner tone="warning" title={hasil.warning} /> : null}
      {hasil?.ok ? <Banner tone="success" title={hasil.ok} /> : null}

      {bolehPutus ? (
        <div className="flex flex-wrap items-end gap-2">
          <form action={masukAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="usulanId" value={u.id} />
            <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
              Volume{u.satuan ? ` (${u.satuan})` : ""}
              <Input
                name="volume"
                inputMode="decimal"
                defaultValue={u.volume != null ? angka(u.volume) : ""}
                placeholder={u.volumeDiLaporan != null ? "kosong = foto saja" : "isi volume"}
                className="h-8 w-28"
                disabled={sibuk || !u.masihDiRab}
              />
            </label>
            <Button type="submit" size="sm" loading={memasukkan} disabled={sibuk || !u.masihDiRab}>
              {memasukkan ? null : <CheckCircle2 aria-hidden className="size-3.5" />}
              Masukkan
            </Button>
          </form>
          <form action={buangAction}>
            <input type="hidden" name="usulanId" value={u.id} />
            <Button type="submit" size="sm" variant="secondary" loading={membuang} disabled={sibuk}>
              {membuang ? null : <Trash2 aria-hidden className="size-3.5" />}
              Buang
            </Button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
