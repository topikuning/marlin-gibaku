import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { LokasiGrid, type LokasiRow } from "./lokasi-grid";

export const metadata: Metadata = { title: "Lokasi" };
export const dynamic = "force-dynamic";

/** Daftar lokasi (scoped by penugasan) — progress dihitung BATCH, bukan N+1. */
export default async function LokasiListPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const locIds = await accessibleLocationIds(user);

  const locations = await db.location.findMany({
    where: locationScopeWhere(user, locIds),
    select: {
      id: true,
      name: true,
      slug: true,
      village: true,
      regency: true,
      province: true,
      status: true,
      package: {
        select: {
          name: true,
          // Perusahaan PELAKSANA = vendor di KONTRAK. Bukan `candidateVendorName`
          // (calon pemenang tender): yang belum berkontrak belum mengerjakan
          // apa pun, dan menampilkannya di kolom yang sama akan terbaca sebagai
          // pelaksana yang sudah pasti.
          contract: { select: { vendor: { select: { name: true } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  const progress = await getLocationsProgress(locations.map((l) => l.id));

  const rows: LokasiRow[] = locations.map((l) => {
    const p = progress.get(l.id)!;
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      wilayah: `${l.regency}, ${l.province}`,
      paket: l.package.name,
      perusahaan: l.package.contract?.vendor.name ?? null,
      status: l.status,
      realizedPct: p.realizedPct,
      deviationPct: p.deviationPct,
      rabValue: Number(p.grandTotal),
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lokasi"
        description={`${rows.length} lokasi dalam lingkup akses Anda.`}
      />
      <LokasiGrid rows={rows} />
    </div>
  );
}
