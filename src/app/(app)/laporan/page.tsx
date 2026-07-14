import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Printer } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { jakartaDateKey, formatTanggal } from "@/lib/format";

export const metadata: Metadata = { title: "Laporan" };
export const dynamic = "force-dynamic";

/** Pusat laporan: pintu ke laporan harian/mingguan/bulanan per lokasi + final terbaru. */
export default async function LaporanPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const scoped = await accessibleLocationIds(user);

  const [locations, recentFinal] = await Promise.all([
    db.location.findMany({
      where: { ...(scoped === null ? {} : { id: { in: scoped } }), isActive: true },
      select: { id: true, name: true, slug: true, province: true },
      orderBy: { name: "asc" },
    }),
    db.dailyReport.findMany({
      where: { status: "final", ...(scoped === null ? {} : { locationId: { in: scoped } }) },
      orderBy: { reportDate: "desc" },
      take: 20,
      select: { id: true, reportDate: true, location: { select: { name: true, slug: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan"
        description="Semua laporan diturunkan dari data operasional yang sama: harian (KKP), mingguan, bulanan, dan export Excel."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Per lokasi" subtitle="Harian / mingguan / bulanan / export" />
          <CardBody>
            {locations.length === 0 ? (
              <EmptyState icon={FileText} title="Belum ada lokasi aktif" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {locations.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {l.name}
                      <span className="ml-2 text-ink-muted">{l.province}</span>
                    </span>
                    <Link href={`/lokasi/${l.slug}/laporan-lokasi`} className="font-medium text-primary hover:underline">
                      Buka laporan
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Laporan harian final terbaru" subtitle="Snapshot beku, siap cetak" />
          <CardBody>
            {recentFinal.length === 0 ? (
              <EmptyState
                icon={Printer}
                title="Belum ada laporan final"
                description="Laporan menjadi final setelah disetujui dan difinalisasi Site Manager."
              />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {recentFinal.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {r.location.name}
                      <span className="ml-2 text-ink-muted">{formatTanggal(r.reportDate)}</span>
                    </span>
                    <Link
                      href={`/cetak/harian/${r.location.slug}/${jakartaDateKey(r.reportDate)}`}
                      className="font-medium text-primary hover:underline"
                    >
                      Cetak
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
