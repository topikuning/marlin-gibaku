import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Banner, LinkTabs, PageHeader, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { PACKAGE_STAGE_LABEL, PACKAGE_STAGE_TONE } from "@/lib/lifecycle";
import { formatRupiah } from "@/lib/format";
import { contractMismatch, withPpn } from "@/lib/money";
import {
  getActiveRabSum,
  getPackageWorkspace,
  runningContractValue,
} from "@/lib/package/queries";

export default async function PaketWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const contract = pkg.contract;
  const running = contract
    ? runningContractValue(contract.contractValue, contract.amendments)
    : null;

  // Banner mismatch: nilai kontrak berjalan vs Σ RAB aktif lokasi + PPN.
  let mismatch: { expected: bigint; rabSum: bigint } | null = null;
  if (contract && running !== null) {
    const { sum, activeRevisions } = await getActiveRabSum(pkg.id);
    const ppn = Number(contract.ppnPercent);
    if (activeRevisions > 0 && contractMismatch(running, sum, ppn)) {
      mismatch = { expected: withPpn(sum, ppn), rabSum: sum };
    }
  }

  const base = `/paket/${pkg.id}`;
  const tabs = [
    { label: "Ringkasan", href: base, exact: true },
    { label: "Tender & Administrasi", href: `${base}/tender` },
    { label: "Kontrak & Adendum", href: `${base}/kontrak` },
    { label: "Lokasi", href: `${base}/lokasi` },
    { label: "Dokumen", href: `${base}/dokumen` },
    { label: "Aktivitas", href: `${base}/aktivitas` },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Paket", href: "/paket" }, { label: pkg.name }]}
        eyebrow={pkg.packageNumber ?? "Tanpa nomor paket"}
        title={pkg.name}
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusPill
              tone={PACKAGE_STAGE_TONE[pkg.stage]}
              label={PACKAGE_STAGE_LABEL[pkg.stage]}
            />
            {pkg.isBypass ? (
              <StatusPill tone="warning" label="Bypass — dokumen menyusul" />
            ) : null}
            {contract?.workTitle ? (
              <span className="w-full text-[13px] text-ink-muted">
                Pekerjaan: <span className="text-ink">{contract.workTitle}</span>
              </span>
            ) : null}
            <span>
              HPS <span className="tabular font-medium text-ink">{formatRupiah(pkg.hpsValue)}</span>
            </span>
            <span>
              Vendor:{" "}
              <span className="font-medium text-ink">
                {contract?.vendor.name ?? pkg.candidateVendorName ?? "—"}
              </span>
              {!contract && pkg.candidateVendorName ? " (kandidat)" : ""}
            </span>
            {contract && running !== null ? (
              <span>
                Nilai kontrak berjalan{" "}
                <span className="tabular font-medium text-ink">{formatRupiah(running)}</span>
                {contract.amendments.length > 0
                  ? ` (${contract.amendments.length} adendum)`
                  : ""}
              </span>
            ) : null}
          </div>
        }
      />

      {pkg.stage === "batal" ? (
        <Banner
          tone="error"
          title="Paket dibatalkan"
          description={pkg.cancelReason ?? "Tanpa alasan tercatat."}
        />
      ) : null}

      {mismatch && running !== null ? (
        <Banner
          tone="warning"
          title="Nilai kontrak tidak cocok dengan RAB aktif"
          description={`Nilai kontrak berjalan ${formatRupiah(running)} ≠ Σ RAB aktif + PPN ${formatRupiah(mismatch.expected)} (RAB pra-PPN ${formatRupiah(mismatch.rabSum)}). Periksa revisi RAB lokasi atau nilai adendum.`}
        />
      ) : null}

      <LinkTabs items={tabs} />

      <div>{children}</div>
    </div>
  );
}
