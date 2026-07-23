import Link from "next/link";
import type { ReactNode } from "react";
import { LinkTabs, StatusPill, type LinkTabItem } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { cn } from "@/lib/cn";
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
    { label: "Kegiatan Lapangan", href: `${base}/kegiatan` },
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

  const remainingDays = contract?.endDate ? remainingDaysUntil(contract.endDate) : null;

  return (
    <div className="space-y-4">
      {/* Header proyek terstruktur (audit UI #5): identitas + stat berlabel dalam
          kartu, bukan satu baris teks datar — informasi lebih cepat dipindai. */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-ink">{location.name}</h1>
              <StatusPill
                tone={LOCATION_STATUS_TONE[location.status]}
                label={LOCATION_STATUS_LABEL[location.status]}
              />
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              {location.village}, {location.regency} — {location.province}
            </p>
          </div>
          <div className="text-right text-[13px]">
            <Link href={`/paket/${location.package.id}`} className="font-medium text-primary hover:underline">
              {location.package.name}
            </Link>
            {contract ? <p className="text-ink-muted">{contract.vendor.name}</p> : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
          <StatCell label="Nilai kontrak">
            {contract ? (
              <span className="tabular">{formatRupiah(contract.contractValue)}</span>
            ) : (
              <span className="text-ink-faint">—</span>
            )}
            {contract ? <span className="ml-1 text-[11px] font-normal text-ink-faint">inkl. PPN</span> : null}
          </StatCell>
          <StatCell label="Periode kontrak">
            {contract?.startDate && contract.endDate ? (
              <span className="tabular text-[13px]">
                {formatTanggal(contract.startDate)} – {formatTanggal(contract.endDate)}
              </span>
            ) : contract ? (
              <span className="text-[13px] text-ink-faint">{contract.durationDays} hari — menunggu SPMK</span>
            ) : (
              <span className="text-ink-faint">Belum ada</span>
            )}
            {remainingDays != null ? (
              <span
                className={cn(
                  "ml-1 text-[11px] font-normal",
                  remainingDays >= 0 ? "text-ink-faint" : "text-danger",
                )}
              >
                {remainingDays >= 0 ? `sisa ${remainingDays} hari` : `lewat ${-remainingDays} hari`}
              </span>
            ) : null}
          </StatCell>
          <StatCell label="Rencana">
            <span className="tabular">{formatPct(progress.planPct)}</span>
          </StatCell>
          <StatCell label="Realisasi">
            <span className="tabular">{formatPct(progress.realizedPct)}</span>
          </StatCell>
          <StatCell label="Deviasi">
            <DeltaBadge value={progress.deviationPct} />
          </StatCell>
          <StatCell label="Minggu berjalan">
            <span className="tabular">
              {progress.weekNumber}
              <span className="text-ink-faint">/{progress.totalWeeks}</span>
            </span>
          </StatCell>
        </dl>
      </header>

      <LinkTabs items={tabItems(location.slug)} />

      {children}
    </div>
  );
}

/** Sel stat berlabel untuk header lokasi. */
function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface px-3 py-2">
      <dt className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{children}</dd>
    </div>
  );
}
