import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { MessageSquareText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getActiveAiConfig } from "@/lib/ai/config";
import { getChatMessages, listChatDays } from "@/lib/waha/chat-summary";
import { formatTanggal, formatTanggalWaktu, jakartaToday } from "@/lib/format";
import { SummaryButton } from "./summary-button";

export const metadata: Metadata = { title: "Chat Grup — Ringkasan Harian" };
export const dynamic = "force-dynamic";

/**
 * Ringkasan harian percakapan grup WA per paket (Layer B, DECISIONS 135).
 * Sumber = arsip webhook WAHA (hanya grup tertaut paket). Ringkasan disusun
 * AI on-demand per hari; tersimpan (paket, tanggal) dan bisa diperbarui.
 */
export default async function ChatGrupPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; d?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "exec_report.send");
  const sp = await searchParams;

  const [packages, aiCfg] = await Promise.all([
    db.package.findMany({
      where: { orgId: user.orgId, waGroupId: { not: null } },
      select: { id: true, name: true, waGroupName: true, _count: { select: { waMessages: true } } },
      orderBy: { name: "asc" },
    }),
    getActiveAiConfig(),
  ]);

  const activePkg = packages.find((p) => p.id === sp.p) ?? packages[0] ?? null;
  const todayKey = jakartaToday().toISOString().slice(0, 10);

  const days = activePkg ? await listChatDays(activePkg.id) : [];
  const dateKey = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : (days[0]?.dateKey ?? todayKey);

  const [messages, summary, recentSummaries] = activePkg
    ? await Promise.all([
        getChatMessages(activePkg.id, dateKey),
        db.waChatSummary.findUnique({
          where: {
            packageId_summaryDate: {
              packageId: activePkg.id,
              summaryDate: new Date(`${dateKey}T00:00:00.000Z`),
            },
          },
          select: { summaryText: true, messageCount: true, provider: true, model: true, updatedAt: true },
        }),
        db.waChatSummary.findMany({
          where: { packageId: activePkg.id },
          orderBy: { summaryDate: "desc" },
          take: 10,
          select: { summaryDate: true, messageCount: true },
        }),
      ])
    : [[], null, []];

  const summarizedDays = new Set(recentSummaries.map((s) => s.summaryDate.toISOString().slice(0, 10)));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chat Grup — Ringkasan Harian"
        description="Percakapan grup WhatsApp yang tertaut paket diarsipkan otomatis (webhook WAHA). Pilih paket & tanggal, lalu buat ringkasan AI — tersimpan per hari dan bisa dibuka kembali kapan saja."
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
              description="Arsip chat tetap tampil; tombol ringkas aktif setelah provider siap."
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {packages.map((p) => (
              <Link
                key={p.id}
                href={`/chat-grup?p=${p.id}`}
                aria-current={activePkg?.id === p.id ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  activePkg?.id === p.id
                    ? "border-primary bg-info-soft text-primary"
                    : "border-border text-ink-muted hover:border-border-strong"
                }`}
              >
                {p.waGroupName ?? p.name}
                <span className="ml-1.5 text-xs text-ink-faint">{p._count.waMessages}</span>
              </Link>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <Card className="self-start">
              <CardHeader title="Tanggal" subtitle="Hari yang punya pesan." />
              <CardBody className="space-y-1">
                {days.length === 0 ? (
                  <p className="text-sm text-ink-muted">Belum ada pesan terarsip.</p>
                ) : (
                  days.map((d) => (
                    <Link
                      key={d.dateKey}
                      href={`/chat-grup?p=${activePkg!.id}&d=${d.dateKey}`}
                      aria-current={d.dateKey === dateKey ? "page" : undefined}
                      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                        d.dateKey === dateKey ? "bg-info-soft text-primary" : "hover:bg-surface-muted"
                      }`}
                    >
                      <span>{formatTanggal(new Date(`${d.dateKey}T00:00:00.000Z`))}</span>
                      <span className="flex items-center gap-1 text-xs text-ink-faint">
                        {summarizedDays.has(d.dateKey) ? <Badge tone="success" label="✓" /> : null}
                        {d.count}
                      </span>
                    </Link>
                  ))
                )}
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader
                  title={`Ringkasan ${formatTanggal(new Date(`${dateKey}T00:00:00.000Z`))}`}
                  subtitle={
                    summary
                      ? `${summary.messageCount} pesan · ${summary.provider ?? "AI"}/${summary.model ?? ""} · diperbarui ${formatTanggalWaktu(summary.updatedAt)}`
                      : "Belum ada ringkasan untuk tanggal ini."
                  }
                  action={
                    activePkg ? (
                      <SummaryButton
                        packageId={activePkg.id}
                        dateKey={dateKey}
                        hasSummary={!!summary}
                        disabled={!aiCfg || messages.length === 0}
                      />
                    ) : null
                  }
                />
                <CardBody>
                  {summary ? (
                    <p className="text-sm whitespace-pre-wrap text-ink">{summary.summaryText}</p>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      {messages.length === 0
                        ? "Tidak ada pesan pada tanggal ini."
                        : "Klik “Ringkas dengan AI” untuk menyusun ringkasan hari ini."}
                    </p>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title={`Arsip pesan (${messages.length})`} subtitle="Teks apa adanya dari grup — bahan ringkasan." />
                <CardBody>
                  {messages.length === 0 ? (
                    <EmptyState icon={MessageSquareText} title="Tidak ada pesan" className="py-6" />
                  ) : (
                    <ul className="max-h-[480px] space-y-1.5 overflow-y-auto text-sm">
                      {messages.map((m) => (
                        <li key={m.id} className="rounded-md border border-border-muted px-2.5 py-1.5">
                          <span className="mr-2 text-xs text-ink-faint">{m.timeLabel}</span>
                          <span className="font-medium text-ink">{m.fromName}</span>
                          <span className="block whitespace-pre-wrap text-ink-muted">
                            {m.body}
                            {m.hasMedia ? " 📎" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
