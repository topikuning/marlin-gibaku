import { CircleAlert, CircleCheck, CircleDashed, Download, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import type { BarisHarian } from "@/lib/laporan/riwayat-queries";
import { AksiHarian } from "./aksi-harian";

/**
 * SATU BARIS LAPORAN HARIAN FINAL (DECISIONS 406).
 *
 * Urutan isinya mengikuti apa yang ditanyakan orang, bukan urutan kolom di
 * basis data. User 2026-08-21: *"pada laporan harian informasi yang diutamakan
 * adalah apakah sudah diupload ke drive atau ke whatsap."* Karena itu keadaan
 * Drive dan WhatsApp berdiri sendiri sebagai lencana yang terbaca sekali lirik,
 * bukan lagi keterangan kecil yang harus dibuka dari dalam menu satu per satu.
 *
 * "Belum" ditandai WARNING, bukan abu-abu netral. Laporan final yang tidak
 * pernah sampai ke Drive maupun grup adalah pekerjaan yang tidak terhitung oleh
 * yang memeriksa – itu keadaan yang perlu dikerjakan, bukan sekadar keterangan.
 * Di lokasi yang tertib, tidak ada satu pun lencana oranye yang muncul.
 */

function Keping({
  tone,
  icon,
  children,
}: {
  tone: "success" | "warning" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Badge tone={tone} className="gap-1">
      {icon}
      {children}
    </Badge>
  );
}

export function BarisLaporanHarian({
  r,
  slug,
  hasGroup,
  hasDrive,
  wahaOn,
  driveOn,
}: {
  r: BarisHarian;
  slug: string;
  hasGroup: boolean;
  hasDrive: boolean;
  wahaOn: boolean;
  driveOn: boolean;
}) {
  return (
    <li className="grid gap-2 py-3 md:grid-cols-[minmax(11rem,auto)_1fr] xl:grid-cols-[minmax(11rem,auto)_1fr_auto] xl:items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{formatTanggal(r.reportDate, "EEEE, d MMM yyyy")}</p>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          {r.jumlahItem} item
          {r.difinalkan ? (
            <>
              {" · final "}
              {formatTanggalWaktu(r.difinalkan.pada)}
              {r.difinalkan.oleh ? ` · ${r.difinalkan.oleh}` : ""}
            </>
          ) : null}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {r.drive ? (
          <Keping tone="success" icon={<CircleCheck aria-hidden className="size-3.5" />}>
            Drive · {r.drive.berkas} berkas · {formatTanggalWaktu(r.drive.pada)}
          </Keping>
        ) : (
          <Keping tone="warning" icon={<CircleDashed aria-hidden className="size-3.5" />}>
            Belum ke Drive
          </Keping>
        )}
        {r.driveGagal ? (
          <Keping tone="danger" icon={<CircleAlert aria-hidden className="size-3.5" />}>
            Upload terakhir gagal {formatTanggalWaktu(r.driveGagal.pada)}
          </Keping>
        ) : null}
        {r.wa ? (
          <Keping tone="success" icon={<CircleCheck aria-hidden className="size-3.5" />}>
            WhatsApp · {formatTanggalWaktu(r.wa.pada)}
            {r.wa.oleh ? ` · ${r.wa.oleh}` : ""}
          </Keping>
        ) : (
          <Keping tone="warning" icon={<CircleDashed aria-hidden className="size-3.5" />}>
            Belum ke WhatsApp
          </Keping>
        )}
        {/* Hanya muncul kalau ADA catatannya – lihat catatan di riwayat-harian.ts:
            "0x" untuk yang tidak pernah dihitung adalah kebohongan yang rapi. */}
        {r.unduh ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
            <Download aria-hidden className="size-3.5" />
            PDF diunduh {r.unduh.jumlah}x · terakhir {formatTanggalWaktu(r.unduh.pada)}
          </span>
        ) : null}
        {r.drive?.tautan ? (
          <a
            href={r.drive.tautan}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Lihat di Drive
          </a>
        ) : null}
      </div>

      <div className="md:col-span-2 xl:col-span-1">
        <AksiHarian
          slug={slug}
          dateKey={r.dateKey}
          hasGroup={hasGroup}
          hasDrive={hasDrive}
          wahaOn={wahaOn}
          driveOn={driveOn}
          sudahWa={!!r.wa}
          sudahDrive={!!r.drive}
        />
      </div>
    </li>
  );
}
