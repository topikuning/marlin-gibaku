"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import { Badge, Button, buttonClass, type BadgeTone } from "@/components/ui";
import { unggahBerkasTerminAction, type PenagihanState } from "@/lib/penagihan/actions";

/** Satu baris daftar periksa berkas termin (DECISIONS 720). */

export type BarisKlien = {
  kode: string;
  nama: string;
  pemberi: string;
  folder: string;
  status: "ada" | "disiapkan_marlin" | "belum_dibuat" | "belum_diunggah" | "menunggu";
  statusLabel: string;
  /** Untuk berkas yang ada: tautan melihatnya. */
  lihat: { judul: string; href: string } | null;
  /** Tombol unggah (null = tidak bisa diunggah dari sini). */
  unggah: { label: string; judul: string | null } | null;
  /** Untuk surat yang belum dibuat: tautan ke formulir Buat surat. */
  buatHref: string | null;
  /** Keterangan tambahan (mis. "berlaku untuk semua termin"). */
  catatan: string | null;
};

const TONE: Record<BarisKlien["status"], BadgeTone> = {
  ada: "success",
  disiapkan_marlin: "info",
  belum_dibuat: "warning",
  belum_diunggah: "warning",
  menunggu: "neutral",
};

export function BarisBerkas({
  baris,
  packageId,
  terminKe,
}: {
  baris: BarisKlien;
  packageId: string;
  terminKe: number;
}) {
  const [state, action, pending] = useAksi<PenagihanState>(unggahBerkasTerminAction, undefined);
  // Formulir unggah tertutup sendiri begitu unggahan berhasil; dibuka lagi
  // lewat "Unggah lagi". Yang dicatat: hasil aksi saat formulir dibuka.
  const [dibukaPada, setDibukaPada] = useState<PenagihanState | "tutup">("tutup");
  const buka = dibukaPada !== "tutup" && !(state !== dibukaPada && state?.success);
  const bisaUnggah = baris.unggah !== null;

  return (
    <li className="rounded-md border border-border px-3 py-2" data-baris-berkas={baris.kode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[baris.status]}>{baris.statusLabel}</Badge>
            <span className="text-sm font-medium text-ink">{baris.nama}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {baris.pemberi} · Drive: {baris.folder}
            {baris.catatan ? ` · ${baris.catatan}` : ""}
          </div>
          {state?.error ? <div className="mt-1 text-[12px] text-danger">{state.error}</div> : null}
          {state?.success ? <div className="mt-1 text-[12px] text-success">{state.success}</div> : null}
        </div>
        {/* Satu baris aksi = satu gaya tombol (DECISIONS 592/603). */}
        <div className="flex flex-wrap items-center gap-2">
          {baris.lihat ? (
            <a href={baris.lihat.href} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")} title={baris.lihat.judul}>
              Lihat
            </a>
          ) : null}
          {baris.buatHref ? (
            <Link href={baris.buatHref} className={buttonClass("secondary", "sm")}>
              Buat surat
            </Link>
          ) : null}
          {bisaUnggah && !buka ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title={baris.unggah?.judul ?? undefined}
              onClick={() => setDibukaPada(state)}
            >
              <Upload aria-hidden className="size-4" />
              {baris.unggah?.label}
            </Button>
          ) : null}
        </div>
      </div>
      {bisaUnggah && buka ? (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="terminKe" value={terminKe} />
          <input type="hidden" name="kode" value={baris.kode} />
          <input
            type="file"
            name="file"
            aria-label={`Berkas ${baris.nama}`}
            className="min-w-0 max-w-full text-sm"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx"
          />
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Simpan
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDibukaPada("tutup")}>
            Batal
          </Button>
        </form>
      ) : null}
    </li>
  );
}
