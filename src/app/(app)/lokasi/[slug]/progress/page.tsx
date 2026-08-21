import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, ListTree, Sheet, Sparkles, UploadCloud } from "lucide-react";
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  SubTabs,
  type BadgeTone,
} from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { ScurveChart } from "@/components/knmp/scurve-chart";
import { forecastFromSeries, FORECAST_STATUS } from "@/lib/forecast";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { cumulativeVolumeByLineage, getProgresDraftAdendum } from "@/lib/progress";
import { itemPlanFracDariJadwal, laggingItems } from "@/lib/progress-calc";
import { bacaBagianProgress, hrefBagianProgress, type BagianProgress } from "@/lib/progress-bagian";
import { getPeriodBounds } from "@/lib/periodic-report";
import { deriveCategorySchedule, getScurveSeries } from "@/lib/baseline";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort, formatTanggal } from "@/lib/format";
import type { BaselineSource, RevisionStatus } from "@/generated/prisma/enums";
import { requireLocationPage } from "../get-location";
import { IssuesPanel, type IssueData } from "./issues-client";
import { RecalcBaselineButton } from "./recalc-baseline";
import { BaselineEditor } from "./baseline-editor";
import { ScheduleEditor } from "./schedule-editor";
import { BaselineHistory, type BaselineHistoryRow } from "./baseline-history";
import { PerbaruiKurvaS } from "./perbarui-kurva-s";
import { withBackTo } from "@/lib/print-back";

export const metadata: Metadata = { title: "Progress Lokasi" };
export const dynamic = "force-dynamic";

/**
 * PROGRESS LOKASI — memantau dipisah dari mengatur (DECISIONS 363).
 *
 * Sebelumnya delapan kartu ditumpuk dalam satu gulungan: kurva-S, tabel
 * mingguan, prognosa, editor jadwal, penyesuaian halus %-mingguan, item
 * tertinggal, kendala, dan riwayat baseline. Dua peran yang sangat berbeda
 * dijejalkan jadi satu halaman — **membaca angka** dan **mengubah rencana** —
 * sehingga orang yang cuma ingin melihat deviasi harus melewati editor, dan
 * orang yang mau memperbarui kurva-S harus menemukan tempatnya jauh di bawah
 * grafik.
 *
 * Empat bagian mengikuti rancangan user 2026-08-18. Tidak ada fungsi yang
 * berubah: seluruh aksi, gerbang izin, dan komponennya persis yang lama —
 * hanya letaknya, dan bagian mana yang dikirim ke peramban.
 */

const BASELINE_SOURCE_LABEL: Record<BaselineSource, string> = {
  auto: "Otomatis (impor RAB)",
  adendum: "Adendum",
  manual: "Edit manual",
};

const BASELINE_STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft",
  aktif: "Aktif",
  digantikan: "Digantikan",
};

const BASELINE_STATUS_TONE: Record<RevisionStatus, BadgeTone> = {
  draft: "warning",
  aktif: "success",
  digantikan: "neutral",
};

export default async function ProgressLokasiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ bagian?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "progress.view");
  const canManageIssues = can(user.role, "issue.manage");
  const canManageBaseline = can(user.role, "baseline.manage");
  const bagian = bacaBagianProgress(sp.bagian);

  /*
   * Tiap bagian hanya membayar kuerinya sendiri.
   *
   * Yang lama menarik SEMUANYA setiap kali halaman dibuka: seluruh isu beserta
   * aksi dan log perkembangannya, seluruh baseline beserta titik mingguannya,
   * jadwal kategori, volume kumulatif per lineage, dan seluruh item RAB aktif
   * untuk menghitung yang tertinggal. Orang yang cuma melirik kurva-S membayar
   * semuanya.
   *
   * `series` tetap selalu diambil — ia sumber angka utama halaman ini dan
   * dipakai lintas bagian (grafik, prognosa, dan target proporsional untuk item
   * tertinggal).
   */
  const [series, bounds] = await Promise.all([
    getScurveSeries(location.id),
    getPeriodBounds(location.id, { assume: true }),
  ]);

  // Prognosa (forecast) jadwal/fisik — derived dari kurva-S. Tanggal hanya bila
  // SPMK sudah terbit (bounds.assume=false); pra-SPMK cukup minggu & status.
  const forecast = forecastFromSeries(series, bounds && !bounds.assumed ? bounds.startDate : null);
  const fcStatus = FORECAST_STATUS[forecast.status];

  const href = (b: BagianProgress) => hrefBagianProgress(slug, b);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Progress"
          subtitle={
            series.totalWeeks > 0
              ? `Minggu ${series.currentWeek} dari ${series.totalWeeks} · rencana ${formatPct(
                  series.planPct[series.currentWeek - 1] ?? 0,
                )} · realisasi ${formatPct(series.actualPct[series.currentWeek - 1] ?? 0)}`
              : "Belum ada baseline kurva-S untuk lokasi ini."
          }
          action={
            bounds ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* Jalan masuk alur "Perbarui Kurva-S" dari MANA PUN di halaman
                    ini. Pertanyaan yang paling sering muncul adalah "di mana
                    saya unggah template kurva-S?", dan jawabannya harus terlihat
                    tanpa harus tahu bahwa ia ada di dalam tab Baseline. */}
                {canManageBaseline ? (
                  <ButtonLink href={href("baseline")} variant="primary" size="sm">
                    <UploadCloud aria-hidden className="size-4" />
                    Perbarui Kurva-S
                  </ButtonLink>
                ) : null}
                <Link
                  // Kembali ke BAGIAN yang sedang dibuka, bukan selalu ke
                  // ringkasan: tombol cetak ada di header yang tampil di semua
                  // bagian, jadi mengembalikan orang ke tempat lain berarti ia
                  // harus mencari lagi posisinya sendiri.
                  href={withBackTo(`/cetak/jadwal/${slug}`, href(bagian))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-muted"
                >
                  <CalendarClock aria-hidden className="size-4" /> Cetak Jadwal
                </Link>
                <a
                  href={`/lokasi/${slug}/jadwal/export`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-muted"
                >
                  <Sheet aria-hidden className="size-4" /> Unduh Excel
                </a>
                <a
                  href={`/lokasi/${slug}/jadwal/rincian`}
                  title="Rincian sampai uraian item: volume, harga satuan, jumlah, dan bobot tiap baris. Kolom jadwalnya adalah jadwal KATEGORI induk – sistem tidak menyimpan jadwal per item."
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-muted"
                >
                  <ListTree aria-hidden className="size-4" /> Rincian Item
                </a>
              </div>
            ) : null
          }
        />

        <SubTabs
          label="Bagian Progress"
          active={bagian}
          items={[
            { key: "ringkasan", label: "Ringkasan Progress", labelPendek: "Ringkasan", href: href("ringkasan") },
            { key: "baseline", label: "Kurva-S & Baseline", labelPendek: "Baseline", href: href("baseline") },
            { key: "jadwal", label: "Jadwal Pekerjaan", labelPendek: "Jadwal", href: href("jadwal") },
            { key: "kendala", label: "Tertinggal & Kendala", labelPendek: "Kendala", href: href("kendala") },
          ]}
        />

        <CardBody className="p-0">
          {bagian === "ringkasan" ? (
            <BagianRingkasan
              slug={slug}
              locationId={location.id}
              series={series}
              forecast={forecast}
              fcStatus={fcStatus}
              bounds={bounds}
              bisaAi={can(user.role, "ai.view")}
            />
          ) : null}

          {bagian === "baseline" ? (
            <BagianBaseline locationId={location.id} slug={slug} canManage={canManageBaseline} />
          ) : null}

          {bagian === "jadwal" ? (
            <BagianJadwal locationId={location.id} canManage={canManageBaseline} />
          ) : null}

          {bagian === "kendala" ? (
            <BagianKendala
              locationId={location.id}
              planNow={series.planPct[series.currentWeek - 1] ?? 0}
              currentWeek={series.currentWeek}
              canManageIssues={canManageIssues}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

/* ── 1. Ringkasan ────────────────────────────────────────────────────────── */

async function BagianRingkasan({
  slug,
  locationId,
  series,
  forecast,
  fcStatus,
  bounds,
  bisaAi,
}: {
  slug: string;
  locationId: string;
  series: Awaited<ReturnType<typeof getScurveSeries>>;
  forecast: ReturnType<typeof forecastFromSeries>;
  fcStatus: (typeof FORECAST_STATUS)[keyof typeof FORECAST_STATUS];
  bounds: Awaited<ReturnType<typeof getPeriodBounds>>;
  bisaAi: boolean;
}) {
  // Progres terhadap draft adendum — ditampilkan HANYA bila lokasinya memang
  // sedang punya draft. Angka ini bukan angka resmi (DECISIONS 210).
  const draftProg = await getProgresDraftAdendum(locationId);

  return (
    <div className="space-y-3 p-3">
      {draftProg ? (
        <section className="rounded-lg border border-warning-border bg-warning-soft p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">
                Pantauan internal – progres atas usulan adendum (draft revisi #{draftProg.revisionNo})
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Laporan sampingan untuk kebutuhan internal. BUKAN angka resmi: termin, kurva-S,
                laporan periodik, dan blanko KKP tetap memakai RAB kontrak yang berlaku.
              </p>
            </div>
            <ButtonLink href={`/lokasi/${slug}/rab/adendum`} variant="secondary" size="sm">
              Buka draft adendum
              <ArrowRight aria-hidden className="size-3.5" />
            </ButtonLink>
          </div>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <p className="text-[11px] tracking-wide text-ink-faint uppercase">Nilai RAB draft</p>
              <p className="tabular text-sm font-semibold text-ink">
                {formatRupiah(Number(draftProg.grandTotal))}
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <p className="text-[11px] tracking-wide text-ink-faint uppercase">
                Terpasang menurut draft
              </p>
              <p className="tabular text-sm font-semibold text-ink">
                {formatRupiah(Number(draftProg.realizedValue))}{" "}
                <span className="font-normal text-ink-muted">({formatPct(draftProg.realizedPct)})</span>
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <p className="text-[11px] tracking-wide text-ink-faint uppercase">
                Terpasang menurut RAB resmi
              </p>
              <p className="tabular text-sm font-semibold text-ink">
                {formatRupiah(Number(draftProg.realizedValueResmi))}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            {draftProg.barisBasisDraft === 0
              ? "Belum ada baris laporan yang dicatat terhadap draft ini – angka di atas berasal dari laporan yang sudah ada, dinilai memakai RAB draft."
              : `${draftProg.barisBasisDraft} baris laporan dicatat terhadap draft ini (pekerjaan yang belum ada dasarnya di kontrak berjalan).`}
          </p>
        </section>
      ) : null}

      {/* `min-w-0` pada KEDUA anak grid: tanpa itu anak grid memakai lebar
          MIN-CONTENT-nya, dan grafik kurva-S maupun tabel mingguan punya
          min-content yang lebih lebar dari kolomnya — halaman lalu bisa digeser
          ke samping di 375px. Pola yang sama dengan DECISIONS 217. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-border">
          <header className="border-b border-border px-3 py-2">
            <p className="text-[13px] font-semibold text-ink">Kurva-S</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">Baseline aktif vs realisasi mingguan</p>
          </header>
          <div className="p-3">
            <ScurveChart series={series} forecast={forecast.enoughData ? forecast.forecastPct : null} />
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-border">
          <header className="border-b border-border px-3 py-2">
            <p className="text-[13px] font-semibold text-ink">Rencana vs realisasi per minggu</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Untuk membaca deviasi. Mengubah rencananya ada di bagian Baseline.
            </p>
          </header>
          {series.totalWeeks === 0 ? (
            <p className="p-3 text-sm text-ink-muted">Belum ada baseline.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                    <th className="px-3 py-1.5">Minggu</th>
                    <th className="px-3 py-1.5 text-right">Rencana</th>
                    <th className="px-3 py-1.5 text-right">Realisasi</th>
                    <th className="px-3 py-1.5">Deviasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {series.planPct.map((plan, i) => {
                    const actual = series.actualPct[i];
                    const isCurrent = i + 1 === series.currentWeek;
                    return (
                      <tr key={i} className={isCurrent ? "bg-surface-muted font-medium" : undefined}>
                        <td className="tabular px-3 py-1.5">
                          {i + 1}
                          {isCurrent ? " (berjalan)" : ""}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">{formatPct(plan)}</td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {actual == null ? "–" : formatPct(actual)}
                        </td>
                        <td className="px-3 py-1.5">
                          {actual == null ? (
                            <span className="text-ink-faint">–</span>
                          ) : (
                            <DeltaBadge value={actual - plan} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {series.totalWeeks > 0 ? (
        <section className="rounded-lg border border-border">
          <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">Prognosa penyelesaian</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Proyeksi ke depan dari laju realisasi terkini + kinerja kumulatif (SPI). Estimasi
                berbasis tren, bukan kepastian.
              </p>
            </div>
            {bisaAi ? (
              <ButtonLink href={`/ai?scopeIds=${locationId}`} variant="ghost" size="sm">
                <Sparkles aria-hidden className="size-3.5" />
                Jelaskan dengan AI
              </ButtonLink>
            ) : null}
          </header>
          <div className="p-3">
            {!forecast.enoughData ? (
              <p className="text-sm text-ink-muted">
                {fcStatus.label} – prognosa tampil setelah ada realisasi minimal 2 minggu.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Status
                  </div>
                  <div className="mt-1.5">
                    <Badge tone={fcStatus.tone} label={fcStatus.label} />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Prognosa selesai
                  </div>
                  <div className="mt-1 text-base font-semibold text-ink">
                    {forecast.beyondHorizon
                      ? "Belum bisa diperkirakan"
                      : forecast.forecastFinishDate
                        ? formatTanggal(forecast.forecastFinishDate)
                        : `± minggu ${Math.round(forecast.forecastFinishWeek ?? forecast.totalWeeks)}`}
                  </div>
                  <div className="text-[12px] text-ink-muted">
                    rencana:{" "}
                    {bounds && !bounds.assumed ? formatTanggal(bounds.endDate) : `minggu ${forecast.totalWeeks}`}
                    {forecast.beyondHorizon
                      ? " · laju realisasi terlalu rendah – proyeksi jatuh >1 tahun melewati rencana"
                      : forecast.slipWeeks != null
                        ? ` · ${forecast.slipWeeks <= 0 ? "tepat / lebih cepat" : `perkiraan telat ~${forecast.slipWeeks} mgg`}`
                        : ""}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Realisasi vs rencana (mgg {forecast.currentWeek})
                  </div>
                  <div className="mt-1 text-base font-semibold text-ink">
                    {formatPct(forecast.actualPct)}{" "}
                    <span className="text-ink-muted">/ {formatPct(forecast.planPct)}</span>
                  </div>
                  <div className="mt-1">
                    <DeltaBadge value={forecast.deviationPct} />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-inset p-3">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Laju terkini / dibutuhkan
                  </div>
                  <div className="mt-1 text-base font-semibold text-ink">
                    {forecast.velocityPerWeek != null ? `${forecast.velocityPerWeek.toFixed(2)}%` : "–"}
                    <span className="text-ink-muted">
                      {" / "}
                      {forecast.requiredPerWeek != null ? `${forecast.requiredPerWeek.toFixed(2)}%` : "–"}/mgg
                    </span>
                  </div>
                  {forecast.spi != null ? (
                    <div className="text-[12px] text-ink-muted">SPI {forecast.spi.toFixed(2)}</div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ── 2. Kurva-S & Baseline ───────────────────────────────────────────────── */

async function BagianBaseline({
  locationId,
  slug,
  canManage,
}: {
  locationId: string;
  slug: string;
  canManage: boolean;
}) {
  const baselines = await db.baseline.findMany({
    where: { locationId },
    orderBy: { baselineNo: "desc" },
    select: {
      id: true,
      baselineNo: true,
      source: true,
      status: true,
      contractDays: true,
      note: true,
      createdAt: true,
      points: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, plannedPct: true } },
    },
  });
  const activeBaseline = baselines.find((b) => b.status === "aktif");

  const historyRows: BaselineHistoryRow[] = baselines.map((b) => ({
    id: b.id,
    baselineNo: b.baselineNo,
    sourceLabel: BASELINE_SOURCE_LABEL[b.source],
    statusLabel: BASELINE_STATUS_LABEL[b.status],
    statusTone: BASELINE_STATUS_TONE[b.status],
    isActive: b.status === "aktif",
    contractDays: b.contractDays,
    note: b.note,
    createdAtLabel: formatTanggal(b.createdAt),
    points: b.points.map((p) => Number(p.plannedPct)),
  }));

  return (
    <div className="space-y-3 p-3">
      {/* Apa yang SEDANG berlaku disebut lebih dulu. Semua deviasi di bagian
          Ringkasan dihitung terhadap baseline ini, dan tanpa menyebutnya orang
          membandingkan angka dengan rencana yang ia kira masih berlaku. */}
      {activeBaseline ? (
        <section className="rounded-lg border border-success-border bg-success-soft p-3">
          <p className="text-[13px] font-semibold text-ink">
            Baseline aktif: v{activeBaseline.baselineNo} · {activeBaseline.points.length} minggu
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Sumber: {BASELINE_SOURCE_LABEL[activeBaseline.source]} · dibuat{" "}
            {formatTanggal(activeBaseline.createdAt)}. Seluruh progress dan deviasi saat ini
            dibandingkan dengan baseline ini.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-warning-border bg-warning-soft p-3">
          <p className="text-[13px] font-semibold text-ink">Belum ada baseline aktif</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Tanpa baseline, tidak ada rencana untuk dibandingkan – deviasi dan prognosa tidak bisa
            dihitung. Baseline terbentuk otomatis saat RAB diimpor, atau bisa dihitung ulang di sini.
          </p>
        </section>
      )}

      {canManage ? (
        <PerbaruiKurvaS
          locationId={locationId}
          slug={slug}
          baselineAktif={activeBaseline?.baselineNo ?? null}
        />
      ) : null}

      {canManage ? (
        <section className="rounded-lg border border-border p-3">
          <p className="text-[13px] font-semibold text-ink">Cara lain: hitung ulang dari RAB</p>
          <p className="mt-0.5 mb-2 text-[11px] text-ink-muted">
            Tanpa Excel – sistem menyusun ulang jadwal dari RAB aktif. Dipakai saat RAB berubah
            (mis. sesudah adendum), bukan saat Anda punya jadwal sendiri. Versi lama tidak dihapus.
          </p>
          <RecalcBaselineButton locationId={locationId} />
        </section>
      ) : null}

      {canManage && activeBaseline && activeBaseline.points.length > 0 ? (
        <section className="rounded-lg border border-border">
          <header className="border-b border-border px-3 py-2">
            <p className="text-[13px] font-semibold text-ink">Penyesuaian halus %-mingguan</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Koreksi kecil deret %-kumulatif per minggu (mis. menyamakan dengan angka pengawas).
              Jadwal per pekerjaan ikut menyesuaikan.
            </p>
          </header>
          <div className="p-3">
            <BaselineEditor
              locationId={locationId}
              baselineId={activeBaseline.id}
              initial={activeBaseline.points.map((p) => Number(p.plannedPct))}
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-border">
        <header className="border-b border-border px-3 py-2">
          <p className="text-[13px] font-semibold text-ink">Riwayat baseline</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Baseline tidak pernah diedit in place – setiap perubahan membuat versi baru. Centang
            beberapa versi untuk membandingkan kurvanya; versi lama bisa dipulihkan (dibuat sebagai
            salinan baru).
          </p>
        </header>
        <div className="p-3">
          <BaselineHistory baselines={historyRows} canManage={canManage} />
        </div>
      </section>
    </div>
  );
}

/* ── 3. Jadwal pekerjaan ─────────────────────────────────────────────────── */

async function BagianJadwal({
  locationId,
  canManage,
}: {
  locationId: string;
  canManage: boolean;
}) {
  if (!canManage) {
    return (
      <div className="p-4">
        <p className="text-sm text-ink-muted">
          Mengatur jadwal pekerjaan butuh wewenang kelola baseline. Jadwal yang berlaku bisa dilihat
          lewat “Cetak Jadwal” dan “Unduh Excel” di atas.
        </p>
      </div>
    );
  }

  const schedule = await deriveCategorySchedule(locationId);
  if (!schedule) {
    return (
      <div className="p-4">
        <p className="text-sm text-ink-muted">
          Jadwal per pekerjaan butuh RAB aktif dan baseline. Impor RAB terlebih dahulu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <p className="rounded-md border border-info-border bg-info-soft p-2.5 text-[11px] text-ink-muted">
        Ini editor teknis, bukan halaman pantau. Atur rentang minggu tiap pekerjaan – boleh lebih
        dari satu rentang bila terputus (jeda); bobot mengikuti RAB. Punya jadwal dari Excel? Pakai
        alur <strong className="font-semibold text-ink">Perbarui Kurva-S</strong> di bagian Baseline –
        di sana berkasnya diperiksa dulu sebelum diterapkan.
      </p>
      <ScheduleEditor
        locationId={locationId}
        totalWeeks={schedule.totalWeeks}
        origin={schedule.origin}
        initial={schedule.rows}
      />
    </div>
  );
}

/* ── 4. Tertinggal & kendala ─────────────────────────────────────────────── */

async function BagianKendala({
  locationId,
  planNow,
  currentWeek,
  canManageIssues,
}: {
  locationId: string;
  planNow: number;
  currentWeek: number;
  canManageIssues: boolean;
}) {
  const planFraction = planNow / 100;

  type LaggingItem = {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    volume: number;
    expected: number;
    realized: number;
    gapValue: number;
  };

  const [realizedVol, issues, activeItems, jadwalItem] = await Promise.all([
    planFraction > 0 ? cumulativeVolumeByLineage(locationId) : Promise.resolve(new Map<string, number>()),
    db.issue.findMany({
      // Kembar yang sudah digabungkan berhenti muncul di sini: baris yang
      // hilang setelah digabungkan justru umpan balik yang benar.
      where: { locationId, mergedIntoId: null },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        createdAt: true,
        actions: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            description: true,
            picName: true,
            dueDate: true,
            status: true,
            updates: {
              orderBy: { createdAt: "asc" },
              select: { id: true, note: true, createdAt: true },
            },
          },
        },
      },
    }),
    planFraction > 0
      ? db.rabNode.findMany({
          where: { revision: { locationId, status: "aktif" }, kind: "item" },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            volume: true,
            unitPrice: true,
            amount: true,
            lineageKey: true,
          },
        })
      : Promise.resolve([]),
    /*
     * JADWAL PER ITEM — inilah yang membuat panel ini berhenti berbohong
     * (DECISIONS 391). `weekly` = increment bobot per minggu milik item itu;
     * 0 berarti minggu jeda. Sudah tersimpan sejak baseline dibuat, hanya
     * belum pernah dibaca panel ini.
     */
    planFraction > 0
      ? db.baseline.findFirst({
          where: { locationId, status: "aktif" },
          orderBy: { baselineNo: "desc" },
          select: { scheduleItems: { select: { lineageKey: true, weekly: true } } },
        })
      : Promise.resolve(null),
  ]);

  /*
   * ── Item tertinggal: dibandingkan terhadap JADWAL ITEM ITU SENDIRI ──────
   *
   * Dilaporkan user 2026-08-20: *"kenapa ada item penarikan kabel yang mana
   * pekerjaan ME, padahal ini baru minggu ketiga"*. Betul – dan sebabnya ada
   * di rumus lamanya: target tiap item = volume RAB × persen kurva-S GLOBAL,
   * yaitu asumsi bahwa semua pekerjaan berjalan serentak sejak minggu 1 dengan
   * laju yang sama. Di konstruksi itu tidak pernah benar.
   *
   * Sekarang fraksi rencananya diambil per item dari jadwal yang memang sudah
   * tersimpan. Item yang minggu ini belum dijadwalkan berfraksi 0 dan TIDAK
   * bisa tertinggal – bukan disembunyikan, melainkan memang belum jatuh tempo.
   */
  let lagging: LaggingItem[] = [];
  let pakaiJadwalItem = false;
  if (planFraction > 0) {
    // Formula ada di calculation layer, bukan di halaman (audit 2026-07-27, M6).
    const meta = new Map(activeItems.map((n) => [n.lineageKey, n]));
    const weeklyByKey = new Map<string, number[]>();
    for (const s of jadwalItem?.scheduleItems ?? []) {
      weeklyByKey.set(
        s.lineageKey,
        Array.isArray(s.weekly)
          ? (s.weekly as unknown[]).map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0))
          : [],
      );
    }
    lagging = laggingItems(
      activeItems.map((n) => {
        /*
         * Cadangannya fraksi GLOBAL, dan itu disengaja: lokasi yang baselinenya
         * belum menyimpan jadwal per item kembali ke perilaku lama, bukan
         * kehilangan panel ini sama sekali. Yang berubah cuma ketepatannya,
         * dan bedanya disebut di layar.
         */
        const dariJadwal = itemPlanFracDariJadwal(
          weeklyByKey.get(n.lineageKey) ?? [],
          currentWeek,
        );
        if (dariJadwal !== null) pakaiJadwalItem = true;
        return {
          lineageKey: n.lineageKey,
          volK: n.volume != null ? Number(n.volume) : 0,
          amount: Number(n.amount),
          volSd: realizedVol.get(n.lineageKey) ?? 0,
          planFrac: dariJadwal ?? planFraction,
        };
      }),
    ).map((it) => {
      const n = meta.get(it.lineageKey)!;
      return {
        id: n.id,
        code: n.code,
        name: n.name,
        unit: n.unit,
        volume: it.volK,
        expected: it.expected,
        realized: it.realized,
        gapValue: it.gapValue,
      };
    });
  }

  const issueData: IssueData[] = issues.map((i) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity,
    status: i.status,
    createdAt: i.createdAt.toISOString(),
    actions: i.actions.map((a) => ({
      id: a.id,
      description: a.description,
      picName: a.picName,
      dueDate: a.dueDate ? a.dueDate.toISOString() : null,
      status: a.status,
      updates: a.updates.map((u) => ({ id: u.id, note: u.note, createdAt: u.createdAt.toISOString() })),
    })),
  }));

  return (
    <div className="space-y-3 p-3">
      <section className="rounded-lg border border-border">
        <header className="border-b border-border px-3 py-2">
          <p className="text-[13px] font-semibold text-ink">Item tertinggal</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {pakaiJadwalItem ? (
              <>
                Realisasi kumulatif di bawah target <b>jadwal item itu sendiri</b> pada minggu{" "}
                {currentWeek} – 10 terbesar berdasar nilai kekurangan. Item yang menurut jadwalnya
                belum dimulai TIDAK dihitung tertinggal.
              </>
            ) : (
              <>
                Baseline lokasi ini belum menyimpan jadwal per item, jadi pembandingnya target
                proporsional kurva-S ({formatPct(planNow)} pada minggu {currentWeek}) – semua item
                dianggap berjalan serentak. Perbarui kurva-S untuk perbandingan per item.
              </>
            )}
          </p>
        </header>
        {lagging.length === 0 ? (
          <p className="p-3 text-sm text-ink-muted">
            {planFraction > 0
              ? "Tidak ada item volume yang tertinggal dari target proporsional."
              : "Belum ada target rencana untuk dibandingkan."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                  <th className="px-3 py-2">Kode</th>
                  <th className="px-3 py-2">Uraian</th>
                  <th className="px-3 py-2 text-right">Vol RAB</th>
                  <th className="px-3 py-2 text-right">Target s/d mgg ini</th>
                  <th className="px-3 py-2 text-right">Realisasi</th>
                  <th className="px-3 py-2 text-right">Kekurangan</th>
                  <th className="px-3 py-2 text-right">Nilai kekurangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lagging.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2 text-xs text-ink-muted">{it.code}</td>
                    <td className="max-w-80 truncate px-3 py-2" title={it.name}>
                      {it.name}
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {formatNumber(it.volume)} {it.unit ?? ""}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{formatNumber(it.expected)}</td>
                    <td className="tabular px-3 py-2 text-right">{formatNumber(it.realized)}</td>
                    <td className="tabular px-3 py-2 text-right text-danger">
                      {formatNumber(it.expected - it.realized)}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{formatRupiahShort(it.gapValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border">
        <header className="border-b border-border px-3 py-2">
          <p className="text-[13px] font-semibold text-ink">Kendala &amp; pemulihan</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Catat kendala lapangan, susun aksi pemulihan (PIC + target), dan log perkembangannya.
          </p>
        </header>
        <div className="p-3">
          <IssuesPanel locationId={locationId} issues={issueData} canManage={canManageIssues} />
        </div>
      </section>
    </div>
  );
}
