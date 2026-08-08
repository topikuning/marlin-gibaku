"use client";

import { useActionState, useState } from "react";
import { Camera } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { addSupplyPhotosAction, type DailyActionState } from "@/lib/daily-report/actions";
import { tahanGagalKirim } from "@/lib/aksi-klien";
import type { WorkspaceReport } from "@/lib/daily-report/queries";

/**
 * Foto bukti untuk MATERIAL MASUK & PERALATAN (DECISIONS 304).
 *
 * Kebutuhan lapangan user 2026-08-08: laporan harian bukan cuma item pekerjaan
 * — material dan alat juga perlu dibuktikan, masing-masing barisnya sendiri.
 *
 * ### Kenapa blok TERPISAH, bukan tombol di dalam form pelengkap
 *
 * Form pelengkap adalah satu `<form>`, dan `<form>` di dalam `<form>` bukan
 * HTML yang sah — browser akan membuang yang di dalam, dan tombolnya jadi
 * tombol yang diam saja saat ditekan. Jadi panel foto berdiri sendiri di bawah
 * form itu.
 *
 * Efek sampingnya justru jujur: yang muncul di sini HANYA baris yang SUDAH
 * tersimpan, karena ID barisnya memang baru ada sesudah disimpan. Baris yang
 * baru diketik tidak muncul, dan alasannya dikatakan — bukan dibiarkan jadi
 * teka-teki.
 */
const kirimFoto = tahanGagalKirim(addSupplyPhotosAction);

type Baris = { id: string; label: string; jumlah: string; foto: number };

export function SupplyPhotos({
  report,
  photoEnabled,
}: {
  report: WorkspaceReport;
  /** false = laporan sudah dikirim; foto tidak bisa ditambah lagi. */
  photoEnabled: boolean;
}) {
  const material: Baris[] = report.materials.map((m) => ({
    id: m.id,
    label: m.name,
    jumlah: m.qty != null ? `${m.qty}${m.unit ? ` ${m.unit}` : ""}` : "—",
    foto: m.photos.length,
  }));
  const alat: Baris[] = report.equipment.map((e) => ({
    id: e.id,
    label: e.name,
    jumlah: `${e.count} unit`,
    foto: e.photos.length,
  }));

  if (material.length === 0 && alat.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold text-ink">Foto material & alat</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Dicetak di halaman tersendiri pada laporan KKP, sesudah foto pekerjaan. Baris yang baru
          diketik belum muncul di sini — simpan pelengkap dulu.
        </p>
      </div>
      {material.length > 0 ? (
        <Grup judul="Material masuk" jenis="material" baris={material} report={report} aktif={photoEnabled} />
      ) : null}
      {alat.length > 0 ? (
        <Grup judul="Peralatan" jenis="alat" baris={alat} report={report} aktif={photoEnabled} />
      ) : null}
    </section>
  );
}

function Grup({
  judul,
  jenis,
  baris,
  report,
  aktif,
}: {
  judul: string;
  jenis: "material" | "alat";
  baris: Baris[];
  report: WorkspaceReport;
  aktif: boolean;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[13px] font-medium text-ink">{judul}</h3>
      <ul className="space-y-1.5">
        {baris.map((b) => (
          <li key={b.id}>
            <BarisFoto baris={b} jenis={jenis} reportId={report.id} aktif={aktif} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarisFoto({
  baris,
  jenis,
  reportId,
  aktif,
}: {
  baris: Baris;
  jenis: "material" | "alat";
  reportId: string;
  aktif: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    kirimFoto,
    undefined,
  );

  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[13px] font-medium text-ink">{baris.label}</span>
          <span className="ml-2 text-xs text-ink-muted">{baris.jumlah}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Jumlah foto DISEBUT apa adanya — "0 foto" adalah keterangan yang
              berguna, bukan sesuatu yang perlu disembunyikan. */}
          <span className="text-xs text-ink-muted">{baris.foto} foto</span>
          {aktif ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setBuka((v) => !v)}>
              <Camera aria-hidden className="size-4" />
              {buka ? "Tutup" : "Tambah foto"}
            </Button>
          ) : null}
        </div>
      </div>

      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? (
        <Banner tone="warning" title="Sebagian foto gagal" description={state.warning} />
      ) : null}

      {buka && aktif ? (
        <form action={formAction} className="mt-2 space-y-2" aria-label={`Tambah foto ${baris.label}`}>
          <input type="hidden" name="reportId" value={reportId} />
          <input type="hidden" name="jenis" value={jenis} />
          <input type="hidden" name="barisId" value={baris.id} />
          <PhotoSourceInput latName="photoLat" lngName="photoLng" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={pending}>
              Simpan foto
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setBuka(false)}>
              Batal
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
