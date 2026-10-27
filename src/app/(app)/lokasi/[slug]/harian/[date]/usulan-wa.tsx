"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { CheckCircle2, MessageCircle, Trash2 } from "lucide-react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox, Input } from "@/components/ui";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { buangUsulanAction, masukkanUsulanAction, type UsulanState } from "@/lib/wa-usulan/actions";
import type { PhotoView } from "@/lib/photos";

/**
 * USULAN DARI WHATSAPP di halaman laporan harian (DECISIONS 707, 709).
 *
 * Volume dan foto yang dikirim PIC lewat WA berhenti di sini dulu, terpisah
 * dari isi laporan. Pemeriksa membetulkan pekerjaan dan volumenya bila perlu,
 * lalu Masukkan – atau Buang. Kotak ini sengaja di ATAS formulir laporan:
 * tempat yang memang dibuka orang setiap hari, bukan menu yang harus diingat.
 */

export type UsulanBaris = {
  id: string;
  namaPekerjaan: string;
  satuan: string | null;
  volume: number | null;
  pengusul: string;
  jam: string;
  lineageKey: string;
  volumeDiLaporan: number | null;
  masihDiRab: boolean;
  fotos: PhotoView[];
};

/** Satu pekerjaan RAB yang bisa dipilih untuk usulan. */
export type PilihanUsulan = {
  value: string;
  label: string;
  satuan: string | null;
  /** Volume pekerjaan ini yang sudah ada di laporan hari itu. */
  volumeDiLaporan: number | null;
};

const angka = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 3 });

export function UsulanWa({
  usulan,
  pilihan,
  bolehPutus,
  alasanTidakBisa,
}: {
  usulan: UsulanBaris[];
  /** Pekerjaan RAB lokasi ini; kosong bila tidak bisa diputus. */
  pilihan: PilihanUsulan[];
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
        subtitle="Belum masuk laporan. Periksa pekerjaan dan volumenya, betulkan bila perlu, lalu Masukkan."
      />
      <CardBody className="space-y-3">
        {!bolehPutus && alasanTidakBisa ? <Banner tone="info" title={alasanTidakBisa} /> : null}
        <ul className="space-y-3">
          {usulan.map((u) => (
            <BarisUsulan key={u.id} u={u} pilihan={pilihan} bolehPutus={bolehPutus} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function BarisUsulan({ u, pilihan, bolehPutus }: { u: UsulanBaris; pilihan: PilihanUsulan[]; bolehPutus: boolean }) {
  const [masukState, masukAction, memasukkan] = useAksi<UsulanState>(masukkanUsulanAction, undefined);
  const [buangState, buangAction, membuang] = useAksi<UsulanState>(buangUsulanAction, undefined);
  // Pekerjaan hasil pencocokan WA dipakai sebagai awal; yang sudah tidak ada di
  // RAB dikosongkan supaya pemeriksa memilih sendiri (DECISIONS 709).
  const [lineageKey, setLineageKey] = useState(u.masihDiRab ? u.lineageKey : "");
  const hasil = masukState ?? buangState;
  const sibuk = memasukkan || membuang;

  const terpilih = pilihan.find((p) => p.value === lineageKey) ?? null;
  const diganti = lineageKey !== "" && lineageKey !== u.lineageKey;
  // Angka usulan tetap dipakai apa adanya; satuannya mengikuti pekerjaan yang dipilih.
  const satuan = bolehPutus ? (terpilih?.satuan ?? null) : u.satuan;
  const volumeDiLaporan = bolehPutus ? (terpilih?.volumeDiLaporan ?? null) : u.volumeDiLaporan;

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div>
        <div className="text-sm font-medium text-ink">
          {u.namaPekerjaan}
          {u.satuan ? <span className="font-normal text-ink-muted"> ({u.satuan})</span> : null}
        </div>
        <div className="text-[12px] text-ink-muted">
          Dikirim {u.pengusul} lewat WhatsApp · {u.jam}
          {u.volume != null ? ` · usulan ${angka(u.volume)}` : " · foto saja"}
        </div>
        {!u.masihDiRab && !diganti ? (
          <div className="mt-1 text-[12px] text-danger">
            Pekerjaan ini sudah tidak ada di RAB yang berlaku.
            {bolehPutus ? " Pilih pekerjaan lain, atau Buang." : ""}
          </div>
        ) : null}
      </div>

      {u.fotos.length > 0 ? <PhotoGallery photos={u.fotos} thumbClass="h-14 w-14" /> : null}

      {hasil?.error ? <Banner tone="error" title={hasil.error} /> : null}
      {hasil?.warning ? <Banner tone="warning" title={hasil.warning} /> : null}
      {hasil?.ok ? <Banner tone="success" title={hasil.ok} /> : null}

      {bolehPutus ? (
        <form action={masukAction} className="space-y-2">
          <input type="hidden" name="usulanId" value={u.id} />
          <div>
            <label htmlFor={`usulan-pekerjaan-${u.id}`} className="text-[12px] text-ink-muted">
              Pekerjaan
            </label>
            <Combobox
              id={`usulan-pekerjaan-${u.id}`}
              name="lineageKey"
              value={lineageKey}
              onChange={setLineageKey}
              options={pilihan.map((p) => ({ value: p.value, label: p.label }))}
              placeholder="Pilih pekerjaan…"
              disabled={sibuk}
              searchThreshold={0}
            />
            {diganti ? (
              <div className="mt-1 text-[12px] text-ink-muted">
                Diganti dari usulan WA: {u.namaPekerjaan}
                {u.satuan ? ` (${u.satuan})` : ""}.
              </div>
            ) : null}
          </div>
          {volumeDiLaporan != null ? (
            <div className="text-[12px] text-warning">
              Di laporan sekarang: {angka(volumeDiLaporan)}
              {satuan ? ` ${satuan}` : ""}. Masukkan akan menggantinya.
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
              Volume{satuan ? ` (${satuan})` : ""}
              <Input
                name="volume"
                inputMode="decimal"
                defaultValue={u.volume != null ? angka(u.volume) : ""}
                placeholder={volumeDiLaporan != null ? "kosong = foto saja" : "isi volume"}
                className="h-8 w-28"
                disabled={sibuk}
              />
            </label>
            <Button type="submit" size="sm" loading={memasukkan} disabled={sibuk || lineageKey === ""}>
              {memasukkan ? null : <CheckCircle2 aria-hidden className="size-3.5" />}
              Masukkan
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={membuang}
              disabled={sibuk}
              formAction={buangAction}
            >
              {membuang ? null : <Trash2 aria-hidden className="size-3.5" />}
              Buang
            </Button>
          </div>
        </form>
      ) : volumeDiLaporan != null ? (
        <div className="text-[12px] text-ink-muted">
          Di laporan sekarang: {angka(volumeDiLaporan)}
          {satuan ? ` ${satuan}` : ""}.
        </div>
      ) : null}
    </li>
  );
}
