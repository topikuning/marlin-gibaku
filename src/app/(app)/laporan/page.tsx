import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText, Printer } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationRelScopeWhere, locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { jakartaDateKey, formatTanggal } from "@/lib/format";
import { withBackTo } from "@/lib/print-back";

export const metadata: Metadata = { title: "Laporan" };
export const dynamic = "force-dynamic";

/** Pusat laporan: pintu ke laporan harian/mingguan/bulanan per lokasi + final terbaru. */
export default async function LaporanPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const scoped = await accessibleLocationIds(user);

  const [locations, recentFinal, perluKoreksi, menungguVerifikasi] = await Promise.all([
    db.location.findMany({
      where: { ...locationScopeWhere(user, scoped), isActive: true },
      select: { id: true, name: true, slug: true, province: true },
      orderBy: { name: "asc" },
    }),
    db.dailyReport.findMany({
      where: { status: "final", ...(scoped === null ? { location: { package: { orgId: user.orgId } } } : { locationId: { in: scoped } }) },
      orderBy: { reportDate: "desc" },
      take: 20,
      select: { id: true, reportDate: true, location: { select: { name: true, slug: true } } },
    }),
    db.dailyReport.count({ where: { status: "perlu_koreksi", ...locationRelScopeWhere(user, scoped) } }),
    db.dailyReport.count({ where: { status: "dikirim", ...locationRelScopeWhere(user, scoped) } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan"
        description="Semua laporan diturunkan dari data operasional yang sama: harian (KKP), mingguan, bulanan, dan export Excel."
      />
      {/* Antrean lebih dulu dari arsip: yang menunggu tindakan lebih mendesak
          daripada yang sudah selesai (DECISIONS 204). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <AntreanLink
          href="/laporan/perlu-koreksi"
          label="Perlu koreksi"
          count={perluKoreksi}
          sub="dikembalikan, menunggu diperbaiki"
          tone="warning"
        />
        <AntreanLink
          href="/laporan/menunggu-verifikasi"
          label="Menunggu verifikasi"
          count={menungguVerifikasi}
          sub="sudah dikirim lapangan, belum diperiksa"
          tone="info"
        />
      </div>

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
                      href={withBackTo(`/cetak/harian/${r.location.slug}/${jakartaDateKey(r.reportDate)}`, "/laporan")}
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

/**
 * Pintu ke antrean. Angka 0 tetap ditampilkan (tidak disembunyikan) supaya
 * "tidak ada yang perlu diurus" terbaca sebagai kabar, bukan sebagai menu hilang.
 */
function AntreanLink({
  href,
  label,
  count,
  sub,
  tone,
}: {
  href: string;
  label: string;
  count: number;
  sub: string;
  tone: "warning" | "info";
}) {
  const kosong = count === 0;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-muted"
    >
      <span
        className={`tabular text-2xl leading-none font-semibold ${
          kosong ? "text-ink-faint" : tone === "warning" ? "text-warning" : "text-info"
        }`}
      >
        {count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{kosong ? "tidak ada yang menunggu" : sub}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
    </Link>
  );
}
