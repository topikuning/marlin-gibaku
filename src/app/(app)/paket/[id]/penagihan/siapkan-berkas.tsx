"use client";

import Link from "next/link";
import { ExternalLink, FolderUp } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Input, Label, buttonClass } from "@/components/ui";
import { siapkanBerkasTerminAction, type PenagihanState } from "@/lib/penagihan/actions";

/** Surat penyedia termin ini, untuk tombol Siapkan berkas (DECISIONS 724). */
export type SuratTerminKlien =
  | { jenis: string; nama: string; ada: true; keterangan: string }
  | { jenis: string; nama: string; ada: false; tanggalAwal: string };

/** Tombol "Siapkan berkas Termin n" (DECISIONS 721/724). */
export function SiapkanBerkasTermin({
  packageId,
  terminKe,
  ulang,
  folderDrive,
  surat,
  bolehBuatSurat,
}: {
  packageId: string;
  terminKe: number;
  /** Sudah pernah disiapkan: labelnya "Siapkan ulang". */
  ulang: boolean;
  /** Alamat folder Drive paket, bila ada. */
  folderDrive: string | null;
  surat: SuratTerminKlien[];
  /** Izin kelola kontrak: surat yang belum ada ikut dibuat. */
  bolehBuatSurat: boolean;
}) {
  const [state, action, pending] = useAksi<PenagihanState>(siapkanBerkasTerminAction, undefined);
  const belum = surat.filter((s) => !s.ada);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="terminKe" value={terminKe} />

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-ink">Surat penyedia termin ini</p>
        <ul className="space-y-1 text-[13px] text-ink-muted">
          {surat
            .filter((s) => s.ada)
            .map((s) => (
              <li key={s.jenis}>
                <span className="text-ink">{s.nama}</span> · {s.ada ? s.keterangan : ""}
              </li>
            ))}
        </ul>
        {belum.length > 0 ? (
          bolehBuatSurat ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                {belum.map((s) =>
                  s.ada ? null : (
                    <div key={s.jenis}>
                      <Label htmlFor={`tanggal_${s.jenis}`}>{s.nama}</Label>
                      <Input
                        id={`tanggal_${s.jenis}`}
                        name={`tanggal_${s.jenis}`}
                        type="date"
                        defaultValue={s.tanggalAwal}
                      />
                    </div>
                  ),
                )}
              </div>
              <p className="text-[12px] text-ink-muted">
                Surat di atas dibuat saat tombol ditekan, dengan nomor otomatis dari pola nomor perusahaan. Tanggal awalnya
                mengikuti urutan alur KKP: permohonan pemeriksaan (atau hari ini bila belum ada), BA sehari sesudahnya, surat
                pembayaran dua hari sesudahnya. Ubah sesuai kenyataan. Surat yang sudah ada tidak diubah.
              </p>
            </>
          ) : (
            <p className="text-[12px] text-ink-muted">
              {belum.length} surat belum dibuat. Pembuatannya perlu izin kelola kontrak; berkas lain tetap disiapkan.
            </p>
          )
        ) : null}
      </div>

      {state?.error ? (
        <Banner
          tone="error"
          title={state.judul ?? state.error}
          description={
            state.kurang?.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {state.kurang.map((k) => (
                  <li key={k.teks}>
                    {k.teks} – isi di{" "}
                    <Link href={k.href} className="font-medium text-primary underline underline-offset-2">
                      {k.tempat}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : undefined
          }
          action={
            state.tautan ? (
              <Link href={state.tautan.href} className={buttonClass("secondary", "sm")}>
                {state.tautan.teks}
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          <FolderUp aria-hidden className="size-4" />
          {ulang ? `Siapkan ulang berkas Termin ${terminKe}` : `Siapkan berkas Termin ${terminKe}`}
        </Button>
        {folderDrive ? (
          <a href={folderDrive} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            <ExternalLink aria-hidden className="size-4" />
            Buka folder Drive
          </a>
        ) : null}
      </div>
    </form>
  );
}
