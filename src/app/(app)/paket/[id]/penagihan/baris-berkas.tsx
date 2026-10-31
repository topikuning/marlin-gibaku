"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import { Badge, Button, buttonClass, type BadgeTone } from "@/components/ui";
import { unggahBerkasTerminAction, type PenagihanState } from "@/lib/penagihan/actions";

/** Satu baris daftar periksa berkas termin (DECISIONS 720/725). */

type StatusKlien = "ada" | "sebagian" | "disiapkan_marlin" | "belum_dibuat" | "belum_diunggah" | "menunggu";
type BerkasKlien = { judul: string; href: string };

export type BarisKlien = {
  kode: string;
  nama: string;
  pemberi: string;
  folder: string;
  status: StatusKlien;
  statusLabel: string;
  /** SEMUA berkas yang memenuhi butir (untuk butir paket). */
  berkas: (BerkasKlien & { lokasi: string | null })[];
  /** Per lokasi aktif untuk butir yang satu per lokasi; null untuk butir paket. */
  lokasi:
    | {
        locationId: string;
        nama: string;
        status: StatusKlien;
        statusLabel: string;
        berkas: BerkasKlien[];
      }[]
    | null;
  /** Berkas yang berlaku untuk seluruh paket pada butir per lokasi. */
  berkasPaket: BerkasKlien[];
  /** Tombol unggah (null = tidak bisa diunggah dari sini). */
  unggah: { label: string; judul: string | null } | null;
  /** Untuk surat yang belum dibuat: tautan ke formulir Buat surat. */
  buatHref: string | null;
  /** Keterangan tambahan (mis. "berlaku untuk semua termin"). */
  catatan: string | null;
  /** Butir duplikat: butir utama yang sudah mencakupnya. */
  cukupDi: { kode: string; nama: string } | null;
};

const TONE: Record<StatusKlien, BadgeTone> = {
  ada: "success",
  sebagian: "warning",
  disiapkan_marlin: "info",
  belum_dibuat: "warning",
  belum_diunggah: "warning",
  menunggu: "neutral",
};

/** Tautan ke setiap berkas – satu butir bisa berisi banyak berkas. */
function DaftarBerkas({ berkas }: { berkas: (BerkasKlien & { lokasi?: string | null })[] }) {
  if (berkas.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
      {berkas.map((b) => (
        <li key={b.href} className="min-w-0 max-w-full">
          <a href={b.href} target="_blank" rel="noopener" className="break-all text-primary underline underline-offset-2">
            {b.judul}
          </a>
          {b.lokasi ? <span className="text-ink-muted"> · {b.lokasi}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tombol unggah + formulirnya. `locationId` diisi untuk unggahan satu lokasi
 * pada butir per lokasi; kosong = berkas untuk seluruh paket.
 */
function Unggah({
  packageId,
  terminKe,
  kode,
  nama,
  label,
  judul,
  locationId,
}: {
  packageId: string;
  terminKe: number;
  kode: string;
  nama: string;
  label: string;
  judul: string | null;
  locationId?: string;
}) {
  const [state, action, pending] = useAksi<PenagihanState>(unggahBerkasTerminAction, undefined);
  // Formulir tertutup sendiri begitu unggahan berhasil; dibuka lagi lewat tombolnya.
  const [dibukaPada, setDibukaPada] = useState<PenagihanState | "tutup">("tutup");
  const buka = dibukaPada !== "tutup" && !(state !== dibukaPada && state?.success);
  return (
    <div className="min-w-0">
      {buka ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="terminKe" value={terminKe} />
          <input type="hidden" name="kode" value={kode} />
          {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}
          <input
            type="file"
            name="file"
            multiple
            aria-label={`Berkas ${nama}`}
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
      ) : (
        <Button type="button" size="sm" variant="secondary" title={judul ?? undefined} onClick={() => setDibukaPada(state)}>
          <Upload aria-hidden className="size-4" />
          {label}
        </Button>
      )}
      {state?.error ? <div className="mt-1 text-[12px] text-danger">{state.error}</div> : null}
      {state?.success ? <div className="mt-1 text-[12px] text-success">{state.success}</div> : null}
    </div>
  );
}

export function BarisBerkas({ baris, packageId, terminKe }: { baris: BarisKlien; packageId: string; terminKe: number }) {
  if (baris.cukupDi) {
    return (
      <li className="rounded-md border border-dashed border-border px-3 py-2" data-baris-berkas={baris.kode}>
        <div className="flex flex-wrap items-center gap-2">
          {/* Badge pendek: nama butir utama yang panjang terpotong di layar HP. */}
          <Badge tone="neutral">Cukup di butir {baris.cukupDi.kode}</Badge>
          <span className="min-w-0 text-sm text-ink-muted">{baris.nama}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-ink-muted">
          Berkas termin yang sudah lolos tidak mengulang folder ini; isinya cukup di butir {baris.cukupDi.nama}.
        </div>
      </li>
    );
  }
  const umum = { packageId, terminKe, kode: baris.kode, nama: baris.nama };
  return (
    <li className="rounded-md border border-border px-3 py-2" data-baris-berkas={baris.kode}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[baris.status]}>{baris.statusLabel}</Badge>
            <span className="text-sm font-medium text-ink">{baris.nama}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {baris.pemberi} · Drive: {baris.folder}
            {baris.catatan ? ` · ${baris.catatan}` : ""}
          </div>
          {baris.lokasi ? null : <DaftarBerkas berkas={baris.berkas} />}
        </div>
        {/* Satu baris aksi = satu gaya tombol (DECISIONS 592/603). */}
        <div className="flex flex-wrap items-center gap-2">
          {baris.buatHref ? (
            <Link href={baris.buatHref} className={buttonClass("secondary", "sm")}>
              Buat surat
            </Link>
          ) : null}
          {baris.unggah && !baris.lokasi ? <Unggah {...umum} label={baris.unggah.label} judul={baris.unggah.judul} /> : null}
        </div>
      </div>

      {baris.lokasi ? (
        <ul className="mt-2 space-y-1.5 border-t border-border pt-2" data-per-lokasi>
          {baris.berkasPaket.length ? (
            <li className="text-[12px] text-ink-muted">
              Untuk seluruh paket:
              <DaftarBerkas berkas={baris.berkasPaket} />
            </li>
          ) : null}
          {baris.lokasi.map((l) => (
            <li key={l.locationId} className="flex flex-wrap items-start justify-between gap-2" data-lokasi={l.nama}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{l.nama}</span>
                  <Badge tone={TONE[l.status]}>{l.statusLabel}</Badge>
                </div>
                <DaftarBerkas berkas={l.berkas} />
              </div>
              {baris.unggah ? (
                <Unggah
                  {...umum}
                  locationId={l.locationId}
                  label={l.berkas.length ? "Unggah lagi" : baris.unggah.label}
                  judul={baris.unggah.judul}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
