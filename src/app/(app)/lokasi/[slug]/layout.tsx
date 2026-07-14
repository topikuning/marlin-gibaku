import Link from "next/link";
import type { ReactNode } from "react";
import { LinkTabs, StatusPill, type LinkTabItem } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";
import { getLocationProgress } from "@/lib/progress";
import { requireLocationPage } from "./get-location";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

// Helper di luar komponen — aturan purity render melarang Date.now() langsung di body.
function remainingDaysUntil(endDate: Date): number {
  return Math.ceil((endDate.getTime() - Date.now()) / DAY_MS);
}

function tabItems(slug: string): LinkTabItem[] {
  const base = `/lokasi/${slug}`;
  return [
    { label: "Ringkasan", href: base, exact: true },
    { label: "Rencana & RAB", href: `${base}/rab` },
    // Tab milik slice lain — link saja, halamannya dibangun terpisah.
    { label: "Pelaksanaan Harian", href: `${base}/harian` },
    { label: "Progress", href: `${base}/progress` },
    { label: "Keuangan", href: `${base}/keuangan` },
    { label: "Dokumen & Kepatuhan", href: `${base}/dokumen` },
    { label: "Laporan", href: `${base}/laporan-lokasi` },
  ];
}

export default async function LokasiLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { location } = await requireLocationPage(slug);
  const progress = await getLocationProgress(location.id);
  const contract = location.package.contract;

  const remainingDays = contract ? remainingDaysUntil(contract.endDate) : null;

  return (
    <div className="space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{location.name}</h1>
          <StatusPill
            tone={LOCATION_STATUS_TONE[location.status]}
            label={LOCATION_STATUS_LABEL[location.status]}
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
          <span>
            {location.village}, {location.regency} — {location.province}
          </span>
          <span aria-hidden>·</span>
          <Link href={`/paket/${location.package.id}`} className="text-primary hover:underline">
            {location.package.name}
          </Link>
          {contract ? (
            <>
              <span aria-hidden>·</span>
              <span>{contract.vendor.name}</span>
              <span aria-hidden>·</span>
              <span className="tabular">Kontrak {formatRupiah(contract.contractValue)} (inkl. PPN)</span>
              <span aria-hidden>·</span>
              <span className="tabular">
                {formatTanggal(contract.startDate)} – {formatTanggal(contract.endDate)}
                {remainingDays != null
                  ? remainingDays >= 0
                    ? ` (sisa ${remainingDays} hari)`
                    : ` (lewat ${-remainingDays} hari)`
                  : null}
              </span>
            </>
          ) : (
            <>
              <span aria-hidden>·</span>
              <span>Belum ada kontrak</span>
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="tabular text-ink-muted">
            Rencana <span className="font-semibold text-ink">{formatPct(progress.planPct)}</span>
          </span>
          <span className="tabular text-ink-muted">
            Realisasi <span className="font-semibold text-ink">{formatPct(progress.realizedPct)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-ink-muted">
            Deviasi <DeltaBadge value={progress.deviationPct} />
          </span>
          <span className="tabular text-ink-muted">
            Minggu {progress.weekNumber}/{progress.totalWeeks}
          </span>
        </div>
      </header>

      <LinkTabs items={tabItems(location.slug)} />

      {children}
    </div>
  );
}
