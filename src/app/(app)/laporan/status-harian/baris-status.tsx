"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, ExternalLink, FileText, UploadCloud } from "lucide-react";
import { Banner, Button, ConfirmSubmit, StatusPill } from "@/components/ui";
import { uploadDailyReportToDriveAction } from "@/lib/gdrive/actions";
import { sendDailyRingkasToWaAction, type WaActionState } from "@/lib/waha/actions";
import type { GDriveActionState } from "@/lib/gdrive/actions";
import type { StatusHarianRow } from "@/lib/daily-report/status-harian";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import { formatTanggalWaktu } from "@/lib/format";

/**
 * Satu baris papan status + tindakannya (DECISIONS 262).
 *
 * Tindakan menempel di barisnya sendiri: unggah ke Drive dan kirim ringkasan ke
 * grup WA. Keduanya form terpisah — form HTML tidak boleh bersarang, dan
 * hasilnya juga harus terpisah supaya "unggah berhasil" tidak terbaca sebagai
 * "sudah dikirim ke grup".
 *
 * Prasyarat yang belum terpenuhi (paket tanpa folder Drive / tanpa grup WA)
 * DIKATAKAN di tempat tombolnya berada, bukan dibiarkan jadi kegagalan setelah
 * diklik.
 */
export function BarisStatus({ row, dateKey }: { row: StatusHarianRow; dateKey: string }) {
  const [drive, aksiDrive] = useActionState<GDriveActionState, FormData>(
    uploadDailyReportToDriveAction,
    undefined,
  );
  const [wa, aksiWa] = useActionState<WaActionState, FormData>(
    sendDailyRingkasToWaAction,
    undefined,
  );

  const adaIsi = row.itemCount > 0 || row.kegiatanCount > 0 || row.fotoCount > 0;
  const isi = [
    row.itemCount > 0 ? `${row.itemCount} item` : null,
    row.fotoCount > 0 ? `${row.fotoCount} foto` : null,
    row.kegiatanCount > 0
      ? `${row.kegiatanCount} kegiatan${row.kegiatanFotoCount > 0 ? ` (${row.kegiatanFotoCount} foto)` : ""}`
      : null,
  ].filter(Boolean);

  return (
    <div className="px-4 py-3">
      {/*
        `min-w-0` di KEDUA kolom, dan kolom aksi TIDAK `shrink-0`.
        Sebelumnya kolom aksi memakai `shrink-0` sambil memuat kalimat panjang
        ("Paket belum punya folder Drive", "Paket belum punya grup WA"), jadi ia
        menolak menyempit dan mendorong SELURUH halaman jadi 526px di layar
        390px — halaman bisa digeser ke samping dan nama lokasinya terpotong di
        kiri (laporan user 2026-08-06). Di ponsel kolom aksi turun ke barisnya
        sendiri selebar penuh; di layar lebar ia kembali ke kanan.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/lokasi/${row.slug}/harian/${dateKey}`}
              className="font-semibold text-ink hover:underline"
            >
              {row.locationName}
            </Link>
            {row.status ? (
              <StatusPill
                tone={REPORT_STATUS_TONE[row.status]}
                label={REPORT_STATUS_LABEL[row.status]}
              />
            ) : (
              <StatusPill tone="neutral" label="Belum ada laporan" />
            )}
          </div>
          {/* Kabupaten ikut: nama desa berulang antar kabupaten, dan baris ini
              tidak punya kolom wilayah sendiri (permintaan user 2026-08-06). */}
          <p className="mt-0.5 truncate text-[13px] text-ink-muted">
            {row.regency} · {row.packageName}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {isi.length > 0 ? isi.join(" · ") : "belum ada isi yang dicatat"}
          </p>

          {/* Jejak Drive & WA sebagai KETERANGAN, bukan cuma warna tombol. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {row.drive.status === "sukses" ? (
              <span className="text-success">
                Drive: {row.drive.fileSukses} berkas
                {row.drive.at ? ` · ${formatTanggalWaktu(row.drive.at)}` : ""}
              </span>
            ) : row.drive.status === "gagal" ? (
              <span className="inline-flex items-center gap-1 text-danger">
                <AlertTriangle aria-hidden className="size-3" />
                Drive: percobaan terakhir GAGAL
                {row.drive.error ? ` — ${row.drive.error}` : ""}
              </span>
            ) : (
              <span className="text-ink-faint">Drive: belum diunggah</span>
            )}
            {row.waSentAt ? (
              <span className="text-success">WA: terkirim {formatTanggalWaktu(row.waSentAt)}</span>
            ) : (
              <span className="text-ink-faint">WA: belum dikirim</span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:basis-auto">
          <Link
            href={`/api/laporan/harian/${row.slug}/${dateKey}/ringkas`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
          >
            <FileText aria-hidden className="size-3.5" />
            Ringkasan PDF
          </Link>

          {row.drive.webLink ? (
            <Link
              href={row.drive.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
            >
              <ExternalLink aria-hidden className="size-3.5" />
              Buka Drive
            </Link>
          ) : null}

          <form action={aksiDrive}>
            <input type="hidden" name="slug" value={row.slug} />
            <input type="hidden" name="dateKey" value={dateKey} />
            <TombolDrive siap={row.driveFolderId != null} adaIsi={adaIsi} ulang={row.drive.status === "sukses"} />
          </form>

          <form action={aksiWa}>
            <input type="hidden" name="slug" value={row.slug} />
            <input type="hidden" name="dateKey" value={dateKey} />
            <TombolWa
              siap={row.waGroupId != null}
              adaIsi={adaIsi}
              nama={row.locationName}
              status={row.status}
              sudah={row.waSentAt != null}
            />
          </form>
        </div>
      </div>

      {drive?.error ? <Banner tone="error" title={drive.error} className="mt-2" /> : null}
      {drive?.success ? <Banner tone="success" title={drive.success} className="mt-2" /> : null}
      {wa?.error ? <Banner tone="error" title={wa.error} className="mt-2" /> : null}
      {wa?.success ? <Banner tone="success" title={wa.success} className="mt-2" /> : null}
    </div>
  );
}

function TombolDrive({
  siap,
  adaIsi,
  ulang,
}: {
  siap: boolean;
  adaIsi: boolean;
  ulang: boolean;
}) {
  const { pending } = useFormStatus();
  if (!siap) {
    return (
      <span className="min-w-0 text-xs text-ink-faint">Paket belum punya folder Drive</span>
    );
  }
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending} disabled={!adaIsi}>
      <UploadCloud aria-hidden className="size-3.5" />
      {ulang ? "Unggah ulang" : "Unggah ke Drive"}
    </Button>
  );
}

function TombolWa({
  siap,
  adaIsi,
  nama,
  status,
  sudah,
}: {
  siap: boolean;
  adaIsi: boolean;
  nama: string;
  status: StatusHarianRow["status"];
  sudah: boolean;
}) {
  const { pending } = useFormStatus();
  if (!siap) {
    return <span className="min-w-0 text-xs text-ink-faint">Paket belum punya grup WA</span>;
  }
  if (!adaIsi) {
    return <span className="min-w-0 text-xs text-ink-faint">Belum ada yang bisa dikirim</span>;
  }
  // Status BUKAN pagar (keputusan user 2026-08-05) — tapi konfirmasinya
  // menyebutkannya, supaya mengirim draf ke grup PPK adalah pilihan sadar.
  const belumFinal = status !== "final";
  const peringatan = belumFinal
    ? status
      ? ` Laporan ini berstatus "${REPORT_STATUS_LABEL[status]}" — belum dikunci, dan status itu ikut tercetak di halaman pertama PDF.`
      : " Belum ada laporan harian untuk tanggal ini; yang terkirim hanya kegiatan lapangan dan fotonya."
    : "";
  return (
    <ConfirmSubmit
      label={sudah ? "Kirim ulang ke WA" : "Kirim ke grup WA"}
      variant="secondary"
      title={`Kirim ringkasan ${nama} ke grup WhatsApp?`}
      description={
        `Pesan dan berkas PDF langsung masuk ke grup paket (PPK, dinas, pejabat) dan tidak bisa ditarik kembali.${peringatan}` +
        (sudah ? " Ringkasan tanggal ini SUDAH pernah dikirim." : "")
      }
      confirmLabel="Ya, kirim sekarang"
      loading={pending}
    />
  );
}
