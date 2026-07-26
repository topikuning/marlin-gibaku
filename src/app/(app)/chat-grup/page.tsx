import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { MessageSquareText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getActiveAiConfig } from "@/lib/ai/config";
import {
  getChatMessages,
  getMarlinDispatches,
  getPackageContext,
  listChatDays,
  packageTitleOf,
} from "@/lib/waha/chat-summary";
import { formatTanggal, formatTanggalWaktu, jakartaToday } from "@/lib/format";
import { SendSummaryForm, SummaryButton } from "./summary-button";

export const metadata: Metadata = { title: "Chat Grup — Ringkasan Harian" };
export const dynamic = "force-dynamic";

/**
 * Ringkasan harian percakapan grup WA per paket (Layer B, DECISIONS 135/137).
 * Sumber = arsip webhook WAHA (hanya grup tertaut paket). Ringkasan disusun
 * AI on-demand per hari, tersimpan, dan bisa dikirim ke kontak WhatsApp.
 */
export default async function ChatGrupPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; d?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "exec_report.send");
  const sp = await searchParams;

  const [packages, aiCfg, contacts] = await Promise.all([
    db.package.findMany({
      where: { orgId: user.orgId, waGroupId: { not: null } },
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
    db.waContact.findMany({ where: { ownerId: user.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const activePkg = packages.find((p) => p.id === sp.p) ?? packages[0] ?? null;
  const todayKey = jakartaToday().toISOString().slice(0, 10);

  const days = activePkg ? await listChatDays(activePkg.id) : [];
  const dateKey = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : (days[0]?.dateKey ?? todayKey);

  const [messages, summary, recentSummaries, ctx, dispatches] = activePkg
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
        getPackageContext(user, activePkg.id),
        getMarlinDispatches(activePkg.id, dateKey),
      ])
    : [[], null, [], null, []];

  const summarizedDays = new Set(recentSummaries.map((s) => s.summaryDate.toISOString().slice(0, 10)));
  const relevant = messages.filter((m) => !m.noise);
  const noiseCount = messages.length - relevant.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chat Grup — Ringkasan Harian"
        description="Percakapan grup WhatsApp yang tertaut paket diarsipkan otomatis (webhook WAHA). Pilih paket & tanggal, buat ringkasan AI, lalu kirim ke pimpinan."
        actions={
          <Link
            href="/chat-grup/global"
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            Ringkasan global semua grup
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
                {p.contract?.workTitle ? `${p.name} — ${p.contract.workTitle}` : p.name}
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
                      ? `${ctx ? packageTitleOf(ctx) : ""} · ${summary.messageCount} pesan · ${summary.provider ?? "AI"}/${summary.model ?? ""} · diperbarui ${formatTanggalWaktu(summary.updatedAt)}`
                      : "Belum ada ringkasan untuk tanggal ini."
                  }
                  action={
                    activePkg ? (
                      <SummaryButton
                        packageId={activePkg.id}
                        dateKey={dateKey}
                        hasSummary={!!summary}
                        disabled={!aiCfg || (relevant.length === 0 && dispatches.length === 0)}
                      />
                    ) : null
                  }
                />
                <CardBody className="space-y-3">
                  {summary ? (
                    <p className="text-sm whitespace-pre-wrap text-ink">{summary.summaryText}</p>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      {relevant.length === 0 && dispatches.length === 0
                        ? messages.length === 0
                          ? "Tidak ada pesan maupun kiriman MARLIN pada tanggal ini."
                          : `Semua ${messages.length} pesan hari ini adalah uji sistem/basa-basi — tidak ada yang layak diringkas.`
                        : "Klik “Ringkas dengan AI” untuk menyusun ringkasan hari ini."}
                    </p>
                  )}
                  {summary && activePkg ? (
                    <SendSummaryForm packageId={activePkg.id} dateKey={dateKey} contacts={contacts} />
                  ) : null}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title={`Kiriman MARLIN ke grup (${dispatches.length})`}
                  subtitle="Laporan harian & kegiatan yang dikirim sistem ke grup pada tanggal ini — menurut data MARLIN, dipakai memverifikasi kelengkapan ringkasan."
                />
                <CardBody>
                  {dispatches.length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      Tidak ada laporan/kegiatan yang dikirim MARLIN ke grup pada tanggal ini.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {dispatches.map((d, i) => (
                        <li key={`${d.kind}-${i}`} className="flex gap-2">
                          <span className="tabular shrink-0 text-xs text-ink-faint">{d.timeLabel ?? "--:--"}</span>
                          <span className="text-ink-muted">{d.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title={`Arsip pesan (${relevant.length} relevan${noiseCount > 0 ? ` · ${noiseCount} uji sistem diabaikan` : ""})`}
                  subtitle="Teks apa adanya dari grup. Pesan bertanda “uji sistem” tidak dikirim ke AI."
                />
                <CardBody>
                  {messages.length === 0 ? (
                    <EmptyState icon={MessageSquareText} title="Tidak ada pesan" className="py-6" />
                  ) : (
                    <ul className="max-h-[480px] space-y-1.5 overflow-y-auto text-sm">
                      {messages.map((m) => (
                        <li
                          key={m.id}
                          className={`rounded-md border px-2.5 py-1.5 ${
                            m.noise ? "border-dashed border-border-muted opacity-60" : "border-border-muted"
                          }`}
                        >
                          <span className="mr-2 text-xs text-ink-faint">{m.timeLabel}</span>
                          <span className="font-medium text-ink">{m.fromMe ? "MARLIN (sistem)" : m.fromName}</span>
                          {m.fromMe ? <Badge tone="info" label="kiriman MARLIN" className="ml-1.5" /> : null}
                          {m.noise ? <Badge tone="neutral" label="uji sistem" className="ml-1.5" /> : null}
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
