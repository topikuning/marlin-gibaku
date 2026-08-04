import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, LinkTabs, StatusPill } from "@/components/ui";
import { subTabPelaksanaan } from "../tabs";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getRecentDays } from "@/lib/daily-report/queries";
import { jakartaDateKey, formatTanggal } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/** Indeks harian lokasi: hari ini paling atas + 14 hari terakhir. */
export default async function HarianIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const todayKey = jakartaDateKey(new Date());
  const days = await getRecentDays(location.id, 14, todayKey);

  return (
    <div className="space-y-4">
      <LinkTabs items={subTabPelaksanaan(slug)} />
    <Card>
      <CardHeader
        title="Pelaksanaan Harian"
        subtitle="Satu laporan per tanggal: volume, tenaga, material, alat, cuaca, foto, kendala."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {can(user.role, "daily_report.create") && (
              <Link
                href={`/lokasi/${slug}/harian/import`}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
              >
                Impor rekap Excel
              </Link>
            )}
            <Link
              href={`/lokasi/${slug}/harian/${todayKey}`}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800"
            >
              Buka hari ini
            </Link>
          </div>
        }
      />
      <CardBody>
        <ul className="divide-y divide-border text-sm">
          {days.map((d) => (
            <li key={d.dateKey}>
              <Link
                href={`/lokasi/${slug}/harian/${d.dateKey}`}
                className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted"
              >
                <span>
                  {formatTanggal(new Date(`${d.dateKey}T00:00:00Z`), "EEEE, d MMM yyyy")}
                  {d.dateKey === todayKey && <span className="ml-2 text-xs font-medium text-primary">hari ini</span>}
                </span>
                {d.status ? (
                  <StatusPill tone={REPORT_STATUS_TONE[d.status]} label={`${REPORT_STATUS_LABEL[d.status]} · ${d.itemCount} item`} />
                ) : (
                  <StatusPill tone="neutral" label="Tidak ada laporan" />
                )}
              </Link>
            </li>
          ))}
        </ul>
        </CardBody>
      </Card>
    </div>
  );
}
