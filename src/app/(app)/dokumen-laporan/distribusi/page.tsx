import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { MessageSquareText, Send } from "lucide-react";
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
import { EvidenceTabs } from "./evidence-tabs";
import { MessageCard } from "./message-card";
import { SummaryPanel, type TimelineItem } from "./summary-panel";

export const metadata: Metadata = { title: "Chat Grup — Ringkasan Harian" };
export const dynamic = "force-dynamic";

/**
 * Workspace analisis percakapan grup WA per paket (DECISIONS 139, rombak dari
 * 135/137/138). Tiga kolom: (kiri) scope grup & tanggal, (tengah) bukti
 * percakapan berlapis relevansi, (kanan) ringkasan AI dengan siklus hidup
 * draft_ai → edited_draft → final → sent. Draf AI tidak pernah otomatis final.
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
        contract: { select: { workTitle: true } },
        _count: { select: { waMessages: true } },
      },
      orderBy: { name: "asc" },
    }),
    getActiveAiConfig(),
    listSendableContacts(user.id),
  ]);

  const activePkg = packages.find((p) => p.id === sp.p) ?? packages[0] ?? null;
  const todayKey = jakartaToday().toISOString().slice(0, 10);

  const days = activePkg ? await listChatDays(activePkg.id) : [];
  const dateKey = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : (days[0]?.dateKey ?? todayKey);
  const senderDir = await buildSenderDirectory(user.orgId);

  const [messages, summary, recentSummaries, ctx, dispatches, lastMsg] = activePkg
    ? await Promise.all([
        getChatMessages(activePkg.id, dateKey, senderDir),
        db.waChatSummary.findUnique({
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
        }),
        db.waChatSummary.findMany({
          where: { packageId: activePkg.id },
          orderBy: { summaryDate: "desc" },
          take: 30,
          select: { summaryDate: true, status: true },
        }),
        getPackageContext(user, activePkg.id),
        getMarlinDispatches(activePkg.id, dateKey),
        db.waMessage.findFirst({
          where: { packageId: activePkg.id },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true },
        }),
      ])
    : [[], null, [], null, [], null];

  const statusByDay = new Map(
    recentSummaries.map((s) => [s.summaryDate.toISOString().slice(0, 10), s.status as SummaryViewStatus]),
  );

  // Bukti dipisah tegas: obrolan anggota ≠ kiriman resmi MARLIN (jangan dicampur).
  const memberMessages = messages.filter((m) => !m.fromMe);
  const relevant = memberMessages.filter((m) => m.class.useForSummary);
  const lowContext = memberMessages.filter((m) => !m.class.useForSummary);
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
        : `Semua ${messages.length} pesan hari ini berkonteks rendah — tidak ada yang layak diringkas.`
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chat Grup — Ringkasan Harian"
        description="Baca bukti percakapan, verifikasi kiriman MARLIN, susun draf AI, review, lalu finalkan dan kirim ke pimpinan."
        actions={
          <Link
            href="/dokumen-laporan/distribusi/global"
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Grup dalam scope" value={packages.length} sub="paket tertaut grup WA" />
            <KpiCard
              label="Pesan relevan"
              value={relevant.length}
              sub={lowContext.length > 0 ? `${lowContext.length} konteks rendah disaring` : "hari terpilih"}
              tone={relevant.length === 0 ? "warning" : "default"}
            />
            <KpiCard
              label="Kiriman MARLIN"
              value={dispatches.length}
              sub={marlinMessages.length > 0 ? `${marlinMessages.length} terekam di grup` : "menurut data MARLIN"}
            />
            <KpiCard
              label="Status ringkasan"
              value={<span className="text-lg">{SUMMARY_STATUS_LABEL[status]}</span>}
              sub={dateLabel}
              tone={status === "final" || status === "sent" ? "success" : status === "belum_dibuat" ? "warning" : "default"}
            />
            <KpiCard
              label="Terakhir sinkron"
              value={<span className="text-lg">{lastMsg ? formatTanggalWaktu(lastMsg.timestamp) : "—"}</span>}
              sub="pesan terakhir masuk"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_360px]">
            {/* ── Kolom kiri: scope ──────────────────────────────────── */}
            <div className="space-y-3">
              <Card>
                <CardHeader title="Grup" subtitle="Paket yang tertaut grup WA." />
                <CardBody className="space-y-1">
                  {packages.map((p) => {
                    const on = activePkg?.id === p.id;
                    return (
                      <Link
                        key={p.id}
                        href={`/dokumen-laporan/distribusi?p=${p.id}`}
                        aria-current={on ? "page" : undefined}
                        className={`block rounded-md border px-2.5 py-2 text-sm ${
                          on
                            ? "border-primary bg-info-soft text-primary"
                            : "border-transparent text-ink-muted hover:bg-surface-muted"
                        }`}
                      >
                        <span className="block font-medium">{p.name}</span>
                        {p.contract?.workTitle ? (
                          <span className="block truncate text-xs text-ink-faint">{p.contract.workTitle}</span>
                        ) : null}
                        <span className="mt-0.5 block text-xs text-ink-faint">
                          {p.waGroupName ?? "grup WA"} · {p._count.waMessages} pesan
                        </span>
                      </Link>
                    );
                  })}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Tanggal" subtitle="Hari yang punya pesan." />
                <CardBody className="space-y-1">
                  {days.length === 0 ? (
                    <p className="text-sm text-ink-muted">Belum ada pesan terarsip.</p>
                  ) : (
                    days.map((d) => {
                      const st = statusByDay.get(d.dateKey);
                      return (
                        <Link
                          key={d.dateKey}
                          href={`/dokumen-laporan/distribusi?p=${activePkg!.id}&d=${d.dateKey}`}
                          aria-current={d.dateKey === dateKey ? "page" : undefined}
                          className={`flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm ${
                            d.dateKey === dateKey ? "bg-info-soft text-primary" : "hover:bg-surface-muted"
                          }`}
                        >
                          <span>{formatTanggal(new Date(`${d.dateKey}T00:00:00.000Z`))}</span>
                          <span className="flex items-center gap-1 text-xs text-ink-faint">
                            {st ? <Badge tone={SUMMARY_STATUS_TONE[st]} label={SUMMARY_STATUS_LABEL[st]} /> : null}
                            {d.count}
                          </span>
                        </Link>
                      );
                    })
                  )}
                </CardBody>
              </Card>

              {lowContext.length > 0 ? (
                <p className="px-1 text-xs text-ink-faint">
                  {lowContext.length} pesan hari ini ditandai berkonteks rendah (uji sistem/basa-basi) dan tidak
                  dikirim ke AI. Tetap bisa dibaca di tab “Arsip lengkap”.
                </p>
              ) : null}
            </div>

            {/* ── Kolom tengah: bukti ────────────────────────────────── */}
            <Card className="min-w-0">
              <CardHeader
                title="Bukti percakapan"
                subtitle={`${ctx ? packageTitleOf(ctx) : ""} · ${dateLabel}`}
              />
              <CardBody>
                <EvidenceTabs
                  tabs={[
                    {
                      id: "relevan",
                      label: "Pesan relevan",
                      count: relevant.length,
                      content:
                        relevant.length === 0 ? (
                          <EmptyState
                            icon={MessageSquareText}
                            title="Tidak ada pesan relevan"
                            description="Tidak ada obrolan anggota yang layak diringkas pada tanggal ini."
                            className="py-8"
                          />
                        ) : (
                          <ul className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                            {relevant.map((m) => (
                              <MessageCard key={m.id} m={m} />
                            ))}
                          </ul>
                        ),
                    },
                    {
                      id: "marlin",
                      label: "Kiriman MARLIN",
                      count: dispatches.length + marlinMessages.length,
                      content: (
                        <div className="space-y-4">
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                              Menurut data MARLIN ({dispatches.length})
                            </p>
                            {dispatches.length === 0 ? (
                              <p className="text-sm text-ink-muted">
                                Tidak ada laporan/kegiatan yang dikirim MARLIN ke grup pada tanggal ini.
                              </p>
                            ) : (
                              <ul className="space-y-1 text-sm">
                                {dispatches.map((d, i) => (
                                  <li key={`${d.kind}-${i}`} className="flex gap-2">
                                    <span className="tabular shrink-0 text-xs text-ink-faint">
                                      {d.timeLabel ?? "--:--"}
                                    </span>
                                    <span className="text-ink-muted">{d.label}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                              Terekam di grup ({marlinMessages.length})
                            </p>
                            {marlinMessages.length === 0 ? (
                              <p className="text-sm text-ink-muted">
                                Belum ada pesan keluar yang tertangkap webhook. Pastikan event WAHA
                                <code className="mx-1 rounded bg-surface-inset px-1">message.any</code>
                                aktif agar kiriman MARLIN ikut terarsip.
                              </p>
                            ) : (
                              <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                                {marlinMessages.map((m) => (
                                  <MessageCard key={m.id} m={m} />
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      ),
                    },
                    {
                      id: "arsip",
                      label: "Arsip lengkap",
                      count: messages.length,
                      content:
                        messages.length === 0 ? (
                          <EmptyState
                            icon={MessageSquareText}
                            title="Tidak ada pesan"
                            description="Belum ada pesan terarsip pada tanggal ini."
                            className="py-8"
                          />
                        ) : (
                          <ul className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                            {messages.map((m) => (
                              <MessageCard key={m.id} m={m} dim={!m.class.useForSummary} />
                            ))}
                          </ul>
                        ),
                    },
                  ]}
                />
              </CardBody>
            </Card>

            {/* ── Kolom kanan: ringkasan ─────────────────────────────── */}
            <Card className="min-w-0 self-start lg:col-span-2 xl:col-span-1">
              <CardHeader title="Ringkasan AI" subtitle={dateLabel} />
              <CardBody>
                {activePkg ? (
                  <SummaryPanel
                    key={`${activePkg.id}-${dateKey}-${status}-${summary?.version ?? 0}`}
                    packageId={activePkg.id}
                    dateKey={dateKey}
                    status={status}
                    summaryText={summary?.summaryText ?? ""}
                    aiText={summary?.aiText ?? null}
                    confidence={summary?.confidence ?? null}
                    version={summary?.version ?? 0}
                    providerLabel={
                      summary
                        ? `${summary.provider ?? "AI"}/${summary.model ?? "—"} · ${summary.messageCount} pesan · diperbarui ${formatTanggalWaktu(summary.updatedAt)}`
                        : null
                    }
                    blockedReason={blockedReason}
                    timeline={timeline}
                    contacts={contacts}
                  />
                ) : null}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
