import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  StatusPill,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import { getPackageWorkspace } from "@/lib/package/queries";
import { getAvailableCatalog } from "@/lib/master-location/queries";
import { AddLocationForm, CatalogLocationPicker, RemoveLocationButton } from "./lokasi-forms";

export const metadata: Metadata = { title: "Lokasi Paket" };
export const dynamic = "force-dynamic";

export default async function LokasiPaketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const canProspect = can(user.role, "prospect.manage");
  const praKontrak = !pkg.contract && ["prospek", "tender", "penetapan"].includes(pkg.stage);
  const catalog = praKontrak && canProspect ? (await getAvailableCatalog(user.orgId)).available : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card className="self-start">
        <CardHeader
          title="Lokasi paket"
          subtitle={`${pkg.locations.length} lokasi · ${pkg.locations.filter((l) => l.isActive).length} aktif`}
        />
        <CardBody>
          {pkg.locations.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Belum ada lokasi"
              description={
                praKontrak
                  ? "Tambahkan lokasi target — wajib minimal satu sebelum konversi kontrak."
                  : "Paket ini belum memiliki lokasi."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {pkg.locations.map((l) => {
                const removable =
                  canProspect &&
                  !l.isActive &&
                  l._count.rabRevisions === 0 &&
                  l._count.statusHistory === 0 &&
                  l._count.dailyReports === 0;
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/lokasi/${l.slug}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {l.name}
                      </Link>
                      <p className="text-xs text-ink-muted">
                        {[l.village, l.regency, l.province].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill
                        tone={LOCATION_STATUS_TONE[l.status]}
                        label={LOCATION_STATUS_LABEL[l.status]}
                      />
                      {!l.isActive ? <StatusPill tone="neutral" label="Target" /> : null}
                      {removable ? <RemoveLocationButton locationId={l.id} name={l.name} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {praKontrak && canProspect ? (
        <Card className="self-start">
          <CardHeader
            title="Tambah lokasi target"
            subtitle="Pilih dari katalog master (impor) atau isi manual. Lokasi dibuat nonaktif (Persiapan) dan aktif otomatis saat konversi kontrak."
          />
          <CardBody className="space-y-4">
            {catalog.length > 0 ? (
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink">Dari katalog master</p>
                <CatalogLocationPicker packageId={pkg.id} catalog={catalog} />
              </div>
            ) : null}
            <details {...(catalog.length === 0 ? { open: true } : {})} className="group">
              <summary className="cursor-pointer text-[13px] font-medium text-primary hover:underline">
                {catalog.length > 0 ? "Atau isi manual" : "Isi manual"}
              </summary>
              <div className="mt-3">
                <AddLocationForm packageId={pkg.id} defaultProvince={pkg.province ?? ""} />
              </div>
            </details>
          </CardBody>
        </Card>
      ) : (
        <Card className="self-start">
          <CardHeader title="Info" />
          <CardBody>
            <p className="text-sm text-ink-muted">
              {praKontrak
                ? "Penambahan lokasi target dilakukan pemegang akses prospek."
                : "Paket sudah berkontrak — komposisi lokasi terkunci. Perubahan lingkup lewat adendum."}
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
