import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, KpiCard, PageHeader, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { existingLocationKeys, locationKey } from "@/lib/master-location/queries";
import { MasterImportForm } from "./import-form";

export const metadata: Metadata = { title: "Katalog Lokasi" };
export const dynamic = "force-dynamic";

export default async function KatalogPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.bypass");

  const [masters, realKeys] = await Promise.all([
    db.masterLocation.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ province: "asc" }, { regency: "asc" }, { village: "asc" }],
      select: {
        id: true,
        province: true,
        regency: true,
        district: true,
        village: true,
        candidateVendor: true,
        assignedLocationId: true,
      },
    }),
    existingLocationKeys(user.orgId),
  ]);

  const rows = masters.map((m) => {
    const usedByBypass = m.assignedLocationId != null;
    const existsReal = realKeys.has(locationKey(m));
    return {
      ...m,
      status: usedByBypass ? "terpakai" : existsReal ? "sudah_ada" : "tersedia",
    } as const;
  });
  const total = rows.length;
  const terpakai = rows.filter((r) => r.status === "terpakai").length;
  const sudahAda = rows.filter((r) => r.status === "sudah_ada").length;
  const tersedia = total - terpakai - sudahAda;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Paket", href: "/paket" }, { label: "Katalog Lokasi" }]}
        title="Katalog Lokasi (Master)"
        description="Daftar lokasi belum berpaket yang bisa dipetakan ke proyek lewat jalur cepat (bypass). Impor batch dari file Excel."
        actions={
          <Link
            href="/paket/bypass"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
          >
            Buat Proyek (Bypass)
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total katalog" value={total} />
        <KpiCard label="Tersedia" value={tersedia} />
        <KpiCard label="Terpakai (bypass)" value={terpakai} />
        <KpiCard label="Sudah ada sbg lokasi" value={sudahAda} />
      </section>

      <Card>
        <CardHeader
          title="Impor batch lokasi"
          subtitle="Unggah .xlsx (kolom: Provinsi, Kabupaten/Kota, Kecamatan, Desa/Kelurahan, Latitude, Longitude, Calon Penyedia). Idempotent — aman diulang; baris yang sudah ada diperbarui."
        />
        <CardBody>
          <MasterImportForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Isi katalog (${total})`} />
        <CardBody>
          {total === 0 ? (
            <p className="text-sm text-ink-muted">Katalog kosong. Impor file untuk mengisi.</p>
          ) : (
            <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="px-3 py-2">Provinsi</th>
                    <th className="px-3 py-2">Kabupaten</th>
                    <th className="px-3 py-2">Kecamatan</th>
                    <th className="px-3 py-2">Desa</th>
                    <th className="px-3 py-2">Calon penyedia</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-1.5">{r.province}</td>
                      <td className="px-3 py-1.5">{r.regency}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{r.district || "—"}</td>
                      <td className="px-3 py-1.5 font-medium text-ink">{r.village}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{r.candidateVendor || "—"}</td>
                      <td className="px-3 py-1.5">
                        {r.status === "tersedia" ? (
                          <StatusPill tone="success" label="Tersedia" />
                        ) : r.status === "terpakai" ? (
                          <StatusPill tone="neutral" label="Terpakai" />
                        ) : (
                          <StatusPill tone="warning" label="Sudah ada" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
