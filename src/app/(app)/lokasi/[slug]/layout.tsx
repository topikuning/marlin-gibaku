import Link from "next/link";
import type { ReactNode } from "react";
import { LinkTabs, StatusPill, type LinkTabItem } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { cn } from "@/lib/cn";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";
import { getLocationProgress } from "@/lib/progress";
import { can } from "@/lib/authz";
import { requireLocationPage } from "./get-location";
import { EditableLocationName } from "./edit-name";

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
  const { user, location } = await requireLocationPage(slug);
  const canRename = can(user.role, "location.manage");
  const progress = await getLocationProgress(location.id);
  const contract = location.package.contract;

  const remainingDays = contract?.endDate ? remainingDaysUntil(contract.endDate) : null;

  return (
    <div className="space-y-4">
      {/* Header proyek terstruktur (audit UI #5): identitas + stat berlabel dalam
          kartu, bukan satu baris teks datar — informasi lebih cepat dipindai. */}
      <header className="overflow-hidden rounded-xl bg-primary-900 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5 sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <EditableLocationName locationId={location.id} name={location.name} canEdit={canRename} inverse />
              <StatusPill
                tone={LOCATION_STATUS_TONE[location.status]}
                label={LOCATION_STATUS_LABEL[location.status]}
              />
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {location.village}, {location.regency} — {location.province}
            </p>
          </div>
          <div className="text-left text-sm sm:text-right">
            <Link href={`/paket/${location.package.id}`} className="font-medium text-cyan-300 hover:underline">
              {location.package.name}
            </Link>
            {contract ? <p className="mt-1 text-slate-300">{contract.vendor.name}</p> : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-slate-700 bg-slate-700 sm:grid-cols-3 lg:grid-cols-6">
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
          <StatCell label="Progress Dilaporkan">
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
    <div className="bg-primary-900 px-4 py-3">
      <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-white">{children}</dd>
    </div>
  );
}
