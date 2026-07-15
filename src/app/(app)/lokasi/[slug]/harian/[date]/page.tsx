import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, ClipboardList, History, Printer, TriangleAlert } from "lucide-react";
import { Badge, Banner, Card, CardBody, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { PhotoGallery } from "@/components/knmp/photo-gallery";
import { isR2Configured } from "@/lib/r2";
import { requireUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import { formatNumber, formatRupiah, formatTanggal, jakartaDateKey, parseDateKey } from "@/lib/format";
import { getLeafNodeOptions, getWorkspaceData } from "@/lib/daily-report/queries";
import { ISSUE_SEVERITY_LABEL, WEATHER_LABEL, WORKER_ROLE_LABEL } from "@/lib/daily-report/constants";
import { ReportEditor } from "./report-editor";
import { EnrichmentForm } from "./enrichment-form";
import { FinalizePanel, IssueForm, ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Laporan Harian" };
export const dynamic = "force-dynamic";

const SEVERITY_TONE = { rendah: "neutral", sedang: "info", tinggi: "warning", kritis: "danger" } as const;

/**
 * WORKSPACE HARIAN SATU LAYAR — draft/koreksi (input SM), verifikasi (PM/SM),
 * finalisasi + cetak. Halaman berdiri sendiri (tidak bergantung layout lokasi).
 */
export default async function HarianWorkspacePage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}) {
  const { slug, date } = await params;
  if (!parseDateKey(date)) notFound();

  const user = await requireUser();
  const data = await getWorkspaceData(slug, date);
  if (!data) notFound();
  if (!(await hasLocationAccess(user, data.location.id))) notFound();

  const todayKey = jakartaDateKey(new Date());
  const isFuture = date > todayKey;
  const report = data.report;
  const status = report?.status ?? null;

  const canCreate = can(user.role, "daily_report.create");
  const canReview = can(user.role, "daily_report.review");
  const canFinalize = can(user.role, "daily_report.finalize");

  const editable = canCreate && !isFuture && (!report || status === "draft" || status === "perlu_koreksi");
  const enrichable = !!report && canReview && (status === "draft" || status === "perlu_koreksi" || status === "dikirim");
  const showReadOnlyItems = !!report && report.items.length > 0 && !editable;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Hari Ini", href: "/hari-ini" },
          { label: data.location.name },
          { label: formatTanggal(parseDateKey(date)!) },
        ]}
        eyebrow={data.location.name}
        title={`Laporan ${formatTanggal(parseDateKey(date)!, "EEEE, d MMMM yyyy")}`}
        description={
          report
            ? `${report.items.length} item · nilai hari ini ${formatRupiah(BigInt(report.totalValueToday))}`
            : "Belum ada laporan untuk tanggal ini."
        }
        actions={<StatusPill tone={status ? REPORT_STATUS_TONE[status] : "neutral"} label={status ? REPORT_STATUS_LABEL[status] : "Belum Ada"} />}
      />

      {isFuture ? (
        <Banner
          tone="info"
          title="Tanggal ini belum terjadi"
          description={
            <Link href={`/lokasi/${slug}/harian/${todayKey}`} className="font-medium text-primary hover:underline">
              Buka laporan hari ini →
            </Link>
          }
        />
      ) : null}

      {/* Input item (draft / perlu_koreksi) */}
      {editable ? (
        <ReportEditor
          locationId={data.location.id}
          slug={slug}
          dateKey={date}
          reportId={report?.id ?? null}
          nodes={await getLeafNodeOptions(data.location.id)}
          items={report?.items ?? []}
          correctionReason={status === "perlu_koreksi" ? report?.lastCorrectionReason ?? null : null}
          photoEnabled={isR2Configured()}
        />
      ) : null}

      {/* Daftar item read-only (≥ dikirim atau viewer) */}
      {showReadOnlyItems && report ? (
        <Card>
          <CardHeader
            title={`Item pekerjaan (${report.items.length})`}
            subtitle={`Nilai hari ini ${formatRupiah(BigInt(report.totalValueToday))}`}
          />
          <CardBody className="px-0 py-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                    <th className="py-2 pr-3 pl-4">Uraian</th>
                    <th className="py-2 pr-3 text-right">Hari ini</th>
                    <th className="py-2 pr-3 text-right">Kumulatif</th>
                    <th className="py-2 pr-4 text-right">Nilai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 pr-3 pl-4">
                        <div className="font-medium text-ink">{it.name}</div>
                        <div className="text-xs text-ink-muted">{it.code}</div>
                        {it.notes ? <div className="text-xs text-ink-faint">“{it.notes}”</div> : null}
                        {/* Foto bukti per item — reviewer bisa verifikasi tiap pekerjaan. */}
                        {it.photos.length > 0 ? (
                          <div className="mt-1.5">
                            <PhotoGallery photos={it.photos} thumbClass="h-14 w-14" />
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular whitespace-nowrap">
                        {formatNumber(it.volumeDone)} {it.unit ?? ""}
                      </td>
                      <td className="py-2 pr-3 text-right tabular whitespace-nowrap">
                        {formatNumber(it.volumeCumulative)}
                        {it.volumeContract != null ? ` / ${formatNumber(it.volumeContract)}` : ""}
                        {it.pctCumulative != null
                          ? ` (${it.pctCumulative.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)`
                          : ""}
                      </td>
                      <td className="py-2 pr-4 text-right tabular whitespace-nowrap">
                        {formatRupiah(BigInt(it.valueDone))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Verifikasi (dikirim) */}
      {report && status === "dikirim" && canReview ? <ReviewActions reportId={report.id} /> : null}

      {/* Pelengkap KKP.
          key = tanda-tangan isi pelengkap: setEnrichment membuat ulang baris dgn
          id baru tiap simpan, jadi key berubah → form remount & menampilkan data
          tersimpan yang terbaru (memperbaiki desync state klien setelah aksi). */}
      {report && enrichable ? (
        <EnrichmentForm
          key={[report.weather, report.workStart, report.workEnd, ...report.materials.map((m) => m.id), ...report.equipment.map((e) => e.id)].join("|")}
          report={report}
        />
      ) : report && (report.weather || report.workers.length || report.materials.length || report.equipment.length || report.workStart) ? (
        <Card>
          <CardHeader title="Pelengkap laporan KKP" />
          <CardBody className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <span className="text-ink-muted">Cuaca:</span>{" "}
                {report.weather ? WEATHER_LABEL[report.weather] : "—"}
              </span>
              <span>
                <span className="text-ink-muted">Jam kerja:</span> {report.workStart ?? "…"}–{report.workEnd ?? "…"}
              </span>
              <span>
                <span className="text-ink-muted">Tenaga:</span>{" "}
                {report.workers.reduce((n, w) => n + w.count, 0)} orang
              </span>
            </div>
            {report.workers.length ? (
              <p className="text-xs text-ink-muted">
                {report.workers.map((w) => `${WORKER_ROLE_LABEL[w.role]} ${w.count}`).join(" · ")}
              </p>
            ) : null}
            {report.materials.length ? (
              <p className="text-xs text-ink-muted">
                Material: {report.materials.map((m) => `${m.name}${m.qty != null ? ` ${formatNumber(m.qty)} ${m.unit ?? ""}` : ""}`).join(" · ")}
              </p>
            ) : null}
            {report.equipment.length ? (
              <p className="text-xs text-ink-muted">
                Alat: {report.equipment.map((e) => `${e.name}${e.count > 1 ? ` (${e.count})` : ""}`).join(" · ")}
              </p>
            ) : null}
            {report.notes ? <p className="text-xs text-ink-muted">Catatan: {report.notes}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      {/* Finalisasi (disetujui) + link cetak (final) */}
      {report && status === "disetujui" && canFinalize ? (
        <FinalizePanel reportId={report.id} slug={slug} dateKey={date} isFinal={false} />
      ) : null}
      {report && status === "final" ? (
        <FinalizePanel reportId={report.id} slug={slug} dateKey={date} isFinal />
      ) : null}
      {report && (status === "dikirim" || status === "disetujui") ? (
        <p className="text-right">
          <Link
            href={`/cetak/harian/${slug}/${date}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Printer aria-hidden className="size-4" />
            Pratinjau format KKP
          </Link>
        </p>
      ) : null}

      {/* Foto */}
      {report && report.photos.length > 0 ? (
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <Camera aria-hidden className="size-4 text-ink-muted" />
                Foto lapangan ({report.photos.length})
              </span>
            }
          />
          <CardBody>
            <PhotoGallery photos={report.photos} />
          </CardBody>
        </Card>
      ) : null}

      {/* Kendala hari itu */}
      {report ? (
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <TriangleAlert aria-hidden className="size-4 text-ink-muted" />
                Kendala hari ini ({report.issues.length})
              </span>
            }
          />
          <CardBody className="space-y-3">
            {report.issues.length ? (
              <ul className="space-y-2">
                {report.issues.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{i.title}</p>
                      {i.description ? <p className="text-xs text-ink-muted">{i.description}</p> : null}
                    </div>
                    <Badge tone={SEVERITY_TONE[i.severity]} label={ISSUE_SEVERITY_LABEL[i.severity]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Tidak ada kendala tercatat.</p>
            )}
            <IssueForm reportId={report.id} />
          </CardBody>
        </Card>
      ) : null}

      {/* Riwayat status */}
      {report && report.history.length > 0 ? (
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <History aria-hidden className="size-4 text-ink-muted" />
                Riwayat status
              </span>
            }
          />
          <CardBody className="px-0 py-0">
            <ul className="divide-y divide-border">
              {report.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    {h.fromStatus ? (
                      <>
                        <StatusPill tone={REPORT_STATUS_TONE[h.fromStatus]} label={REPORT_STATUS_LABEL[h.fromStatus]} />
                        <span aria-hidden className="text-ink-faint">→</span>
                      </>
                    ) : null}
                    <StatusPill tone={REPORT_STATUS_TONE[h.toStatus]} label={REPORT_STATUS_LABEL[h.toStatus]} />
                  </span>
                  <span className="text-ink-muted">
                    oleh {h.changedByName} · {formatTanggal(new Date(h.changedAt), "d MMM yyyy HH.mm")}
                  </span>
                  {h.reason ? <span className="w-full text-xs text-warning">Alasan: {h.reason}</span> : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* 14 hari terakhir */}
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <ClipboardList aria-hidden className="size-4 text-ink-muted" />
              14 hari terakhir
            </span>
          }
        />
        <CardBody className="px-0 py-0">
          <ul className="divide-y divide-border">
            {data.recentDays.map((d) => (
              <li key={d.dateKey}>
                <Link
                  href={`/lokasi/${slug}/harian/${d.dateKey}`}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted ${
                    d.dateKey === date ? "bg-primary-50" : ""
                  }`}
                >
                  <span className="font-medium text-ink">{formatTanggal(parseDateKey(d.dateKey)!, "EEE, d MMM")}</span>
                  <span className="flex items-center gap-2">
                    {d.status ? (
                      <>
                        <span className="text-xs text-ink-muted">{d.itemCount} item</span>
                        <StatusPill tone={REPORT_STATUS_TONE[d.status]} label={REPORT_STATUS_LABEL[d.status]} />
                      </>
                    ) : (
                      <span className="text-xs text-ink-faint">Tidak ada laporan</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
