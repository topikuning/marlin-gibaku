import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ClipboardList, MapPin } from "lucide-react";
import { Banner, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getHariIniLocation } from "@/lib/daily-report/queries";
import { jakartaDateKey, formatTanggal, formatNumber } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";

export const metadata: Metadata = { title: "Hari Ini" };
export const dynamic = "force-dynamic";

/** Landing lapangan mobile-first: prioritas hari ini, draft, koreksi, target minggu. */
export default async function HariIniPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "daily_report.create");
  const locIds = await accessibleLocationIds(user);
  const todayKey = jakartaDateKey(new Date());

  const locations = await db.location.findMany({
    where: { ...(locIds === null ? {} : { id: { in: locIds } }), isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const summaries = (
    await Promise.all(locations.map((l) => getHariIniLocation(l.id)))
  ).filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="Hari Ini"
        description={formatTanggal(new Date(), "EEEE, d MMMM yyyy")}
      />

      {summaries.length === 0 && (
        <EmptyState
          icon={MapPin}
          title="Belum ada penugasan lokasi"
          description="Hubungi admin untuk mendapatkan penugasan lokasi."
        />
      )}

      {summaries.map((s) => (
        <Card key={s.id}>
          <CardHeader
            title={s.name}
            subtitle={`${s.village}, ${s.regency}${s.weekNumber ? ` · minggu ke-${s.weekNumber}` : ""}`}
          />
          <CardBody className="space-y-4">
            {s.corrections.length > 0 && (
              <Banner
                tone="warning"
                title={`${s.corrections.length} laporan dikembalikan — perlu koreksi`}
                description={s.corrections
                  .map((c) => `${formatTanggal(new Date(`${c.dateKey}T00:00:00Z`))}: ${c.reason ?? "tanpa alasan"}`)
                  .join(" · ")}
              />
            )}

            <Link
              href={`/lokasi/${s.slug}/harian/${todayKey}`}
              className="block rounded-lg bg-primary px-4 py-4 text-center text-base font-semibold text-white hover:bg-primary-800"
            >
              {s.todayStatus === null
                ? "Lapor Hari Ini"
                : s.todayStatus === "draft"
                  ? `Lanjutkan Draft (${s.todayDraftItemCount ?? 0} item)`
                  : `Laporan hari ini: ${REPORT_STATUS_LABEL[s.todayStatus]}`}
            </Link>

            {s.corrections.map((c) => (
              <Link
                key={c.dateKey}
                href={`/lokasi/${s.slug}/harian/${c.dateKey}`}
                className="block rounded-lg border border-warning bg-warning-soft px-4 py-3 text-center text-sm font-medium text-ink hover:opacity-90"
              >
                Perbaiki laporan {formatTanggal(new Date(`${c.dateKey}T00:00:00Z`))}
              </Link>
            ))}

            {s.weeklyTargets.length > 0 && (
              <div>
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <ClipboardList className="h-4 w-4" aria-hidden /> Target minggu ini
                </h3>
                <ul className="divide-y divide-border text-sm">
                  {s.weeklyTargets.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">{t.name}</span>
                      <span className="shrink-0 tabular text-ink-muted">
                        {formatNumber(t.realizedVolume)}/{formatNumber(t.targetVolume)} {t.unit ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <CalendarDays className="h-4 w-4" aria-hidden /> 7 hari terakhir
              </h3>
              <ul className="divide-y divide-border text-sm">
                {s.last7Days.map((d) => (
                  <li key={d.dateKey}>
                    <Link
                      href={`/lokasi/${s.slug}/harian/${d.dateKey}`}
                      className="flex items-center justify-between gap-2 py-1.5 hover:bg-surface-muted"
                    >
                      <span>{formatTanggal(new Date(`${d.dateKey}T00:00:00Z`), "EEE, d MMM")}</span>
                      {d.status ? (
                        <StatusPill tone={REPORT_STATUS_TONE[d.status]} label={`${REPORT_STATUS_LABEL[d.status]} · ${d.itemCount} item`} />
                      ) : (
                        <StatusPill tone="neutral" label="Tidak ada laporan" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
