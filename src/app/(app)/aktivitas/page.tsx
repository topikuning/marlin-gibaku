import Link from "next/link";
import { Activity, AlertTriangle, CalendarClock, MapPin } from "lucide-react";
import { KpiCard, PageHeader, EmptyState, StatusPill, Card, CardHeader, CardBody } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { getActivityFeed, getLocationActivity, KIND_LABEL } from "@/lib/activity";
import { formatPct, formatTanggal, formatTanggalWaktu, jakartaToday } from "@/lib/format";
import {
  LOCATION_STATUS_LABEL,
  LOCATION_STATUS_TONE,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
} from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;
const STALE_DAYS = 3; // lokasi berjalan tanpa laporan ≥ 3 hari = perlu perhatian

/**
 * Dashboard "Aktivitas & Denyut Lokasi" — eksekutif melihat apa yang bergerak di
 * seluruh lokasi tanpa membuka satu per satu: siapa membuat laporan/kegiatan,
 * perubahan jadwal, kendala; progress rencana vs realisasi; dan lokasi yang belum
 * lapor. Dibatasi ke lokasi yang boleh dilihat user (peran cross-location = semua).
 */
export default async function AktivitasPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "portfolio.view");
  const locIds = await accessibleLocationIds(user);
  const locWhere = locIds === null ? {} : { id: { in: locIds } };

  const [locations, feed, actByLoc] = await Promise.all([
    db.location.findMany({
      where: { ...locWhere, isActive: true },
      select: { id: true, name: true, slug: true, province: true, regency: true, status: true },
      orderBy: { name: "asc" },
    }),
    getActivityFeed(locIds, 50),
    getLocationActivity(locIds),
  ]);
  const progress = await getLocationsProgress(locations.map((l) => l.id));

  const today = jakartaToday();
  const rows = locations
    .map((l) => {
      const p = progress.get(l.id);
      const a = actByLoc.get(l.id);
      const lastReportDate = a?.lastReportDate ?? null;
      const staleDays = lastReportDate
        ? Math.floor((today.getTime() - lastReportDate.getTime()) / DAY_MS)
        : null;
      const belumLapor =
        l.status === "berjalan" && (lastReportDate === null || (staleDays !== null && staleDays >= STALE_DAYS));
      return { ...l, p, a, lastReportDate, staleDays, belumLapor };
    })
    .sort((a, b) => (a.p?.deviationPct ?? 999) - (b.p?.deviationPct ?? 999));

  const critical = rows.filter((r) => r.p && r.p.deviationPct < -10);
  const belumLapor = rows.filter((r) => r.belumLapor);
  const activityToday = feed.filter((e) => e.at >= today).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aktivitas & Denyut Lokasi"
        description="Pergerakan terbaru di seluruh lokasi — laporan harian, kegiatan lapangan, perubahan jadwal, dan kendala — tanpa membuka satu per satu."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Lokasi aktif" value={String(locations.length)} sub="dalam jangkauan Anda" />
        <KpiCard
          label="Perlu perhatian"
          value={String(critical.length)}
          sub="deviasi < −10%"
          tone={critical.length > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Belum lapor"
          value={String(belumLapor.length)}
          sub={`berjalan, ≥ ${STALE_DAYS} hari tanpa laporan`}
          tone={belumLapor.length > 0 ? "warning" : "success"}
        />
        <KpiCard label="Aktivitas hari ini" value={String(activityToday)} sub="kejadian sejak dini hari (WIB)" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Feed aktivitas */}
        <Card className="lg:col-span-2">
          <CardHeader title="Aktivitas terbaru" subtitle="50 kejadian terakhir lintas lokasi" />
          <CardBody>
            {feed.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="Belum ada aktivitas"
                description="Aktivitas laporan, kegiatan lapangan, dan perubahan jadwal akan muncul di sini."
              />
            ) : (
              <ul className="divide-y divide-border">
                {feed.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 py-2.5">
                    <StatusPill tone={e.tone} label={KIND_LABEL[e.kind]} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <Link href={e.href} className="block truncate text-sm hover:underline">
                        {e.summary}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        <span className="font-medium text-ink">{e.locationName}</span> · {e.actor} ·{" "}
                        {formatTanggalWaktu(e.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Sorotan: belum lapor */}
        <Card>
          <CardHeader
            title="Belum lapor"
            subtitle={`Lokasi berjalan tanpa laporan ≥ ${STALE_DAYS} hari`}
          />
          <CardBody>
            {belumLapor.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Semua lokasi lapor"
                description="Tidak ada lokasi berjalan yang tertinggal laporannya."
              />
            ) : (
              <ul className="divide-y divide-border">
                {belumLapor.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/lokasi/${r.slug}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                      {r.name}
                    </Link>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle aria-hidden className="size-3.5" />
                      {r.lastReportDate ? `${r.staleDays} hari` : "belum pernah"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Tabel progress + laporan per lokasi */}
      <Card>
        <CardHeader
          title="Progress & laporan per lokasi"
          subtitle="Rencana vs realisasi (deviasi), laporan harian terakhir, dan denyut aktivitas — urut deviasi terburuk dulu."
        />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Belum ada lokasi"
              description="Lokasi aktif akan muncul di sini."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-200 text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="px-3 py-2">Lokasi</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Minggu</th>
                    <th className="px-3 py-2 text-right">Rencana</th>
                    <th className="px-3 py-2 text-right">Realisasi</th>
                    <th className="px-3 py-2 text-right">Deviasi</th>
                    <th className="px-3 py-2">Laporan terakhir</th>
                    <th className="px-3 py-2">Aktivitas terakhir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-inset/50">
                      <td className="max-w-56 px-3 py-2">
                        <Link href={`/lokasi/${r.slug}`} className="block truncate font-medium hover:underline">
                          {r.name}
                        </Link>
                        <span className="block truncate text-xs text-ink-muted">
                          {r.regency}, {r.province}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill tone={LOCATION_STATUS_TONE[r.status]} label={LOCATION_STATUS_LABEL[r.status]} />
                      </td>
                      <td className="tabular px-3 py-2 text-right text-ink-muted">
                        {r.p ? `${r.p.weekNumber}/${r.p.totalWeeks}` : "—"}
                      </td>
                      <td className="tabular px-3 py-2 text-right">{r.p ? formatPct(r.p.planPct) : "—"}</td>
                      <td className="tabular px-3 py-2 text-right">{r.p ? formatPct(r.p.realizedPct) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.p ? <DeltaBadge value={r.p.deviationPct} /> : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.lastReportDate ? (
                          <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-xs">{formatTanggal(r.lastReportDate)}</span>
                            {r.a?.lastReportStatus ? (
                              <StatusPill
                                tone={REPORT_STATUS_TONE[r.a.lastReportStatus]}
                                label={REPORT_STATUS_LABEL[r.a.lastReportStatus]}
                              />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">belum ada</span>
                        )}
                        {r.a?.lastReportBy ? (
                          <span className="block truncate text-xs text-ink-muted">oleh {r.a.lastReportBy}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-muted">
                        {r.a?.lastActivityAt ? formatTanggalWaktu(r.a.lastActivityAt) : "—"}
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
