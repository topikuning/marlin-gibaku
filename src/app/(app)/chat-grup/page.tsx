import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader, KpiCard, PageHeader } from "@/components/ui";
import { Send } from "lucide-react";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { listSendableContacts } from "@/lib/contacts/queries";
import { getActiveAiConfig } from "@/lib/ai/config";
import {
  buildSenderDirectory,
  getChatMessages,
  getMarlinDispatches,
  getPackageContext,
  globalDayStats,
  listChatDays,
  packageTitleOf,
} from "@/lib/waha/chat-summary";
import {
  SUMMARY_STATUS_LABEL,
  SUMMARY_STATUS_TONE,
  parseDispatches,
  type SummaryViewStatus,
} from "@/lib/waha/summary-lifecycle";
import { formatTanggal, formatTanggalWaktu, jakartaToday } from "@/lib/format";
import { SidebarGrup, type GrupItem, type HariItem } from "./sidebar-grup";
import { PanelPesan } from "./panel-pesan";
import { PanelRingkasan, type TimelineItem } from "./panel-ringkasan";

export const metadata: Metadata = { title: "Chat Grup – Ringkasan Harian" };
export const dynamic = "force-dynamic";

/**
 * Workspace analisis percakapan grup WA per paket (rombak UI/UX 2026-08-24
 * mengikuti referensi user; lanjutan DECISIONS 135/137/138/139). Tiga panel:
 * (kiri) cari grup + favorit + kalender, (tengah) pesan ber-kurasi relevansi
 * dengan aksi massal, (kanan) Ringkasan AI dengan siklus hidup
 * draft_ai → edited_draft → final → sent. KPI di atas bersifat GLOBAL lintas
 * grup; janji kaki halaman: hanya pesan yang ditandai relevan yang diringkas.
 */
export default async function ChatGrupPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; d?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "wa.chat");
  const sp = await searchParams;

  const [packages, aiCfg, contacts] = await Promise.all([
    db.package.findMany({
      where: { ...packageScopeWhere(user, await accessibleLocationIds(user)), waGroupId: { not: null } },
      select: {
        id: true,
        name: true,
        waGroupName: true,
        contract: { select: { workTitle: true, vendor: { select: { name: true } } } },
        _count: { select: { waMessages: true } },
      },
      orderBy: { name: "asc" },
    }),
    getActiveAiConfig(),
    listSendableContacts(user.id),
  ]);
  const packageIds = packages.map((p) => p.id);

  const activePkg = packages.find((p) => p.id === sp.p) ?? packages[0] ?? null;
  const todayKey = jakartaToday().toISOString().slice(0, 10);

  const days = activePkg ? await listChatDays(activePkg.id) : [];
  const dateKey = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : (days[0]?.dateKey ?? todayKey);
  const senderDir = await buildSenderDirectory(user.orgId);

  const [messages, summary, recentSummaries, ctx, dispatches, stats, lastGlobal, lastPerGroup] =
    await Promise.all([
      activePkg ? getChatMessages(activePkg.id, dateKey, senderDir) : [],
      activePkg
        ? db.waChatSummary.findUnique({
            where: {
              packageId_summaryDate: {
                packageId: activePkg.id,
                summaryDate: new Date(`${dateKey}T00:00:00.000Z`),
              },
            },
            select: {
              summaryText: true,
              aiText: true,
              messageCount: true,
              provider: true,
              model: true,
              updatedAt: true,
              status: true,
              version: true,
              confidence: true,
              generatedById: true,
              generatedAt: true,
              editedById: true,
              editedAt: true,
              finalizedById: true,
              finalizedAt: true,
              lastSentAt: true,
              dispatches: true,
            },
          })
        : null,
      activePkg
        ? db.waChatSummary.findMany({
            where: { packageId: activePkg.id },
            orderBy: { summaryDate: "desc" },
            take: 30,
            select: { summaryDate: true, status: true },
          })
        : [],
      activePkg ? getPackageContext(user, activePkg.id) : null,
      activePkg ? getMarlinDispatches(activePkg.id, dateKey) : [],
      globalDayStats(packageIds, dateKey),
      packageIds.length
        ? db.waMessage.findFirst({
            where: { packageId: { in: packageIds } },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true },
          })
        : null,
      packageIds.length
        ? db.waMessage.groupBy({
            by: ["packageId"],
            where: { packageId: { in: packageIds } },
            _max: { timestamp: true },
          })
        : [],
    ]);

  const lastByPkg = new Map(lastPerGroup.map((r) => [r.packageId, r._max.timestamp]));
  const statusByDay = new Map(
    recentSummaries.map((s) => [s.summaryDate.toISOString().slice(0, 10), s.status as SummaryViewStatus]),
  );

  // Kurasi reviewer menang atas klasifikasi otomatis — aturan `dipakai` yang
  // sama dipakai layar, KPI, dan generator ringkasan.
  const memberMessages = messages.filter((m) => !m.fromMe);
  const relevant = memberMessages.filter((m) => m.dipakai);
  const marlinMessages = messages.filter((m) => m.fromMe);

  const status: SummaryViewStatus = (summary?.status as SummaryViewStatus | undefined) ?? "belum_dibuat";
  const dateLabel = formatTanggal(new Date(`${dateKey}T00:00:00.000Z`), "EEEE, d MMMM yyyy");

  // Nama pelaku jejak — dicari terpisah (kolom penyusun sengaja tanpa relasi FK).
  const actorIds = [summary?.generatedById, summary?.editedById, summary?.finalizedById].filter(
    (x): x is string => !!x,
  );
  const actorName = new Map(
    actorIds.length
      ? (
          await db.user.findMany({
            where: { id: { in: [...new Set(actorIds)] } },
            select: { id: true, fullName: true },
          })
        ).map((u) => [u.id, u.fullName])
      : [],
  );

  const timeline: TimelineItem[] = [];
  if (summary?.generatedAt)
    timeline.push({
      label: "Draf AI dibuat",
      at: formatTanggalWaktu(summary.generatedAt),
      by: actorName.get(summary.generatedById ?? "") ?? null,
    });
  if (summary?.editedAt)
    timeline.push({
      label: "Disunting",
      at: formatTanggalWaktu(summary.editedAt),
      by: actorName.get(summary.editedById ?? "") ?? null,
    });
  if (summary?.finalizedAt)
    timeline.push({
      label: "Difinalkan",
      at: formatTanggalWaktu(summary.finalizedAt),
      by: actorName.get(summary.finalizedById ?? "") ?? null,
    });
  for (const d of parseDispatches(summary?.dispatches)) {
    timeline.push({ label: `Dikirim ke ${d.target}`, at: formatTanggalWaktu(new Date(d.at)), by: null });
  }

  const nothingToSummarize = relevant.length === 0 && dispatches.length === 0 && marlinMessages.length === 0;
  const blockedReason = !aiCfg
    ? "Provider AI belum dikonfigurasi (Sistem → AI)."
    : nothingToSummarize
      ? messages.length === 0
        ? "Tidak ada pesan maupun kiriman MARLIN pada tanggal ini."
        : `Tidak ada pesan relevan pada tanggal ini – tandai manual di tab Arsip lengkap bila perlu.`
      : null;

  const grupItems: GrupItem[] = packages.map((p) => {
    const last = lastByPkg.get(p.id);
    return {
      id: p.id,
      name: p.name,
      workTitle: p.contract?.workTitle ?? null,
      waGroupName: p.waGroupName,
      vendorName: p.contract?.vendor?.name ?? null,
      msgCount: p._count.waMessages,
      lastLabel: last ? formatTanggal(last, "d MMM yyyy") : null,
    };
  });
  const hariItems: HariItem[] = days.map((d) => {
    const st = statusByDay.get(d.dateKey);
    return {
      dateKey: d.dateKey,
      label: formatTanggal(new Date(`${d.dateKey}T00:00:00.000Z`)),
      count: d.count,
      statusLabel: st ? SUMMARY_STATUS_LABEL[st] : null,
      statusTone: st ? SUMMARY_STATUS_TONE[st] : null,
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chat Grup – Ringkasan Harian"
        description="Baca bukti percakapan, kurasi pesan relevan, susun draf AI, review, lalu finalkan dan teruskan ke pimpinan."
        actions={
          <Link
            href="/chat-grup/global"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            <Send aria-hidden className="size-4" />
            Ringkasan global
          </Link>
        }
      />

      {packages.length === 0 ? (
        <Banner
          tone="info"
          title="Belum ada paket tertaut grup WhatsApp"
          description="Tautkan grup WA ke paket (halaman paket → grup WA) supaya pesannya terarsip dan bisa diringkas di sini."
        />
      ) : (
        <>
          {!aiCfg ? (
            <Banner
              tone="warning"
              title="Provider AI belum dikonfigurasi (Sistem → AI)"
              description="Bukti percakapan tetap bisa dibaca; penyusunan draf aktif setelah provider siap."
            />
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Grup dalam scope" value={packages.length} sub="paket tertaut grup WA" />
            <KpiCard
              label="Pesan relevan"
              value={stats.pesanRelevan}
              sub={
                stats.grupBerpesan > 0
                  ? `dari ${stats.grupBerpesan} grup · ${dateLabel}`
                  : "semua grup, tanggal aktif"
              }
              tone={stats.pesanRelevan === 0 ? "warning" : "default"}
            />
            <KpiCard label="Kiriman MARLIN" value={stats.kirimanMarlin} sub="terekam di grup, semua grup" />
            <KpiCard
              label="Status ringkasan"
              value={<span className="text-lg">{SUMMARY_STATUS_LABEL[status]}</span>}
              sub={activePkg ? (activePkg.waGroupName ?? activePkg.name) : "–"}
              tone={status === "final" || status === "sent" ? "success" : status === "belum_dibuat" ? "warning" : "default"}
            />
            <KpiCard
              label="Terakhir sinkron"
              value={<span className="text-lg">{lastGlobal ? formatTanggalWaktu(lastGlobal.timestamp) : "–"}</span>}
              sub="pesan terakhir masuk"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
            <SidebarGrup groups={grupItems} activeId={activePkg?.id ?? null} days={hariItems} dateKey={dateKey} />

            {activePkg ? (
              <PanelPesan
                key={`${activePkg.id}-${dateKey}`}
                packageId={activePkg.id}
                dateKey={dateKey}
                groupTitle={activePkg.waGroupName ?? activePkg.name}
                subTitle={[
                  ctx ? packageTitleOf(ctx) : activePkg.name,
                  ctx?.vendorName ?? null,
                  `${messages.length} pesan`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                messages={messages}
                dispatches={dispatches}
              />
            ) : null}

            <Card className="min-w-0 self-start lg:col-span-2 xl:col-span-1">
              <CardHeader title="Ringkasan AI" subtitle={dateLabel} />
              <CardBody>
                {activePkg ? (
                  <PanelRingkasan
                    key={`${activePkg.id}-${dateKey}-${status}-${summary?.version ?? 0}`}
                    packageId={activePkg.id}
                    dateKey={dateKey}
                    dateLabel={dateLabel}
                    status={status}
                    summaryText={summary?.summaryText ?? ""}
                    aiText={summary?.aiText ?? null}
                    confidence={summary?.confidence ?? null}
                    version={summary?.version ?? 0}
                    messageCount={summary?.messageCount ?? null}
                    generatedByName={actorName.get(summary?.generatedById ?? "") ?? null}
                    updatedLabel={summary ? formatTanggalWaktu(summary.updatedAt) : null}
                    providerLabel={summary ? `${summary.provider ?? "AI"}/${summary.model ?? "–"}` : null}
                    blockedReason={blockedReason}
                    timeline={timeline}
                    contacts={contacts}
                  />
                ) : null}
              </CardBody>
            </Card>
          </div>

          <p className="text-center text-xs text-ink-faint">
            Hanya pesan yang ditandai relevan yang digunakan untuk membuat Ringkasan AI.
          </p>
        </>
      )}
    </div>
  );
}
