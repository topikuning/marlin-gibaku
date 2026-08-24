import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, KpiCard, PageHeader, StatusPill, SubTabs } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { papanTemuan } from "@/lib/findings/queries";
import { formatTanggal } from "@/lib/format";
import {
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TONE,
  INSPECTION_STATUS_LABEL,
  INSPECTION_STATUS_TONE,
  REPORT_STATUS_LABEL,
  REPORT_VERIF_STATUS_LABEL,
  REPORT_VERIF_STATUS_TONE,
} from "@/lib/lifecycle";
import type { DailyReportStatus } from "@/generated/prisma/enums";
import { bacaSubTab, hrefSubTab } from "@/lib/ui/sub-tab";
import { antreanVerifikasi, daftarInspeksi } from "@/lib/verifikasi/queries";

export const metadata: Metadata = { title: "Verifikasi" };
export const dynamic = "force-dynamic";

const BAGIAN = ["antrean", "inspeksi", "temuan"] as const;

export default async function VerifikasiPage({
  searchParams,
}: {
  searchParams: Promise<{ bagian?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.verify_external");
  const sp = await searchParams;
  const bagian = bacaSubTab(BAGIAN, sp.bagian, "antrean");
  const href = (b: string) => hrefSubTab("/verifikasi", b);

  const [{ belumDiperiksa, sudahDiperiksa }, inspeksi, temuan] = await Promise.all([
    antreanVerifikasi(user),
    daftarInspeksi(user),
    papanTemuan(user, {}),
  ]);
  const temuanMenunggu = temuan.baris.filter((t) => t.status === "menunggu_verifikasi");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Verifikasi"
        description="Workspace pemeriksaan – laporan harian, inspeksi lapangan, dan temuan di lokasi penugasan Anda."
        actions={<ButtonLink href="/verifikasi/inspeksi/baru">Catat inspeksi</ButtonLink>}
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard
          label="Laporan belum diperiksa"
          value={belumDiperiksa.length}
          tone={belumDiperiksa.length > 0 ? "warning" : "default"}
          href={href("antrean")}
        />
        <KpiCard label="Temuan terbuka" value={temuan.ringkas.terbuka} href="/temuan?status=terbuka" />
        <KpiCard
          label="Temuan menunggu verifikasi"
          value={temuanMenunggu.length}
          tone={temuanMenunggu.length > 0 ? "warning" : "default"}
          href={href("temuan")}
        />
        <KpiCard label="Inspeksi tercatat" value={inspeksi.length} href={href("inspeksi")} />
      </section>

      <SubTabs
        label="Bagian verifikasi"
        active={bagian}
        items={[
          { key: "antrean", label: "Antrean Laporan", labelPendek: "Antrean", href: href("antrean"), badge: belumDiperiksa.length || undefined },
          { key: "inspeksi", label: "Inspeksi Lapangan", labelPendek: "Inspeksi", href: href("inspeksi") },
          { key: "temuan", label: "Temuan Menunggu Verifikasi", labelPendek: "Temuan", href: href("temuan"), badge: temuanMenunggu.length || undefined },
        ]}
      />

      {bagian === "antrean" ? (
        <>
          <Card>
            <CardHeader title={`${belumDiperiksa.length} laporan belum diperiksa`} subtitle="Terlama menunggu di atas – klik untuk membuka laporan aslinya" />
            <CardBody>
              {belumDiperiksa.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="Tidak ada laporan yang menunggu"
                  description="Semua laporan terkirim di lokasi penugasan Anda sudah diperiksa – atau belum ada penugasan lokasi."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {belumDiperiksa.map((b) => (
                    <li key={b.reportId}>
                      <Link
                        href={`/lokasi/${b.locationSlug}/harian/${b.dateKey}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-muted"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{b.locationName}</span>
                          <span className="text-sm text-ink-muted"> · {formatTanggal(b.reportDate)}</span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-ink-muted">
                          <span>{b.itemCount} item · {b.photoCount} foto</span>
                          <Badge tone="info" label={REPORT_STATUS_LABEL[b.status as DailyReportStatus] ?? b.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`${sudahDiperiksa.length} laporan sudah diperiksa`} subtitle="Hasil pemeriksaan terakhir per laporan" />
            <CardBody>
              {sudahDiperiksa.length === 0 ? (
                <p className="text-sm text-ink-muted">Belum ada laporan yang diperiksa.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sudahDiperiksa.slice(0, 50).map((b) => (
                    <li key={b.reportId}>
                      <Link
                        href={`/lokasi/${b.locationSlug}/harian/${b.dateKey}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-muted"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{b.locationName}</span>
                          <span className="text-sm text-ink-muted"> · {formatTanggal(b.reportDate)}</span>
                        </span>
                        {b.verif ? (
                          <StatusPill tone={REPORT_VERIF_STATUS_TONE[b.verif.status]} label={REPORT_VERIF_STATUS_LABEL[b.verif.status]} />
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}

      {bagian === "inspeksi" ? (
        <Card>
          <CardHeader title={`${inspeksi.length} inspeksi`} action={<ButtonLink href="/verifikasi/inspeksi/baru" size="sm">Catat inspeksi</ButtonLink>} />
          <CardBody>
            {inspeksi.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="Belum ada inspeksi" description="Catat inspeksi lapangan pertama Anda." />
            ) : (
              <ul className="divide-y divide-border">
                {inspeksi.map((i) => (
                  <li key={i.id}>
                    <Link href={`/verifikasi/inspeksi/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{i.title}</span>
                        <span className="text-sm text-ink-muted"> · {i.location.name} · {formatTanggal(i.inspectionDate)}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-ink-muted">
                        <span>{i._count.findings} temuan · {i._count.evidences} bukti</span>
                        <StatusPill tone={INSPECTION_STATUS_TONE[i.status]} label={INSPECTION_STATUS_LABEL[i.status]} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {bagian === "temuan" ? (
        <Card>
          <CardHeader title={`${temuanMenunggu.length} temuan menunggu verifikasi Anda`} />
          <CardBody>
            {temuanMenunggu.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="Tidak ada yang menunggu" description="Tidak ada temuan berstatus menunggu verifikasi di lokasi penugasan Anda." />
            ) : (
              <ul className="divide-y divide-border">
                {temuanMenunggu.map((t) => (
                  <li key={t.id}>
                    <Link href={`/temuan/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{t.title}</span>
                        <span className="text-sm text-ink-muted"> · {t.locationName}</span>
                      </span>
                      <StatusPill tone={FINDING_STATUS_TONE[t.status]} label={FINDING_STATUS_LABEL[t.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
