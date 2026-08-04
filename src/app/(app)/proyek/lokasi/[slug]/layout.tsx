import Link from "next/link";
import type { ReactNode } from "react";
import { LinkTabs, StatusPill, type LinkTabItem } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { cn } from "@/lib/cn";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatTanggal } from "@/lib/format";
import { getLocationProgress } from "@/lib/progress";
import { can } from "@/lib/authz";
import { getSiblingLocations, requireLocationPage } from "./get-location";
import { EditableLocationName } from "./edit-name";
import { LocationSwitcher } from "./location-switcher";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

// Helper di luar komponen — aturan purity render melarang Date.now() langsung di body.
function remainingDaysUntil(endDate: Date): number {
  return Math.ceil((endDate.getTime() - Date.now()) / DAY_MS);
}

/**
 * ENAM tab konseptual, bukan delapan (PRD FR-LOC-01, rancangan desain §2).
 *
 * Delapan tab datar meluber di ponsel — barisnya harus digeser mendatar untuk
 * melihat tab terakhir, dan tab yang tidak terlihat sama saja dengan tidak ada.
 * Dua pasang yang memang satu pekerjaan digabung:
 *
 *   Pelaksanaan   = laporan harian + kegiatan lapangan
 *   Administrasi  = dokumen & kepatuhan + laporan lokasi
 *
 * Route-nya TIDAK dipindah — hanya penamaan dan kepemilikan tab yang berubah,
 * jadi tautan dan bookmark lama tetap hidup. `juga` membuat tab tetap tersorot
 * saat route saudaranya dibuka; tanpa itu membuka Kegiatan akan memadamkan
 * seluruh baris tab dan pengguna kehilangan jawaban "saya di bagian mana".
 *
 * Sub-navigasi di dalam tab gabungan dibangun oleh halamannya masing-masing.
 */
function tabItems(slug: string): LinkTabItem[] {
  const base = `/proyek/lokasi/${slug}`;
  return [
    { label: "Ringkasan", href: base, exact: true },
    { label: "Rencana & RAB", href: `${base}/rab` },
    // Tab milik slice lain — link saja, halamannya dibangun terpisah.
    { label: "Pelaksanaan", href: `${base}/harian`, juga: [`${base}/kegiatan`] },
    { label: "Progress", href: `${base}/progress` },
    { label: "Keuangan", href: `${base}/keuangan` },
    {
      label: "Administrasi",
      href: `${base}/dokumen`,
      juga: [`${base}/laporan-lokasi`],
    },
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
  const [progress, { siblings, hiddenCount }] = await Promise.all([
    getLocationProgress(location.id),
    getSiblingLocations(user, location.package.id),
  ]);
  const contract = location.package.contract;
  const current = siblings.find((l) => l.slug === location.slug) ?? {
    slug: location.slug,
    name: location.name,
    regency: location.regency,
    status: location.status,
    deviationPct: null,
  };

  const remainingDays = contract?.endDate ? remainingDaysUntil(contract.endDate) : null;

  return (
    <div className="space-y-4">
      {/* Header proyek terstruktur (audit UI #5): identitas + stat berlabel dalam
          kartu, bukan satu baris teks datar — informasi lebih cepat dipindai. */}
      {/* DI PONSEL header ini DISEMBUNYIKAN (permintaan user 2026-08-02: "untuk
          tampilan mobile pada halaman input pekerjaan … informasi di atas
          inputan seperti progress dll, di hide saja").

          Alasannya nyata: identitas + alamat + paket + enam sel statistik
          memakan ~600px sebelum kolom pertama yang harus diisi mandor —
          di layar 812px itu berarti menggulir dua kali hanya untuk mulai
          bekerja. Angkanya tidak hilang, cuma tidak dipaksakan di layar input:
          semuanya ada di tab Ringkasan, lengkap dengan kartu KPI-nya sendiri.
          Yang tetap tampil di ponsel: nama lokasi, status, dan deviasi — tiga
          hal yang menjawab "saya sedang di lokasi mana, dan sedang seberapa
          tertinggal". */}
      <header className="space-y-3 max-sm:hidden">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Nama lokasi merangkap pemicu pemilih lokasi sepaket — pindah
                  lokasi tanpa memutar lewat halaman paket (DECISIONS 204). */}
              <EditableLocationName
                locationId={location.id}
                name={location.name}
                canEdit={canRename}
                nameSlot={
                  <LocationSwitcher
                    current={current}
                    siblings={siblings}
                    hiddenCount={hiddenCount}
                    packageName={location.package.name}
                  />
                }
              />
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
            <Link href={`/proyek/paket/${location.package.id}`} className="font-medium text-primary hover:underline">
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

      {/* Baris ringkas pengganti header di ponsel — satu baris, bukan blok. */}
      <div className="flex items-center gap-2 sm:hidden">
        <span className="min-w-0 truncate text-sm font-semibold text-ink">{location.name}</span>
        <StatusPill
          tone={LOCATION_STATUS_TONE[location.status]}
          label={LOCATION_STATUS_LABEL[location.status]}
        />
        <span className="ms-auto shrink-0">
          <DeltaBadge value={progress.deviationPct} />
        </span>
      </div>

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
