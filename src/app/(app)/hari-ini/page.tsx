import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, ClipboardList, MapPin } from "lucide-react";
import { Banner, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getHariIniLocation } from "@/lib/daily-report/queries";
import { jakartaDateKey, formatTanggal, formatNumber } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import {
  ISSUE_SEVERITY_LABEL,
  ISSUE_SEVERITY_TONE,
} from "@/app/(app)/lokasi/[slug]/issue-labels";

export const metadata: Metadata = { title: "Hari Ini" };
export const dynamic = "force-dynamic";

/**
 * Warna kotak pita 7 hari, per tone status laporan. Sengaja dipetakan dari
 * tone `lifecycle.ts` — bukan dari status mentah — supaya status baru tidak
 * perlu disentuh di sini, dan warnanya tidak pernah berselisih dengan
 * StatusPill di halaman lain.
 */
const TONE_KOTAK_HARI: Record<string, string> = {
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-danger",
  info: "border-info-border bg-info-soft text-info",
  neutral: "border-border bg-surface-muted text-ink-faint",
};

/** Landing lapangan mobile-first: prioritas hari ini, draft, koreksi, target minggu. */
export default async function HariIniPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "daily_report.create");
  const locIds = await accessibleLocationIds(user);
  const todayKey = jakartaDateKey(new Date());

  const locations = await db.location.findMany({
    where: { ...locationScopeWhere(user, locIds), isActive: true },
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
                className="block rounded-lg border border-warning bg-warning-soft px-4 py-3 text-center text-sm font-medium text-ink transition-colors hover:bg-warning/15 active:bg-warning/25"
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

            {s.kendalaAktif.length > 0 && (
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Kendala aktif
                  <span className="font-normal text-ink-muted">({s.kendalaAktif.length})</span>
                </h3>
                {/* Ditampilkan supaya kendala yang SUDAH dilaporkan terlihat
                    sedang ditunggu. Tanpa ini kendala yang sama dilaporkan
                    berulang kali karena pelapor tidak tahu nasibnya. */}
                <ul className="space-y-1.5">
                  {s.kendalaAktif.map((k) => (
                    <li
                      key={k.id}
                      className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <StatusPill
                        tone={ISSUE_SEVERITY_TONE[k.severity]}
                        label={ISSUE_SEVERITY_LABEL[k.severity]}
                      />
                      <span className="min-w-0 flex-1 text-[13px] text-ink">{k.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <CalendarDays className="h-4 w-4" aria-hidden /> 7 hari terakhir
              </h3>
              {/* Pita mendatar, bukan daftar menurun: tujuh baris penuh
                  mendorong tombol lapor jauh ke bawah layar 375px, padahal
                  riwayat di sini hanya untuk sekilas melihat mana yang bolong.
                  Yang perlu dibuka tetap bisa diketuk (Master Prompt §8:
                  sedikit scroll). */}
              <ol className="flex gap-1">
                {[...s.last7Days].reverse().map((d) => {
                  const tgl = new Date(`${d.dateKey}T00:00:00Z`);
                  const label = d.status
                    ? `${REPORT_STATUS_LABEL[d.status]} · ${d.itemCount} item`
                    : "Belum ada laporan";
                  return (
                    <li key={d.dateKey} className="min-w-0 flex-1">
                      <Link
                        href={`/lokasi/${s.slug}/harian/${d.dateKey}`}
                        aria-label={`${formatTanggal(tgl, "EEEE d MMMM")} — ${label}`}
                        title={label}
                        className="block text-center"
                      >
                        <span className="block text-[10px] text-ink-faint">
                          {formatTanggal(tgl, "EEEEEE")}
                        </span>
                        {/* Status TIDAK disampaikan lewat warna saja: ada
                            huruf awal statusnya di dalam kotak, dan kalimat
                            penuhnya di aria-label/title. */}
                        <span
                          className={`mt-0.5 flex h-9 items-center justify-center rounded-md border text-[11px] font-bold ${TONE_KOTAK_HARI[d.status ? REPORT_STATUS_TONE[d.status] : "neutral"]}`}
                        >
                          {d.status ? REPORT_STATUS_LABEL[d.status].slice(0, 1) : "–"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
