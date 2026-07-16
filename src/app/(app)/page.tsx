import Link from "next/link";
import { ClipboardCheck, FileWarning, MapPin, Package as PackageIcon } from "lucide-react";
import { KpiCard, PageHeader, EmptyState, StatusPill, Card, CardHeader, CardBody } from "@/components/ui";
import { DeltaBadge, deviationTone } from "@/components/ui/stat-delta";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { formatRupiahShort, formatTanggal } from "@/lib/format";
import { PACKAGE_STAGE_LABEL, PACKAGE_STAGE_TONE, REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/**
 * Command Center — exception-first: yang harus DIKERJAKAN di atas, KPI klik-tembus di bawah.
 */
export default async function CommandCenterPage() {
  const user = await requireUser();
  const locIds = await accessibleLocationIds(user);
  const locWhere = locIds === null ? {} : { id: { in: locIds } };

  const [locations, packages, pendingReports, openIssues, correctionReports] = await Promise.all([
    db.location.findMany({
      where: { ...locWhere, isActive: true },
      select: { id: true, name: true, slug: true, province: true, status: true },
      orderBy: { name: "asc" },
    }),
    can(user.role, "package.view")
      ? db.package.findMany({
          select: { id: true, name: true, stage: true, hpsValue: true },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    can(user.role, "daily_report.review")
      ? db.dailyReport.findMany({
          where: { status: "dikirim", location: locWhere },
          select: {
            id: true,
            reportDate: true,
            status: true,
            location: { select: { name: true, slug: true } },
          },
          orderBy: { reportDate: "asc" },
          take: 10,
        })
      : Promise.resolve([]),
    db.issue.findMany({
      where: { status: "terbuka", location: locWhere },
      select: { id: true, title: true, severity: true, location: { select: { name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    can(user.role, "daily_report.create")
      ? db.dailyReport.findMany({
          where: { status: "perlu_koreksi", location: locWhere },
          select: { id: true, reportDate: true, status: true, location: { select: { name: true, slug: true } } },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  const progress = await getLocationsProgress(locations.map((l) => l.id));
  const critical = locations
    .map((l) => ({ ...l, p: progress.get(l.id) }))
    .filter((l) => l.p && l.p.deviationPct < -10)
    .sort((a, b) => (a.p!.deviationPct ?? 0) - (b.p!.deviationPct ?? 0));

  let totalContract = 0n;
  let totalRealized = 0n;
  for (const p of progress.values()) {
    totalContract += p.grandTotal;
    totalRealized += p.realizedValue;
  }

  const activePackages = packages.filter((p) => !["selesai", "batal"].includes(p.stage));
  const actionCount = pendingReports.length + correctionReports.length + critical.length + openIssues.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Halo, ${user.fullName.split(" ")[0]}`}
        description={actionCount > 0 ? `${actionCount} hal menunggu tindakan hari ini.` : "Tidak ada yang menunggu tindakan. Semua terkendali."}
      />

      {/* ── Perlu tindakan (exception-first) ── */}
      <section className="grid gap-4 lg:grid-cols-2">
        {pendingReports.length > 0 && (
          <Card>
            <CardHeader title="Laporan menunggu verifikasi" subtitle={`${pendingReports.length} laporan`} />
            <CardBody>
              <ul className="divide-y divide-border">
                {pendingReports.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/lokasi/${r.location.slug}/harian/${r.reportDate.toISOString().slice(0, 10)}`}
                      className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted"
                    >
                      <span className="text-sm">
                        {r.location.name}
                        <span className="ml-2 text-ink-muted">{formatTanggal(r.reportDate)}</span>
                      </span>
                      <StatusPill tone={REPORT_STATUS_TONE[r.status]} label={REPORT_STATUS_LABEL[r.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {correctionReports.length > 0 && (
          <Card>
            <CardHeader title="Laporan dikembalikan (perlu koreksi)" subtitle={`${correctionReports.length} laporan`} />
            <CardBody>
              <ul className="divide-y divide-border">
                {correctionReports.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/lokasi/${r.location.slug}/harian/${r.reportDate.toISOString().slice(0, 10)}`}
                      className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted"
                    >
                      <span className="text-sm">
                        {r.location.name}
                        <span className="ml-2 text-ink-muted">{formatTanggal(r.reportDate)}</span>
                      </span>
                      <StatusPill tone="warning" label="Perlu Koreksi" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {critical.length > 0 && (
          <Card>
            <CardHeader title="Proyek deviasi kritis" subtitle="Realisasi tertinggal >10% dari rencana" />
            <CardBody>
              <ul className="divide-y divide-border">
                {critical.slice(0, 8).map((l) => (
                  <li key={l.id}>
                    <Link href={`/lokasi/${l.slug}`} className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                      <span className="text-sm">{l.name}</span>
                      <DeltaBadge value={l.p!.deviationPct} />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {openIssues.length > 0 && (
          <Card>
            <CardHeader title="Kendala terbuka" subtitle={`${openIssues.length} kendala`} />
            <CardBody>
              <ul className="divide-y divide-border">
                {openIssues.map((i) => (
                  <li key={i.id}>
                    <Link href={`/lokasi/${i.location.slug}/progress`} className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                      <span className="text-sm">
                        {i.title}
                        <span className="ml-2 text-ink-muted">{i.location.name}</span>
                      </span>
                      <StatusPill
                        tone={i.severity === "kritis" || i.severity === "tinggi" ? "danger" : "warning"}
                        label={i.severity}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {actionCount === 0 && (
          <div className="lg:col-span-2">
            <EmptyState
              icon={ClipboardCheck}
              title="Tidak ada tindakan tertunda"
              description="Laporan, verifikasi, dan kendala semua sudah ditangani."
            />
          </div>
        )}
      </section>

      {/* ── KPI (klik-tembus) ── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Paket aktif" value={String(activePackages.length)} href="/paket" />
        <KpiCard label="Lokasi aktif" value={String(locations.length)} href="/lokasi" />
        <KpiCard label="Nilai RAB aktif" value={formatRupiahShort(totalContract)} sub="pra-PPN" href="/progress" />
        <KpiCard label="Nilai terpasang" value={formatRupiahShort(totalRealized)} href="/progress" />
      </section>

      {/* ── Ringkasan portfolio ── */}
      {/* min-w-0: cegah min-content baris (truncate/nowrap) melebarkan track grid di mobile */}
      <section className="grid gap-4 lg:grid-cols-2">
        {can(user.role, "package.view") && (
          <Card className="min-w-0">
            <CardHeader
              title="Paket terbaru"
              action={
                <Link href="/paket" className="text-sm font-medium text-primary hover:underline">
                  Semua paket
                </Link>
              }
            />
            <CardBody>
              {activePackages.length === 0 ? (
                <EmptyState icon={PackageIcon} title="Belum ada paket" description="Mulai dari menu Paket." />
              ) : (
                <ul className="divide-y divide-border">
                  {activePackages.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <Link href={`/paket/${p.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                        <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                        <StatusPill tone={PACKAGE_STAGE_TONE[p.stage]} label={PACKAGE_STAGE_LABEL[p.stage]} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}
        <Card className="min-w-0">
          <CardHeader
            title="Kinerja lokasi"
            action={
              <Link href="/lokasi" className="text-sm font-medium text-primary hover:underline">
                Semua lokasi
              </Link>
            }
          />
          <CardBody>
            {locations.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="Belum ada lokasi aktif"
                description="Lokasi aktif muncul setelah paket dikonversi menjadi kontrak."
              />
            ) : (
              <ul className="divide-y divide-border">
                {locations.slice(0, 8).map((l) => {
                  const p = progress.get(l.id);
                  return (
                    <li key={l.id}>
                      <Link href={`/lokasi/${l.slug}`} className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {l.name}
                          <span className="ml-2 text-ink-muted">{l.province}</span>
                        </span>
                        {p ? <DeltaBadge value={p.deviationPct} /> : <StatusPill tone="neutral" label="—" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
      {critical.length === 0 && openIssues.length === 0 ? null : (
        <p className="flex items-center gap-1 text-xs text-ink-muted">
          <FileWarning className="h-3.5 w-3.5" aria-hidden /> Deviasi dihitung dari baseline aktif; klik item untuk data pembentuknya.
        </p>
      )}
    </div>
  );
}
