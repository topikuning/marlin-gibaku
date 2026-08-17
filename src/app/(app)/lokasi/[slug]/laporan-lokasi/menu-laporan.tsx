"use client";

import { useActionState } from "react";
import { Download, FileSpreadsheet, FileText, Files, HardDriveUpload, MessageCircle, Printer } from "lucide-react";
import { Banner, MenuBerkas, type PilihanBerkas } from "@/components/ui";
import {
  sendDailyReportPdfToWaAction,
  sendPeriodReportToWaAction,
  sendPeriodReportPdfToWaAction,
  sendWeeklyBundleToWaAction,
  type WaActionState,
} from "@/lib/waha/actions";
import {
  uploadDailyReportToDriveAction,
  uploadPeriodReportToDriveAction,
  uploadWeeklyBundleToDriveAction,
  type GDriveActionState,
} from "@/lib/gdrive/actions";

/**
 * Baris aksi laporan: SATU tombol per BERKAS, tujuannya di dalam menu
 * (DECISIONS 334).
 *
 * Sebelumnya lima tombol sejajar yang mencampur dua sumbu — berkas apa (PDF,
 * Excel, berkas mingguan) dan mau diapakan (unduh, WhatsApp, Drive). Sekarang
 * judul tombol = berkasnya, isi menu = tujuannya.
 *
 * Server action-nya PERSIS yang lama, dipanggil lewat `useActionState` dengan
 * `FormData` yang disusun di tempat. Menu ini hanya memindahkan tempat
 * menekannya; bentuk kiriman, validasi, dan gerbang izin di server tidak
 * berubah sama sekali.
 *
 * Syarat yang belum terpenuhi DITULIS, bukan sekadar tombolnya diredupkan
 * ("Paket belum punya grup WA"). Tombol redup tanpa keterangan membuat orang
 * mengira aplikasinya rusak.
 */

export function MenuLaporanPeriodik({
  slug,
  locationId,
  kind,
  n,
  hasGroup,
  hasDrive,
  wahaOn,
  driveOn,
}: {
  slug: string;
  locationId: string;
  kind: "mingguan" | "bulanan";
  n: number;
  hasGroup: boolean;
  hasDrive: boolean;
  wahaOn: boolean;
  driveOn: boolean;
}) {
  const [waPdf, kirimWaPdf, waPdfPending] = useActionState<WaActionState, FormData>(sendPeriodReportPdfToWaAction, undefined);
  const [waXls, kirimWaXls, waXlsPending] = useActionState<WaActionState, FormData>(sendPeriodReportToWaAction, undefined);
  const [drive, kirimDrive, drivePending] = useActionState<GDriveActionState, FormData>(uploadPeriodReportToDriveAction, undefined);
  const [waBundel, kirimWaBundel, waBundelPending] = useActionState<WaActionState, FormData>(sendWeeklyBundleToWaAction, undefined);
  const [driveBundel, kirimDriveBundel, driveBundelPending] = useActionState<GDriveActionState, FormData>(uploadWeeklyBundleToDriveAction, undefined);

  const fdBundel = () => {
    const f = new FormData();
    f.set("locationId", locationId);
    f.set("minggu", String(n));
    return f;
  };

  const fd = () => {
    const f = new FormData();
    f.set("locationId", locationId);
    f.set("kind", kind);
    f.set("n", String(n));
    return f;
  };

  const alasanWa = !wahaOn ? "WhatsApp belum dikonfigurasi" : !hasGroup ? "Paket belum punya grup WA" : null;
  const alasanDrive = !driveOn
    ? "Google Drive belum terhubung"
    : !hasDrive
      ? "Paket belum punya folder Drive"
      : null;

  const pesan = waPdf ?? waXls ?? drive ?? waBundel ?? driveBundel;

  const pdf: PilihanBerkas[] = [
    {
      label: "Unduh",
      icon: <Download aria-hidden className="size-3.5" />,
      href: `/api/laporan/periodik/${slug}/${kind}/${n}/pdf`,
    },
    {
      label: "Buka untuk dicetak",
      icon: <Printer aria-hidden className="size-3.5" />,
      href: `/cetak/periodik/${slug}/${kind}/${n}`,
      hint: "Versi layar dokumen yang sama — lalu Ctrl+P",
    },
    {
      label: "Kirim ke WhatsApp",
      icon: <MessageCircle aria-hidden className="size-3.5" />,
      onSelect: () => kirimWaPdf(fd()),
      disabledReason: alasanWa,
      loading: waPdfPending,
    },
    {
      label: "Upload ke Drive",
      icon: <HardDriveUpload aria-hidden className="size-3.5" />,
      onSelect: () => kirimDrive(fd()),
      disabledReason: alasanDrive,
      hint: "Mengunggah PDF + Excel sekaligus",
      loading: drivePending,
    },
  ];

  const excel: PilihanBerkas[] = [
    {
      label: "Unduh",
      icon: <Download aria-hidden className="size-3.5" />,
      href: `/lokasi/${slug}/laporan-lokasi/export?kind=${kind}&n=${n}`,
    },
    {
      label: "Kirim ke WhatsApp",
      icon: <MessageCircle aria-hidden className="size-3.5" />,
      onSelect: () => kirimWaXls(fd()),
      disabledReason: alasanWa,
      loading: waXlsPending,
    },
    {
      label: "Upload ke Drive",
      icon: <HardDriveUpload aria-hidden className="size-3.5" />,
      onSelect: () => kirimDrive(fd()),
      disabledReason: alasanDrive,
      hint: "Mengunggah PDF + Excel sekaligus",
      loading: drivePending,
    },
  ];

  return (
    <div className="space-y-2">
      {pesan?.error ? <Banner tone="error" title={pesan.error} /> : null}
      {pesan?.success ? <Banner tone="success" title={pesan.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <MenuBerkas
          label={`Laporan ${kind === "mingguan" ? "Mingguan" : "Bulanan"} (PDF)`}
          icon={<FileText aria-hidden className="size-4" />}
          pilihan={pdf}
        />
        <MenuBerkas
          label="Excel"
          icon={<FileSpreadsheet aria-hidden className="size-4" />}
          pilihan={excel}
        />
        {kind === "mingguan" ? (
          <MenuBerkas
            label="7 Laporan Harian (1 berkas)"
            icon={<Files aria-hidden className="size-4" />}
            pilihan={[
              {
                label: "Unduh",
                icon: <Download aria-hidden className="size-3.5" />,
                href: `/api/laporan/mingguan/${slug}/${n}/pdf`,
                hint: "Sampul minggu ini + tujuh blanko harian",
              },
              {
                label: "Kirim ke WhatsApp",
                icon: <MessageCircle aria-hidden className="size-3.5" />,
                onSelect: () => kirimWaBundel(fdBundel()),
                disabledReason: alasanWa,
                loading: waBundelPending,
              },
              {
                label: "Upload ke Drive",
                icon: <HardDriveUpload aria-hidden className="size-3.5" />,
                onSelect: () => kirimDriveBundel(fdBundel()),
                disabledReason: alasanDrive,
                loading: driveBundelPending,
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Menu satu laporan HARIAN pada daftar laporan final. */
export function MenuLaporanHarian({
  slug,
  dateKey,
  hasGroup,
  hasDrive,
  wahaOn,
  driveOn,
  sentAt,
  uploadedAt,
}: {
  slug: string;
  dateKey: string;
  hasGroup: boolean;
  hasDrive: boolean;
  wahaOn: boolean;
  driveOn: boolean;
  sentAt?: string | null;
  uploadedAt?: string | null;
}) {
  const [wa, kirimWa, waPending] = useActionState<WaActionState, FormData>(sendDailyReportPdfToWaAction, undefined);
  const [drive, kirimDrive, drivePending] = useActionState<GDriveActionState, FormData>(uploadDailyReportToDriveAction, undefined);

  const fd = () => {
    const f = new FormData();
    f.set("slug", slug);
    f.set("dateKey", dateKey);
    return f;
  };

  const pesan = wa ?? drive;

  return (
    <span className="inline-flex flex-col gap-1">
      <MenuBerkas
        label="Laporan Harian"
        icon={<FileText aria-hidden className="size-4" />}
        pilihan={[
          {
            label: "Unduh PDF",
            icon: <Download aria-hidden className="size-3.5" />,
            href: `/api/laporan/harian/${slug}/${dateKey}/pdf`,
          },
          {
            label: "Unduh PDF tanpa sampul",
            icon: <Download aria-hidden className="size-3.5" />,
            href: `/api/laporan/harian/${slug}/${dateKey}/pdf?sampul=0`,
            hint: "Untuk yang sudah memegang berkas mingguannya",
          },
          {
            label: "Buka untuk dicetak",
            icon: <Printer aria-hidden className="size-3.5" />,
            href: `/cetak/harian/${slug}/${dateKey}`,
          },
          {
            label: "Kirim ke WhatsApp",
            icon: <MessageCircle aria-hidden className="size-3.5" />,
            onSelect: () => kirimWa(fd()),
            disabledReason: !wahaOn
              ? "WhatsApp belum dikonfigurasi"
              : !hasGroup
                ? "Paket belum punya grup WA"
                : null,
            hint: sentAt ? `Sudah dikirim ${sentAt}` : undefined,
            loading: waPending,
          },
          {
            label: "Upload ke Drive",
            icon: <HardDriveUpload aria-hidden className="size-3.5" />,
            onSelect: () => kirimDrive(fd()),
            disabledReason: !driveOn
              ? "Google Drive belum terhubung"
              : !hasDrive
                ? "Paket belum punya folder Drive"
                : null,
            hint: uploadedAt ? `Sudah diupload ${uploadedAt}` : undefined,
            loading: drivePending,
          },
        ]}
      />
      {pesan?.error ? <span className="text-[12px] text-danger">{pesan.error}</span> : null}
      {pesan?.success ? <span className="text-[12px] text-success">{pesan.success}</span> : null}
    </span>
  );
}
